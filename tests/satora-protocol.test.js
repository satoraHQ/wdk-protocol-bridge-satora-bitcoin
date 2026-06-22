import { beforeEach, describe, expect, jest, test } from '@jest/globals'

// Mock the satora swap client so the unit tests stay fast and isolated and do
// not load its ESM-only dependency graph (exercised for real by the Node-based
// integration tests). `mockClient` is the object returned by the builder, so
// each test can stub the client methods it needs. Must be registered before
// importing the module.
const mockClient = {
  getSwapPairs: jest.fn(),
  getTokens: jest.fn()
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

    // Discovery methods do not require an account.
    protocol = new SatoraProtocol()
  })

  describe('quoteSwidge', () => {
    test.todo('should successfully quote a swidge operation (exact-in)')

    test.todo('should successfully quote a swidge operation (exact-out)')
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
        { token_id: '0xusdc', chain: '137', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
        { token_id: '0xusdt', chain: '1', symbol: 'USDT', decimals: 6, name: 'Tether USD' }
      ]
    }

    beforeEach(() => {
      mockClient.getTokens.mockResolvedValue(tokensResponse)
    })

    test('maps btc and evm tokens, setting address for evm tokens only', async () => {
      const tokens = await protocol.getSupportedTokens()

      expect(tokens).toEqual([
        { token: 'btc', chain: 'Bitcoin', symbol: 'BTC', decimals: 8, name: 'Bitcoin' },
        { token: '0xusdc', chain: 137, symbol: 'USDC', decimals: 6, name: 'USD Coin', address: '0xusdc' },
        { token: '0xusdt', chain: 1, symbol: 'USDT', decimals: 6, name: 'Tether USD', address: '0xusdt' }
      ])
    })

    test('filters tokens by destination chain', async () => {
      const tokens = await protocol.getSupportedTokens({ toChain: 137 })

      expect(tokens).toEqual([
        { token: '0xusdc', chain: 137, symbol: 'USDC', decimals: 6, name: 'USD Coin', address: '0xusdc' }
      ])
    })

    test('filters tokens by source chain, accepting non-EVM string ids', async () => {
      const tokens = await protocol.getSupportedTokens({ fromChain: 'Bitcoin' })

      expect(tokens.map(token => token.token)).toEqual(['btc'])
    })

    test('ignores fromToken when no chain filter is given', async () => {
      const tokens = await protocol.getSupportedTokens({ fromToken: '0xusdc' })

      expect(tokens).toHaveLength(3)
    })
  })
})
