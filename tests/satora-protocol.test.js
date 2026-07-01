import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { SatoraInvalidOptionsError } from '../src/errors.js'

// Mock the satora swap client so the unit tests stay fast and isolated and do
// not load its ESM-only dependency graph (exercised for real by the Node-based
// integration tests). `mockClient` is the object returned by the builder, so
// each test can stub the client methods it needs. Must be registered before
// importing the module.
const mockClient = {
  getSwapPairs: jest.fn(),
  getTokens: jest.fn(),
  getQuote: jest.fn()
}

jest.unstable_mockModule('@satora/swap', () => ({
  Client: {
    builder: () => {
      const builder = {
        withBaseUrl: () => builder,
        withMnemonic: () => builder,
        build: async () => mockClient
      }
      return builder
    }
  }
}))

const { default: SatoraProtocol } = await import('../index.js')

describe('SatoraProtocol', () => {
  let protocol

  beforeEach(() => {
    mockClient.getSwapPairs.mockReset()
    mockClient.getTokens.mockReset()
    mockClient.getQuote.mockReset()

    // Discovery methods do not require an account.
    protocol = new SatoraProtocol()
  })

  describe('quoteSwidge', () => {
    const quoteResponse = {
      exchange_rate: '0.0000004',
      gasless_network_fee: 500,
      network_fee: 1000,
      protocol_fee: 250,
      protocol_fee_rate: 0.0025,
      bridge_fee: null,
      net_source_amount: '1000000',
      net_target_amount: '40000',
      source_amount: '1000000',
      target_amount: '40000'
    }

    beforeEach(() => {
      mockClient.getQuote.mockResolvedValue(quoteResponse)
    })

    test('reads source and destination chains from the token identifiers (exact-in)', async () => {
      const quote = await protocol.quoteSwidge({
        fromToken: '42161:0xusdt0',
        toToken: 'Bitcoin:btc',
        fromTokenAmount: 1000000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: '42161',
        sourceToken: '0xusdt0',
        targetChain: 'Bitcoin',
        targetToken: 'btc',
        sourceAmount: 1000000
      })

      expect(quote.fromTokenAmount).toBe(1000000n)
      expect(quote.toTokenAmount).toBe(40000n)
      expect(quote.toTokenAmountMin).toBe(40000n) // no slippage configured
      expect(quote.fees).toEqual([
        { type: 'protocol', amount: 250n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Protocol fee (rate 0.0025)' },
        { type: 'network', amount: 1000n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Network fee (HTLC create/claim + BTC mining)' },
        { type: 'network', amount: 500n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Gasless DEX execution gas' }
      ])
    })

    test('quotes exact-out (passes targetAmount, not sourceAmount)', async () => {
      const quote = await protocol.quoteSwidge({
        fromToken: 'Bitcoin:btc',
        toToken: '42161:0xusdt0',
        toTokenAmount: 40000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ targetAmount: 40000 })
      )
      expect(mockClient.getQuote.mock.calls[0][0]).not.toHaveProperty('sourceAmount')
      expect(quote.toTokenAmount).toBe(40000n)
    })

    test('disambiguates BTC by chain (Lightning vs Bitcoin)', async () => {
      await protocol.quoteSwidge({
        fromToken: 'Lightning:btc',
        toToken: '42161:0xusdt0',
        fromTokenAmount: 1000000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith(
        expect.objectContaining({ sourceChain: 'Lightning', sourceToken: 'btc' })
      )
    })

    test('applies slippage (option, then config.defaultSlippage) to the minimum', async () => {
      const withOption = await protocol.quoteSwidge({
        fromToken: '42161:0xusdt0', toToken: 'Bitcoin:btc', fromTokenAmount: 1000000n, slippage: 0.01
      })
      expect(withOption.toTokenAmountMin).toBe(39600n) // 40000 - 1%

      protocol = new SatoraProtocol(undefined, { defaultSlippage: 0.005 })
      const withConfig = await protocol.quoteSwidge({
        fromToken: '42161:0xusdt0', toToken: 'Bitcoin:btc', fromTokenAmount: 1000000n
      })
      expect(withConfig.toTokenAmountMin).toBe(39800n) // 40000 - 0.5%
    })

    test('throws when fromToken is not chain-qualified', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: 'btc', toToken: '42161:0xusdt0', fromTokenAmount: 1000000n })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.getQuote).not.toHaveBeenCalled()
    })

    test('throws when no amount is given', async () => {
      await expect(
        protocol.quoteSwidge({ fromToken: '42161:0xusdt0', toToken: 'Bitcoin:btc' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.getQuote).not.toHaveBeenCalled()
    })
  })

  describe('swidge', () => {
    test.todo('should successfully perform a swidge operation (exact-in)')

    test.todo('should successfully perform a swidge operation (exact-out)')

    test.todo('should throw if the swidge fees exceed the max network fee configuration')

    test.todo('should throw if the swidge fees exceed the max protocol fee configuration')

    test.todo('should throw if the account is read-only')
  })

  describe('getSwidgeStatus', () => {
    test.todo('should successfully return the status of an operation')

    test.todo('should successfully return the status of an operation by filtering the source and target chain')

    test.todo('should throw if no operation exists for the given id')
  })

  describe('getSupportedChains', () => {
    test('maps and de-duplicates the chains from swap pairs', async () => {
      mockClient.getSwapPairs.mockResolvedValue({
        pairs: [
          { source: 'Bitcoin', target: '137' },
          { source: '137', target: 'Bitcoin' }, // duplicates, must be collapsed
          { source: 'Lightning', target: '1' },
          { source: 'Arkade', target: '42161' }
        ]
      })

      const chains = await protocol.getSupportedChains()

      // EVM chains are surfaced with numeric ids; non-EVM chains keep their name.
      expect(chains).toEqual([
        { id: 'Bitcoin', name: 'Bitcoin', type: 'utxo', nativeToken: 'BTC' },
        { id: 137, name: 'Polygon', type: 'evm', nativeToken: 'POL' },
        { id: 'Lightning', name: 'Lightning Network', type: 'lightning', nativeToken: 'BTC' },
        { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
        { id: 'Arkade', name: 'Arkade', type: 'ark', nativeToken: 'BTC' },
        { id: 42161, name: 'Arbitrum', type: 'evm', nativeToken: 'ETH' }
      ])
    })

    test('propagates client errors', async () => {
      mockClient.getSwapPairs.mockRejectedValue(new Error('swap pairs unavailable'))

      await expect(protocol.getSupportedChains()).rejects.toThrow('swap pairs unavailable')
    })
  })

  describe('getSupportedTokens', () => {
    const tokensResponse = {
      btc_tokens: [
        { token_id: 'btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, name: 'Bitcoin' }
      ],
      evm_tokens: [
        { token_id: '0xusdt0', chain: '42161', symbol: 'USDT0', decimals: 6, name: 'USDT0' },
        { token_id: '0xusdt', chain: '1', symbol: 'USDT', decimals: 6, name: 'Tether USD' }
      ]
    }

    beforeEach(() => {
      mockClient.getTokens.mockResolvedValue(tokensResponse)
    })

    test('maps btc and evm tokens with chain-qualified ids, setting address for evm only', async () => {
      const tokens = await protocol.getSupportedTokens()

      expect(tokens).toEqual([
        { token: 'Bitcoin:btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, name: 'Bitcoin' },
        { token: '42161:0xusdt0', chain: 42161, symbol: 'USDT0', decimals: 6, name: 'USDT0', address: '0xusdt0' },
        { token: '1:0xusdt', chain: 1, symbol: 'USDT', decimals: 6, name: 'Tether USD', address: '0xusdt' }
      ])
    })

    test('filters tokens by destination chain', async () => {
      const tokens = await protocol.getSupportedTokens({ toChain: 42161 })

      expect(tokens).toEqual([
        { token: '42161:0xusdt0', chain: 42161, symbol: 'USDT0', decimals: 6, name: 'USDT0', address: '0xusdt0' }
      ])
    })

    test('filters tokens by source chain, accepting non-EVM string ids', async () => {
      const tokens = await protocol.getSupportedTokens({ fromChain: 'Bitcoin' })

      expect(tokens.map(token => token.token)).toEqual(['Bitcoin:btc'])
    })

    test('ignores fromToken when no chain filter is given', async () => {
      const tokens = await protocol.getSupportedTokens({ fromToken: '0xusdt0' })

      expect(tokens).toHaveLength(3)
    })
  })
})
