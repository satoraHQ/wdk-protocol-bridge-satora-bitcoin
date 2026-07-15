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
  getQuote: jest.fn(),
  createArkadeToEvmSwapGeneric: jest.fn(),
  createBitcoinToEvmSwap: jest.fn(),
  createEvmToArkadeSwapGeneric: jest.fn(),
  createEvmToBitcoinSwap: jest.fn(),
  createEvmToLightningSwapGeneric: jest.fn(),
  createLightningToEvmSwapGeneric: jest.fn(),
  fundSwap: jest.fn(),
  getSwap: jest.fn(),
  claim: jest.fn(),
  refundSwap: jest.fn(),
  refundEvmWithSigner: jest.fn(),
  collabRefundEvmWithSigner: jest.fn()
}

jest.unstable_mockModule('@satora/swap', () => ({
  Client: {
    builder: () => {
      const builder = {
        withBaseUrl: () => builder,
        withMnemonic: () => builder,
        withArkadeServerUrl: () => builder,
        withEsploraUrl: () => builder,
        withSignerStorage: () => builder,
        withSwapStorage: () => builder,
        build: async () => mockClient
      }
      return builder
    }
  }
}))

const { default: SatoraProtocol } = await import('../index.js')

describe('@satora/wdk-protocol-swidge-satora', () => {
  let protocol

  beforeEach(() => {
    mockClient.getSwapPairs.mockReset()
    mockClient.getTokens.mockReset()
    mockClient.getQuote.mockReset()
    mockClient.createArkadeToEvmSwapGeneric.mockReset()
    mockClient.createBitcoinToEvmSwap.mockReset()
    mockClient.createEvmToArkadeSwapGeneric.mockReset()
    mockClient.createEvmToBitcoinSwap.mockReset()
    mockClient.createEvmToLightningSwapGeneric.mockReset()
    mockClient.createLightningToEvmSwapGeneric.mockReset()
    mockClient.fundSwap.mockReset()
    mockClient.getSwap.mockReset()
    mockClient.claim.mockReset()
    mockClient.refundSwap.mockReset()
    mockClient.refundEvmWithSigner.mockReset()
    mockClient.collabRefundEvmWithSigner.mockReset()

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

      // Exact-out passes targetAmount and no sourceAmount.
      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: 'Bitcoin',
        sourceToken: 'btc',
        targetChain: '42161',
        targetToken: '0xusdt0',
        targetAmount: 40000
      })
      expect(quote.toTokenAmount).toBe(40000n)
    })

    test('disambiguates BTC by chain (Lightning vs Bitcoin)', async () => {
      await protocol.quoteSwidge({
        fromToken: 'Lightning:btc',
        toToken: '42161:0xusdt0',
        fromTokenAmount: 1000000n
      })

      expect(mockClient.getQuote).toHaveBeenCalledWith({
        sourceChain: 'Lightning',
        sourceToken: 'btc',
        targetChain: '42161',
        targetToken: '0xusdt0',
        sourceAmount: 1000000
      })
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
    let account

    const createResponse = {
      response: {
        id: 'swap-1',
        btc_vhtlc_address: 'ark1qvhtlc',
        source_amount: '100000',
        target_amount: '58000000',
        fee_sats: 250,
        evm_claim_txid: null
      }
    }

    beforeEach(() => {
      account = {
        getAddress: jest.fn().mockResolvedValue('ark1qsource'),
        sendTransaction: jest.fn().mockResolvedValue({ hash: '0xfundtx', fee: 100n })
      }
      protocol = new SatoraProtocol(account, { accountChains: ['Arkade'] })

      mockClient.createArkadeToEvmSwapGeneric.mockResolvedValue(createResponse)
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded', evm_claim_txid: null })
        .mockResolvedValueOnce({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim' })
    })

    test('drives an Arkade -> EVM swap end to end (create, fund, claim)', async () => {
      const result = await protocol.swidge({
        fromToken: 'Arkade:btc',
        toToken: '42161:0xusdt0',
        fromTokenAmount: 100000n,
        recipient: '0xRecipient'
      })

      // Create with the parsed direction + recipient as the target address.
      expect(mockClient.createArkadeToEvmSwapGeneric).toHaveBeenCalledWith({
        targetAddress: '0xRecipient',
        tokenAddress: '0xusdt0',
        evmChainId: 42161,
        sourceAmount: 100000n
      })

      // The account funds the returned VHTLC with the server-confirmed amount.
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: 'ark1qvhtlc', value: 100000n })

      // Gasless claim by swap id.
      expect(mockClient.claim).toHaveBeenCalledWith('swap-1', undefined)

      expect(result).toEqual({
        id: 'swap-1',
        hash: '0xevmclaim',
        fromTokenAmount: 100000n,
        toTokenAmount: 58000000n,
        fees: [
          { type: 'protocol', amount: 250n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }
        ],
        transactions: [
          { hash: '0xfundtx', chain: 'Arkade', type: 'source' },
          { hash: '0xevmclaim', chain: 42161, type: 'destination' }
        ]
      })
    })

    test('throws if the account cannot send (read-only or missing)', async () => {
      const readOnly = new SatoraProtocol({ getAddress: jest.fn() })
      await expect(
        readOnly.swidge({ fromToken: 'Arkade:btc', toToken: '42161:0xusdt0', fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createArkadeToEvmSwapGeneric).not.toHaveBeenCalled()
    })

    test('throws if recipient is missing', async () => {
      await expect(
        protocol.swidge({ fromToken: 'Arkade:btc', toToken: '42161:0xusdt0', fromTokenAmount: 100000n })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws if the source chain is not in accountChains', async () => {
      // An account declared as EVM-only cannot fund an Arkade-sourced swap.
      const evmOnly = new SatoraProtocol(account, { accountChains: [1, 137, 42161] })
      await expect(
        evmOnly.swidge({ fromToken: 'Arkade:btc', toToken: '42161:0xusdt0', fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createArkadeToEvmSwapGeneric).not.toHaveBeenCalled()
    })

    test('skips the source-chain check when accountChains is not set', async () => {
      const noDecl = new SatoraProtocol(account)
      const result = await noDecl.swidge({
        fromToken: 'Arkade:btc', toToken: '42161:0xusdt0', fromTokenAmount: 100000n, recipient: '0xR'
      })
      expect(result.id).toBe('swap-1')
    })

    test('throws for an unsupported direction (EVM source)', async () => {
      await expect(
        protocol.swidge({ fromToken: '42161:0xusdt0', toToken: 'Arkade:btc', fromTokenAmount: 100000n, recipient: 'ark1q' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
    })

    test('throws if the gasless claim fails', async () => {
      mockClient.claim.mockResolvedValue({ success: false, message: 'boom' })
      await expect(
        protocol.swidge({ fromToken: 'Arkade:btc', toToken: '42161:0xusdt0', fromTokenAmount: 100000n, recipient: '0xR' })
      ).rejects.toThrow('boom')
    })
  })

  describe('swidge (EVM -> Arkade)', () => {
    let account

    beforeEach(() => {
      // For an EVM source the account is an EvmSigner (address + fundSwap-capable).
      account = {
        address: '0xEvmSigner',
        sendTransaction: jest.fn() // EvmSigner shape; funding goes via client.fundSwap
      }
      protocol = new SatoraProtocol(account, { accountChains: [42161] })

      mockClient.createEvmToArkadeSwapGeneric.mockResolvedValue({
        response: { id: 'swap-2', source_amount: '1000000', target_amount: '1450', fee_sats: 30, btc_claim_txid: null }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', direction: 'evm_to_arkade', evm_chain_id: 42161, evm_fund_txid: '0xfundtx', btc_claim_txid: 'btcclaim' })
    })

    test('creates, funds the EVM HTLC via fundSwap, and settles to Arkade', async () => {
      const result = await protocol.swidge({
        fromToken: '42161:0xusdt0',
        toToken: 'Arkade:btc',
        fromTokenAmount: 1000000n,
        recipient: 'ark1qdest'
      })

      expect(mockClient.createEvmToArkadeSwapGeneric).toHaveBeenCalledWith({
        targetAddress: 'ark1qdest',
        tokenAddress: '0xusdt0',
        evmChainId: 42161,
        userAddress: '0xEvmSigner',
        sourceAmount: 1000000n
      })
      // The EVM HTLC is funded via the signer, not account.sendTransaction.
      expect(mockClient.fundSwap).toHaveBeenCalledWith('swap-2', account)

      expect(result).toEqual({
        id: 'swap-2',
        hash: 'btcclaim',
        fromTokenAmount: 1000000n,
        toTokenAmount: 1450n,
        fees: [{ type: 'protocol', amount: 30n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [
          { hash: '0xfundtx', chain: 42161, type: 'source' },
          { hash: 'btcclaim', chain: 'Arkade', type: 'destination' }
        ]
      })
    })

    test('rejects an EVM source not declared in accountChains', async () => {
      const wrong = new SatoraProtocol(account, { accountChains: ['Arkade'] })
      await expect(
        wrong.swidge({ fromToken: '42161:0xusdt0', toToken: 'Arkade:btc', fromTokenAmount: 1000000n, recipient: 'ark1qdest' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createEvmToArkadeSwapGeneric).not.toHaveBeenCalled()
    })
  })

  describe('swidge (Lightning -> EVM)', () => {
    let account

    beforeEach(() => {
      // For a Lightning source the account pays the swap's BOLT11 invoice.
      account = { payInvoice: jest.fn().mockResolvedValue({ paymentHash: 'ph' }) }
      protocol = new SatoraProtocol(account, { accountChains: ['Lightning'] })

      mockClient.createLightningToEvmSwapGeneric.mockResolvedValue({
        response: { id: 'swap-3', bolt11_invoice: 'lnbc1invoice', source_amount: '1000', target_amount: '580000', fee_sats: 10, evm_claim_txid: null }
      })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaim' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim', evm_chain_id: 42161 })
    })

    test('creates, pays the BOLT11 invoice, and settles to EVM', async () => {
      const result = await protocol.swidge({
        fromToken: 'Lightning:btc',
        toToken: '42161:0xusdt0',
        fromTokenAmount: 1000n,
        recipient: '0xRecipient'
      })

      expect(mockClient.createLightningToEvmSwapGeneric).toHaveBeenCalledWith({
        targetAddress: '0xRecipient',
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        amountIn: 1000
      })
      expect(account.payInvoice).toHaveBeenCalledWith('lnbc1invoice')

      expect(result).toEqual({
        id: 'swap-3',
        hash: '0xevmclaim',
        fromTokenAmount: 1000n,
        toTokenAmount: 580000n,
        fees: [{ type: 'protocol', amount: 10n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [{ hash: '0xevmclaim', chain: 42161, type: 'destination' }]
      })
    })

    test('throws if the account cannot pay invoices', async () => {
      const noPay = new SatoraProtocol({ getAddress: jest.fn() }, { accountChains: ['Lightning'] })
      await expect(
        noPay.swidge({ fromToken: 'Lightning:btc', toToken: '42161:0xusdt0', fromTokenAmount: 1000n, recipient: '0xR' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createLightningToEvmSwapGeneric).not.toHaveBeenCalled()
    })

    test('fails fast when the invoice payment fails (e.g. no funds)', async () => {
      account.payInvoice.mockRejectedValue(new Error('insufficient balance'))
      // Completion would otherwise poll forever; make it stay in-flight.
      mockClient.getSwap.mockReset().mockResolvedValue({ status: 'clientfunded' })

      await expect(
        protocol.swidge({ fromToken: 'Lightning:btc', toToken: '42161:0xusdt0', fromTokenAmount: 1000n, recipient: '0xR' })
      ).rejects.toThrow(/lightning payment failed: insufficient balance/)
    })
  })

  describe('swidge (EVM -> Lightning)', () => {
    let account

    beforeEach(() => {
      account = { address: '0xEvmSigner' }
      protocol = new SatoraProtocol(account, { accountChains: [42161] })

      mockClient.createEvmToLightningSwapGeneric.mockResolvedValue({
        response: { id: 'swap-4', source_amount: '1000000', target_amount: '900', fee_sats: 20, evm_fund_txid: null }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      // Server pays the invoice and claims the EVM HTLC — terminal, no client claim.
      mockClient.getSwap.mockResolvedValue({ status: 'serverredeemed' })
    })

    test('creates against the invoice, funds the EVM HTLC, and never claims (server does)', async () => {
      const result = await protocol.swidge({
        fromToken: '42161:0xusdt0',
        toToken: 'Lightning:btc',
        recipient: 'lnbc10u1invoice'
      })

      expect(mockClient.createEvmToLightningSwapGeneric).toHaveBeenCalledWith({
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        userAddress: '0xEvmSigner',
        lightningInvoice: 'lnbc10u1invoice'
      })
      expect(mockClient.fundSwap).toHaveBeenCalledWith('swap-4', account)
      expect(mockClient.claim).not.toHaveBeenCalled()

      expect(result).toEqual({
        id: 'swap-4',
        hash: '0xfundtx',
        fromTokenAmount: 1000000n,
        toTokenAmount: 900n,
        fees: [{ type: 'protocol', amount: 20n, token: 'btc', chain: 'Bitcoin', included: true, description: 'Swap fee' }],
        transactions: [{ hash: '0xfundtx', chain: 42161, type: 'source' }]
      })
    })

    test('sends to a lightning address with an explicit sats amount', async () => {
      await protocol.swidge({
        fromToken: '42161:0xusdt0',
        toToken: 'Lightning:btc',
        recipient: 'user@speed.app',
        fromTokenAmount: 900n
      })

      expect(mockClient.createEvmToLightningSwapGeneric).toHaveBeenCalledWith({
        evmChainId: 42161,
        tokenAddress: '0xusdt0',
        userAddress: '0xEvmSigner',
        lightningAddress: 'user@speed.app',
        amountSats: 900
      })
    })

    test('throws for a lightning address without an amount', async () => {
      await expect(
        protocol.swidge({ fromToken: '42161:0xusdt0', toToken: 'Lightning:btc', recipient: 'user@speed.app' })
      ).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.createEvmToLightningSwapGeneric).not.toHaveBeenCalled()
    })
  })

  describe('swidge (Bitcoin <-> EVM, on-chain)', () => {
    test('Bitcoin -> EVM funds the on-chain HTLC and claims (gasless)', async () => {
      const account = {
        getAddress: jest.fn().mockResolvedValue('bc1qsource'),
        sendTransaction: jest.fn().mockResolvedValue({ hash: 'btcfundtx' })
      }
      protocol = new SatoraProtocol(account, { accountChains: ['Bitcoin'] })

      mockClient.createBitcoinToEvmSwap.mockResolvedValue({
        response: { id: 'swap-5', btc_htlc_address: 'bc1qhtlc', source_amount: '200000', target_amount: '116000000', fee_sats: 400 }
      })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xevmclaim', evm_chain_id: 42161 })

      const result = await protocol.swidge({
        fromToken: 'Bitcoin:btc', toToken: '42161:0xusdt0', fromTokenAmount: 200000n, recipient: '0xRecipient'
      })

      expect(mockClient.createBitcoinToEvmSwap).toHaveBeenCalledWith({
        targetAddress: '0xRecipient', tokenAddress: '0xusdt0', evmChainId: 42161, sourceAmount: 200000
      })
      expect(account.sendTransaction).toHaveBeenCalledWith({ to: 'bc1qhtlc', value: 200000n })
      expect(result.transactions).toEqual([
        { hash: 'btcfundtx', chain: 'Bitcoin', type: 'source' },
        { hash: '0xevmclaim', chain: 42161, type: 'destination' }
      ])
    })

    test('EVM -> Bitcoin funds via fundSwap and claims to the BTC address with a fee rate', async () => {
      const account = { address: '0xEvmSigner' }
      protocol = new SatoraProtocol(account, { accountChains: [42161], feeRateSatPerVb: 7 })

      mockClient.createEvmToBitcoinSwap.mockResolvedValue({
        response: { id: 'swap-6', source_amount: '1000000', target_amount: '1450', fee_sats: 30 }
      })
      mockClient.fundSwap.mockResolvedValue({ txHash: '0xfundtx' })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: 'btcclaimtx' })
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' })
        .mockResolvedValue({ status: 'serverredeemed', direction: 'evm_to_bitcoin', evm_chain_id: 42161, evm_fund_txid: '0xfundtx', btc_claim_txid: 'btcclaimtx' })

      const result = await protocol.swidge({
        fromToken: '42161:0xusdt0', toToken: 'Bitcoin:btc', fromTokenAmount: 1000000n, recipient: 'bc1qdest'
      })

      expect(mockClient.createEvmToBitcoinSwap).toHaveBeenCalledWith({
        targetAddress: 'bc1qdest', tokenAddress: '0xusdt0', evmChainId: 42161, userAddress: '0xEvmSigner', sourceAmount: 1000000n
      })
      expect(mockClient.fundSwap).toHaveBeenCalledWith('swap-6', account)
      expect(mockClient.claim).toHaveBeenCalledWith('swap-6', { destinationAddress: 'bc1qdest', feeRateSatPerVb: 7 })
      expect(result.transactions).toEqual([
        { hash: '0xfundtx', chain: 42161, type: 'source' },
        { hash: 'btcclaimtx', chain: 'Bitcoin', type: 'destination' }
      ])
    })
  })

  describe('getSwidgeStatus', () => {
    test('maps a settled swap to completed with source/destination transactions', async () => {
      mockClient.getSwap.mockResolvedValue({
        status: 'serverredeemed',
        btc_fund_txid: 'btcfund',
        evm_claim_txid: '0xevmclaim',
        evm_chain_id: 42161
      })

      const result = await protocol.getSwidgeStatus('swap-1')

      expect(mockClient.getSwap).toHaveBeenCalledWith('swap-1')
      expect(result).toEqual({
        status: 'completed',
        transactions: [
          { hash: 'btcfund', chain: 'Arkade', type: 'source' },
          { hash: '0xevmclaim', chain: 42161, type: 'destination' }
        ]
      })
    })

    test('maps in-flight and failure statuses, omitting absent transactions', async () => {
      const cases = [
        ['clientfunded', 'pending'],
        ['serverfunded', 'action-required'],
        ['clientredeemed', 'completed'],
        ['clientrefunded', 'refunded'],
        ['expired', 'expired'],
        ['serverwontfund', 'failed'],
        ['clientfundedtoolate', 'action-required'],
        ['clientredeemedandclientrefunded', 'completed']
      ]

      for (const [swapStatus, swidgeStatus] of cases) {
        mockClient.getSwap.mockResolvedValue({ status: swapStatus })
        const result = await protocol.getSwidgeStatus('swap-1')
        expect(result).toEqual({ status: swidgeStatus })
      }
    })

    test('falls back to pending for an unknown status', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'somethingnew' })
      const result = await protocol.getSwidgeStatus('swap-1')
      expect(result).toEqual({ status: 'pending' })
    })

    test('propagates the error when no swap exists for the id', async () => {
      mockClient.getSwap.mockRejectedValue(new Error('swap not found'))
      await expect(protocol.getSwidgeStatus('nope')).rejects.toThrow('swap not found')
    })
  })

  describe('resumeSwidge', () => {
    // resume needs no account — the claim goes to the swap's stored recipient.
    test('returns immediately when the swap is already settled', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xc', evm_chain_id: 42161 })

      const result = await protocol.resumeSwidge('swap-1')

      expect(result).toEqual({
        id: 'swap-1',
        status: 'completed',
        transactions: [{ hash: '0xc', chain: 42161, type: 'destination' }]
      })
      expect(mockClient.claim).not.toHaveBeenCalled()
    })

    test('drives an in-flight swap to completion (claim + settle)', async () => {
      mockClient.getSwap
        .mockResolvedValueOnce({ status: 'serverfunded' }) // initial
        .mockResolvedValueOnce({ status: 'serverfunded' }) // wait for server-funded
        .mockResolvedValue({ status: 'serverredeemed', evm_claim_txid: '0xc', evm_chain_id: 42161 })
      mockClient.claim.mockResolvedValue({ success: true, message: 'ok', txHash: '0xclaim' })

      const result = await protocol.resumeSwidge('swap-1')

      expect(mockClient.claim).toHaveBeenCalledWith('swap-1', undefined)
      expect(result.status).toBe('completed')
    })

    test('throws when the swap cannot complete', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'expired' })

      await expect(protocol.resumeSwidge('swap-1')).rejects.toThrow(/expired/)
      expect(mockClient.claim).not.toHaveBeenCalled()
    })
  })

  describe('refundSwidge', () => {
    let account

    beforeEach(() => {
      account = { getAddress: jest.fn().mockResolvedValue('ark1qsource') }
      protocol = new SatoraProtocol(account)
    })

    test('throws if no account is bound (needed to receive the refund)', async () => {
      const noAccount = new SatoraProtocol()
      await expect(noAccount.refundSwidge('swap-1')).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
    })

    test('refunds to the account address by default', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: true, message: 'refunded', txId: 'btcrefund' })
      mockClient.getSwap.mockResolvedValue({ status: 'clientrefunded' })

      const result = await protocol.refundSwidge('swap-1')

      expect(mockClient.refundSwap).toHaveBeenCalledWith('swap-1', { destinationAddress: 'ark1qsource' })
      expect(result.status).toBe('refunded')
      expect(result.message).toBe('refunded')
      expect(result.transactions).toContainEqual({ hash: 'btcrefund', type: 'refund' })
    })

    test('merges caller options over the default destination address', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: true, message: 'ok' })
      mockClient.getSwap.mockResolvedValue({ status: 'clientrefunded' })

      await protocol.refundSwidge('swap-1', { destinationAddress: 'ark1qother' })

      expect(mockClient.refundSwap).toHaveBeenCalledWith('swap-1', { destinationAddress: 'ark1qother' })
    })

    test('throws when the refund is not successful', async () => {
      mockClient.refundSwap.mockResolvedValue({ success: false, message: 'too early to refund' })
      mockClient.getSwap.mockResolvedValue({ status: 'serverfunded' })

      await expect(protocol.refundSwidge('swap-1')).rejects.toThrow('too early to refund')
    })

    test('EVM-sourced swap refunds via the collaborative signer path (gasless, swap-back)', async () => {
      const evmAccount = { address: '0xEvmSigner' }
      protocol = new SatoraProtocol(evmAccount)
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'evm_to_bitcoin', evm_chain_id: 42161 })
      mockClient.collabRefundEvmWithSigner.mockResolvedValue({ txHash: '0xrefundtx' })

      const result = await protocol.refundSwidge('swap-1')

      expect(mockClient.collabRefundEvmWithSigner).toHaveBeenCalledWith('swap-1', evmAccount, 'swap-back')
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
      expect(result.status).toBe('refunded')
      expect(result.transactions).toContainEqual({ hash: '0xrefundtx', chain: 42161, type: 'refund' })
    })

    test('EVM-sourced refund honours options.manual and options.settlement', async () => {
      const evmAccount = { address: '0xEvmSigner' }
      protocol = new SatoraProtocol(evmAccount)
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'evm_to_arkade', evm_chain_id: 42161 })
      mockClient.refundEvmWithSigner.mockResolvedValue({ txHash: '0xrefundtx' })

      await protocol.refundSwidge('swap-1', { manual: true, settlement: 'direct' })

      expect(mockClient.refundEvmWithSigner).toHaveBeenCalledWith('swap-1', evmAccount, 'direct')
      expect(mockClient.collabRefundEvmWithSigner).not.toHaveBeenCalled()
    })

    test('Lightning-sourced swap cannot be refunded', async () => {
      mockClient.getSwap.mockResolvedValue({ status: 'expired', direction: 'lightning_to_evm' })

      await expect(protocol.refundSwidge('swap-1')).rejects.toThrow(SatoraInvalidOptionsError)
      expect(mockClient.refundSwap).not.toHaveBeenCalled()
      expect(mockClient.collabRefundEvmWithSigner).not.toHaveBeenCalled()
    })
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
