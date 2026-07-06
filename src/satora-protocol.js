// Copyright 2026 bonomat &lt;philipp@lendasat.com&gt;
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols'
import { Client } from '@satora/swap'

import { toChainId, toSupportedChain } from './chains.js'
import { parseTokenId, toSupportedToken } from './tokens.js'
import { SatoraInvalidOptionsError } from './errors.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */

/** @typedef {import('@satora/swap').Client} SatoraClient */
/** @typedef {import('@satora/swap').EvmSigner} EvmSigner */

/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number} [defaultSlippage] - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
 * @property {string} [baseUrl] - Override the satora API base URL. Defaults to the SDK's production endpoint.
 * @property {string} [mnemonic] - BIP39 mnemonic for the swap client's secret material (HTLC preimage + gasless-claim key). Separate from the funding account. Not required for read-only operations (chains, tokens, quotes).
 * @property {string} [arkadeServerUrl] - Override the Arkade server URL.
 * @property {string} [esploraUrl] - Override the Esplora (Bitcoin) API URL.
 * @property {Object} [signerStorage] - A satora `WalletStorage` adapter persisting the seed / key index (the swap client's database). Recommended for fund-moving operations so an interrupted swap survives a restart. Omit for in-memory (not recoverable across restarts).
 * @property {Object} [swapStorage] - A satora `SwapStorage` adapter persisting per-swap state for recovery/refund.
 * @property {(string | number)[]} [accountChains] - The chains the provided wallet account can fund/operate on (e.g. ['Arkade'] for an Arkade wallet, or [1, 137, 42161] for an EVM wallet). When set, `swidge` validates that the source chain is one of these.
 */

export default class SatoraProtocol extends SwidgeProtocol {
  /**
   * Creates a new satora swidge protocol without binding it to a wallet account.
   *
   * @overload
   * @param {undefined} [account] - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */

  /**
   * Creates a new read-only satora swidge protocol.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */

  /**
   * Creates a new satora swidge protocol.
   *
   * @overload
   * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */
  constructor (account, config = {}) {
    super(account, config)

    /**
     * The satora protocol configuration.
     *
     * @protected
     * @type {SatoraProtocolConfig}
     */
    this._config = config

    /**
     * The lazily-constructed satora swap client.
     *
     * @private
     * @type {Promise<SatoraClient> | undefined}
     */
    this._clientPromise = undefined
  }

  /**
   * Lazily constructs (and memoizes) the underlying satora swap client.
   * Read-only operations build a stateless client; a mnemonic is only
   * required for fund-moving operations.
   *
   * @protected
   * @returns {Promise<SatoraClient>} The satora swap client.
   */
  async _getClient () {
    if (!this._clientPromise) {
      let builder = Client.builder()
      if (this._config.baseUrl) builder = builder.withBaseUrl(this._config.baseUrl)
      if (this._config.arkadeServerUrl) builder = builder.withArkadeServerUrl(this._config.arkadeServerUrl)
      if (this._config.esploraUrl) builder = builder.withEsploraUrl(this._config.esploraUrl)
      if (this._config.signerStorage) builder = builder.withSignerStorage(this._config.signerStorage)
      if (this._config.swapStorage) builder = builder.withSwapStorage(this._config.swapStorage)
      if (this._config.mnemonic) builder = builder.withMnemonic(this._config.mnemonic)
      this._clientPromise = builder.build()
    }
    return this._clientPromise
  }

  /**
   * Quotes the estimated costs and output of a swidge operation.
   * Returns a non-binding quote; the actual execution is performed
   * by {@link swidge}.
   *
   * The source and destination chains are taken from the chain-qualified
   * `fromToken`/`toToken` identifiers (`chain:tokenId`, e.g. '137:0x...' or
   * 'Bitcoin:btc'), as returned by {@link getSupportedTokens}.
   *
   * @param {SwidgeOptions} options - The swidge options.
   * @returns {Promise<SwidgeQuote>} The quoted swidge details.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If `fromToken` is not chain-qualified or no amount is given.
   */
  async quoteSwidge (options) {
    const source = parseTokenId(options.fromToken)
    if (source.chain === undefined) {
      throw new SatoraInvalidOptionsError(
        'fromToken must be chain-qualified, e.g. "137:0x..." or "Bitcoin:btc"'
      )
    }

    const target = parseTokenId(options.toToken)
    // The destination chain comes from the token; falling back to the toChain
    // option, then to the source chain (a same-chain swap).
    const targetChain = target.chain ??
      (options.toChain !== undefined && options.toChain !== null ? String(options.toChain) : source.chain)

    const params = {
      sourceChain: source.chain,
      sourceToken: source.tokenId,
      targetChain,
      targetToken: target.tokenId
    }

    if (options.fromTokenAmount !== undefined && options.fromTokenAmount !== null) {
      params.sourceAmount = Number(options.fromTokenAmount)
    } else if (options.toTokenAmount !== undefined && options.toTokenAmount !== null) {
      params.targetAmount = Number(options.toTokenAmount)
    } else {
      throw new SatoraInvalidOptionsError(
        'either fromTokenAmount (exact-in) or toTokenAmount (exact-out) is required'
      )
    }

    const client = await this._getClient()
    const quote = await client.getQuote(params)

    const toTokenAmount = BigInt(quote.net_target_amount)
    const slippage = options.slippage ?? this._config.defaultSlippage ?? 0

    return {
      fromTokenAmount: BigInt(quote.net_source_amount),
      toTokenAmount,
      toTokenAmountMin: applySlippage(toTokenAmount, slippage),
      fees: toSwidgeFees(quote)
    }
  }

  /**
   * Executes a swidge operation, driving the full atomic-swap flow to
   * completion (one-shot): create the swap, fund the source HTLC from the
   * wallet account, wait for the server to lock the destination, claim, and
   * wait for settlement.
   *
   * Implemented directions:
   * - **Arkade -> EVM**: the account (an Arkade wallet) funds the Arkade VHTLC
   *   via `sendTransaction`; the EVM tokens are claimed gaslessly to
   *   `options.recipient` (the EVM destination).
   * - **EVM -> Arkade**: the account (an {@link EvmSigner}) funds the EVM HTLC
   *   via `client.fundSwap`; the BTC is claimed to `options.recipient` (the
   *   Arkade destination).
   *
   * Because the account is the source wallet, `options.recipient` (on the
   * destination chain) is always required.
   *
   * @param {SwidgeOptions} options - The swidge options (chain-qualified fromToken/toToken).
   * @param {SwidgeProtocolConfig} [config] - Optional provider-specific execution configuration.
   * @returns {Promise<SwidgeResult>} The swidge execution result.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If the account, direction, recipient, or amount is invalid.
   * @throws {Error} If the swap is refunded, expires, or times out.
   */
  async swidge (options, config) {
    const account = this._account
    if (!account) {
      throw new SatoraInvalidOptionsError('swidge requires a wallet account to fund the swap')
    }

    const source = parseTokenId(options.fromToken)
    const target = parseTokenId(options.toToken)
    const targetChain = target.chain ??
      (options.toChain !== undefined && options.toChain !== null ? String(options.toChain) : source.chain)

    const recipient = options.recipient
    if (!recipient) {
      throw new SatoraInvalidOptionsError(
        'swidge requires options.recipient (the destination address); the account is the source wallet'
      )
    }

    // The account funds the source side, so it must operate on the source chain.
    // WDK accounts expose no chain id, so the caller declares the account's
    // chains via config.accountChains; when set, the source chain must be one.
    if (this._config.accountChains) {
      const supported = new Set(this._config.accountChains.map(chain => String(chain)))
      if (!supported.has(String(source.chain))) {
        throw new SatoraInvalidOptionsError(
          `the account does not support the source chain "${source.chain}" (accountChains: ${this._config.accountChains.join(', ')})`
        )
      }
    }

    const client = await this._getClient()

    if (source.chain === 'Arkade' && isEvmChain(targetChain)) {
      return this._swidgeArkadeToEvm(client, account, { target, targetChain, recipient, options })
    }
    if (source.chain === 'Lightning' && isEvmChain(targetChain)) {
      return this._swidgeLightningToEvm(client, account, { target, targetChain, recipient, options })
    }
    if (isEvmChain(source.chain) && target.chain === 'Arkade') {
      return this._swidgeEvmToArkade(client, account, { source, recipient, options })
    }
    if (isEvmChain(source.chain) && target.chain === 'Lightning') {
      return this._swidgeEvmToLightning(client, account, { source, recipient, options })
    }

    throw new SatoraInvalidOptionsError(
      `unsupported swidge direction ${source.chain ?? '?'} -> ${targetChain}; ` +
      'only Arkade -> EVM, Lightning -> EVM, EVM -> Arkade, and EVM -> Lightning are implemented'
    )
  }

  /**
   * Executes an Arkade -> EVM swap: create, fund the Arkade VHTLC from the
   * account, then complete. See {@link swidge}.
   *
   * @private
   */
  async _swidgeArkadeToEvm (client, account, { target, targetChain, recipient, options }) {
    if (typeof account.sendTransaction !== 'function') {
      throw new SatoraInvalidOptionsError('Arkade -> EVM swidge requires an Arkade wallet account (with sendTransaction)')
    }
    requireFromAmount(options, 'Arkade -> EVM')

    const { response } = await client.createArkadeToEvmSwapGeneric({
      targetAddress: recipient,
      tokenAddress: target.tokenId,
      evmChainId: Number(targetChain),
      sourceAmount: BigInt(options.fromTokenAmount)
    })

    const id = response.id
    const fromTokenAmount = BigInt(response.source_amount)
    const toTokenAmount = BigInt(response.target_amount)

    // Fund the Arkade VHTLC from the source account.
    const funding = await account.sendTransaction({ to: response.btc_vhtlc_address, value: fromTokenAmount })

    const { swap: final, claim } = await this._completeSwap(client, id)

    const claimTx = final.evm_claim_txid ?? claim.txHash
    const transactions = [{ hash: funding.hash, chain: 'Arkade', type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: Number(targetChain), type: 'destination' })

    return { id, hash: claimTx ?? funding.hash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount }
  }

  /**
   * Executes a Lightning -> EVM swap: create, pay the returned BOLT11 invoice
   * from the account, then complete. The invoice is a hold invoice that only
   * settles once the swap reveals the preimage (during claim), so the payment
   * runs concurrently with completion. See {@link swidge}.
   *
   * @private
   */
  async _swidgeLightningToEvm (client, account, { target, targetChain, recipient, options }) {
    if (typeof account.payInvoice !== 'function') {
      throw new SatoraInvalidOptionsError('Lightning -> EVM swidge requires a Lightning wallet account (with payInvoice)')
    }
    requireFromAmount(options, 'Lightning -> EVM')

    const { response } = await client.createLightningToEvmSwapGeneric({
      targetAddress: recipient,
      evmChainId: Number(targetChain),
      tokenAddress: target.tokenId,
      amountIn: Number(options.fromTokenAmount)
    })

    const id = response.id
    const fromTokenAmount = BigInt(response.source_amount)
    const toTokenAmount = BigInt(response.target_amount)

    // Pay the hold invoice concurrently with completion: the invoice only
    // settles once the swap reveals the preimage (during claim), so awaiting it
    // before _completeSwap would deadlock — but both must succeed. Promise.all
    // also surfaces a payment failure (e.g. insufficient funds) promptly instead
    // of letting _completeSwap poll until it times out.
    const payment = Promise.resolve()
      .then(() => account.payInvoice(response.bolt11_invoice))
      .catch(err => { throw new Error(`lightning payment failed: ${err?.message ?? err}`) })

    const [{ swap: final, claim }] = await Promise.all([this._completeSwap(client, id), payment])

    const claimTx = final.evm_claim_txid ?? claim.txHash
    const transactions = []
    if (claimTx) transactions.push({ hash: claimTx, chain: Number(targetChain), type: 'destination' })

    return { id, hash: claimTx, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount }
  }

  /**
   * Executes an EVM -> Arkade swap: create, fund the EVM HTLC from the account
   * (an {@link EvmSigner}) via `client.fundSwap`, then complete. See
   * {@link swidge}.
   *
   * @private
   */
  async _swidgeEvmToArkade (client, account, { source, recipient, options }) {
    if (!account.address) {
      throw new SatoraInvalidOptionsError('EVM -> Arkade swidge requires an EvmSigner account (with .address)')
    }
    requireFromAmount(options, 'EVM -> Arkade')

    const { response } = await client.createEvmToArkadeSwapGeneric({
      targetAddress: recipient,
      tokenAddress: source.tokenId,
      evmChainId: Number(source.chain),
      userAddress: account.address,
      sourceAmount: BigInt(options.fromTokenAmount)
    })

    const id = response.id
    const fromTokenAmount = BigInt(response.source_amount)
    const toTokenAmount = BigInt(response.target_amount)

    // Fund the EVM HTLC from the EvmSigner (token approval + deposit).
    const { txHash } = await client.fundSwap(id, account)

    const { swap: final } = await this._completeSwap(client, id)

    const claimTx = final.btc_claim_txid
    const transactions = [{ hash: txHash, chain: Number(source.chain), type: 'source' }]
    if (claimTx) transactions.push({ hash: claimTx, chain: 'Arkade', type: 'destination' })

    return { id, hash: claimTx ?? txHash, fees: swapFee(response.fee_sats), transactions, fromTokenAmount, toTokenAmount }
  }

  /**
   * Executes an EVM -> Lightning swap: create against the recipient's Lightning
   * invoice (or address), fund the EVM HTLC from the account (an
   * {@link EvmSigner}), then wait for settlement. The server pays the lightning invoice
   * and claims the EVM HTLC, so there is no client claim. See {@link swidge}.
   *
   * @private
   */
  async _swidgeEvmToLightning (client, account, { source, recipient, options }) {
    if (!account.address) {
      throw new SatoraInvalidOptionsError('EVM -> Lightning swidge requires an EvmSigner account (with .address)')
    }

    const { response } = await client.createEvmToLightningSwapGeneric({
      evmChainId: Number(source.chain),
      tokenAddress: source.tokenId,
      userAddress: account.address,
      ...lightningDestination(recipient, options)
    })

    const id = response.id
    const fromTokenAmount = BigInt(response.source_amount)
    const toTokenAmount = BigInt(response.target_amount)

    // Fund the EVM HTLC from the EvmSigner. The server then pays the Lightning
    // invoice and claims the EVM HTLC — there is no client claim, so just wait
    // for the swap to settle.
    const { txHash } = await client.fundSwap(id, account)
    await this._waitForSwapStatus(client, id, TERMINAL_SUCCESS_STATES, TERMINAL_FAIL_STATES)

    return {
      id,
      hash: txHash,
      fees: swapFee(response.fee_sats),
      transactions: [{ hash: txHash, chain: Number(source.chain), type: 'source' }],
      fromTokenAmount,
      toTokenAmount
    }
  }

  /**
   * Polls a swap's status until it reaches one of `targets`, throwing if it
   * reaches a failure state or the timeout elapses.
   *
   * @private
   * @param {SatoraClient} client - The satora swap client.
   * @param {string} id - The swap id.
   * @param {string[]} targets - Status values that resolve the wait.
   * @param {string[]} failStates - Status values that reject the wait.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [opts] - Timing options.
   * @returns {Promise<Object>} The swap once it reaches a target status.
   */
  async _waitForSwapStatus (client, id, targets, failStates, { timeoutMs = 600000, intervalMs = 3000 } = {}) {
    const target = new Set(targets)
    const fail = new Set(failStates)
    const deadline = Date.now() + timeoutMs

    while (true) {
      const swap = await client.getSwap(id)
      if (target.has(swap.status)) return swap
      if (fail.has(swap.status)) {
        throw new Error(`satora swap ${id} failed with status "${swap.status}"`)
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for satora swap ${id} to reach ${targets.join('/')} (last status "${swap.status}")`)
      }
      await sleep(intervalMs)
    }
  }

  /**
   * Drives an already-funded swap to settlement: waits for the destination to
   * be locked, claims (gaslessly), and waits for the atomic swap to settle.
   * Shared by {@link swidge} and {@link resumeSwidge}.
   *
   * @private
   * @param {SatoraClient} client - The satora swap client.
   * @param {string} id - The swap id.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [waitOpts] - Polling overrides.
   * @returns {Promise<{ swap: Object, claim: Object }>} The settled swap and the claim result.
   * @throws {Error} If the claim fails or the swap reaches a failure state.
   */
  async _completeSwap (client, id, waitOpts = {}) {
    await this._waitForSwapStatus(client, id, SERVER_FUNDED_STATES, FUND_FAIL_STATES, waitOpts)

    const claim = await client.claim(id)
    if (!claim.success) {
      throw new Error(`satora claim failed for swap ${id}: ${claim.message}`)
    }

    const swap = await this._waitForSwapStatus(client, id, TERMINAL_SUCCESS_STATES, TERMINAL_FAIL_STATES, waitOpts)
    return { swap, claim }
  }

  /**
   * Retrieves the current status of an in-flight swidge.
   *
   * @param {string} id - The swidge execution identifier returned by swidge.
   * @param {SwidgeStatusOptions} [options] - Optional hints to assist provider lookups.
   * @returns {Promise<SwidgeStatusResult>} The current swidge status.
   * @throws {Error} If the id is invalid, or no swidge exists with the given identifier.
   */
  async getSwidgeStatus (id, options) {
    const client = await this._getClient()
    const swap = await client.getSwap(id)

    const result = { status: toSwidgeStatus(swap.status) }
    const transactions = toSwidgeTransactions(swap)
    if (transactions.length > 0) result.transactions = transactions

    return result
  }

  /**
   * Resumes a persisted swap, driving it to completion: waits for the
   * destination to be locked, claims (gaslessly, to the swap's stored
   * recipient), and settles. Throws if the swap cannot complete (e.g. it
   * expired or was refunded).
   *
   * This is a recovery operation for a swap interrupted after {@link swidge}
   * created and funded it (e.g. the process died mid-flight). It is driven by
   * the swap client's persisted secret (mnemonic + storage); no account is
   * needed, since the claim goes to the recipient recorded on the swap.
   *
   * @param {string} id - The swap id.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [options] - Polling overrides.
   * @returns {Promise<SwidgeStatusResult & { id: string }>} The 'completed' status and transactions.
   * @throws {Error} If the swap cannot be completed.
   */
  async resumeSwidge (id, options = {}) {
    const client = await this._getClient()

    const waitOpts = {}
    if (options.timeoutMs !== undefined) waitOpts.timeoutMs = options.timeoutMs
    if (options.intervalMs !== undefined) waitOpts.intervalMs = options.intervalMs

    const existing = await client.getSwap(id)

    // Already settled — nothing to resume.
    if (toSwidgeStatus(existing.status) === 'completed') {
      return { id, status: 'completed', transactions: toSwidgeTransactions(existing) }
    }

    const { swap } = await this._completeSwap(client, id, waitOpts)
    return { id, status: 'completed', transactions: toSwidgeTransactions(swap) }
  }

  /**
   * Refunds a swap that can no longer complete, reclaiming the source funds to
   * the account's address. Use this when {@link resumeSwidge} throws.
   *
   * Requires an account: the reclaimed funds are returned to its address (the
   * default `destinationAddress`). For Arkade -> EVM the refund is an off-chain
   * Arkade-server operation.
   *
   * @param {string} id - The swap id.
   * @param {Object} [options] - SDK refund options, merged over the default `destinationAddress` (the account address).
   * @returns {Promise<SwidgeStatusResult & { id: string, message?: string }>} The 'refunded' status and transactions.
   * @throws {import('./errors.js').SatoraInvalidOptionsError} If no account is bound.
   * @throws {Error} If the swap cannot be refunded.
   */
  async refundSwidge (id, options = {}) {
    const account = this._account
    if (!account || typeof account.getAddress !== 'function') {
      throw new SatoraInvalidOptionsError('refund requires a wallet account to receive the refund')
    }

    const client = await this._getClient()

    const refundOptions = { destinationAddress: await account.getAddress(), ...options }
    // TODO: we should check if refund is available and throw otherwise. This
    // should be provided upstream in the SDK.
    const refund = await client.refundSwap(id, refundOptions)
    const swap = await client.getSwap(id, { updateStorage: true })

    if (!refund.success) {
      throw new Error(`swap ${id} could not be refunded (status "${swap.status}"): ${refund.message}`)
    }

    const transactions = toSwidgeTransactions(swap)
    if (refund.txId) transactions.push({ hash: refund.txId, type: 'refund' })

    return { id, status: 'refunded', transactions, message: refund.message }
  }

  /**
   * Retrieves the chains supported by the provider for swidge operations.
   *
   * @returns {Promise<SwidgeSupportedChain[]>} The supported chains.
   */
  async getSupportedChains () {
    const client = await this._getClient()
    const { pairs } = await client.getSwapPairs()

    const chains = new Map()
    for (const { source, target } of pairs) {
      for (const sdkChain of [source, target]) {
        if (!chains.has(sdkChain)) chains.set(sdkChain, toSupportedChain(sdkChain))
      }
    }

    return [...chains.values()]
  }

  /**
   * Retrieves the tokens supported by the provider for swidge operations.
   *
   * @param {SwidgeSupportedTokensOptions} [options] - Optional filters for chain- or route-scoped token discovery.
   * @returns {Promise<SwidgeSupportedToken[]>} The supported tokens.
   */
  async getSupportedTokens (options = {}) {
    const client = await this._getClient()
    const { btc_tokens: btcTokens, evm_tokens: evmTokens } = await client.getTokens()

    const tokens = [...btcTokens, ...evmTokens].map(toSupportedToken)

    // Route-scoped discovery (best effort): satora's token catalogue is not
    // route-aware, so when fromChain/toChain are supplied we narrow the result
    // to tokens on those chains. fromToken cannot be applied with the available
    // API and is ignored.
    const chainFilter = [options.fromChain, options.toChain]
      .filter(chain => chain !== undefined && chain !== null)
      .map(chain => String(toChainId(chain)))

    if (chainFilter.length === 0) return tokens

    const allowed = new Set(chainFilter)
    return tokens.filter(token => allowed.has(String(token.chain)))
  }
}

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeFee} SwidgeFee */

// Satora prices everything in BTC terms, so all quoted fees are in satoshis and
// denominated in the native BTC token.
const FEE_TOKEN = 'btc'
const FEE_CHAIN = 'Bitcoin'

// Swap status groupings for driving the Arkade -> EVM flow (satora SwapStatus
// state machine).
const SERVER_FUNDED_STATES = ['serverfunded']
const FUND_FAIL_STATES = ['expired', 'clientrefunded', 'clientfundedserverrefunded', 'serverwontfund', 'clientfundedtoolate', 'clientinvalidfunded', 'clientredeemedandclientrefunded']
const TERMINAL_SUCCESS_STATES = ['serverredeemed', 'clientredeemed']
const TERMINAL_FAIL_STATES = ['expired', 'clientrefunded', 'clientfundedserverrefunded', 'clientrefundedserverfunded', 'clientrefundedserverrefunded', 'clientredeemedandclientrefunded']

// Maps the satora SwapStatus state machine onto the WDK SwidgeStatus vocabulary.
const SWAP_STATUS_TO_SWIDGE = {
  pending: 'pending',
  clientfundingseen: 'pending',
  clientfunded: 'pending',
  serverfunded: 'action-required', // destination locked; the client must claim to receive
  clientredeeming: 'pending',
  clientredeemed: 'completed',
  serverredeemed: 'completed',
  clientrefunded: 'refunded',
  clientfundedserverrefunded: 'refunded',
  clientrefundedserverfunded: 'refunded',
  clientrefundedserverrefunded: 'refunded',
  expired: 'expired',
  clientinvalidfunded: 'action-required', // client needs to refund
  clientfundedtoolate: 'action-required', // client needs to refund
  serverwontfund: 'failed',
  clientredeemedandclientrefunded: 'completed'
}

/**
 * Maps a satora swap status to a WDK swidge status. Unknown statuses fall back
 * to 'pending' so an in-flight swap is never misreported as terminal.
 *
 * @param {string} status - The satora swap status.
 * @returns {import('@tetherto/wdk-wallet/protocols').SwidgeStatus} The WDK swidge status.
 */
function toSwidgeStatus (status) {
  return SWAP_STATUS_TO_SWIDGE[status] ?? 'pending'
}

/**
 * Extracts the user-facing source/destination transactions from a satora swap,
 * best effort. Which txids are the source vs destination depends on the swap
 * direction (arkade funds via BTC, EVM funds via the HTLC contract); defaults
 * to the Arkade -> EVM layout when `direction` is absent.
 *
 * @param {Object} swap - The satora swap (GetSwapResponse).
 * @returns {import('@tetherto/wdk-wallet/protocols').SwidgeTransaction[]} The transactions.
 */
function toSwidgeTransactions (swap) {
  const transactions = []
  if (swap.direction === 'evm_to_arkade') {
    if (swap.evm_fund_txid) transactions.push({ hash: swap.evm_fund_txid, chain: swap.evm_chain_id, type: 'source' })
    if (swap.btc_claim_txid) transactions.push({ hash: swap.btc_claim_txid, chain: 'Arkade', type: 'destination' })
  } else {
    if (swap.btc_fund_txid) transactions.push({ hash: swap.btc_fund_txid, chain: 'Arkade', type: 'source' })
    if (swap.evm_claim_txid) transactions.push({ hash: swap.evm_claim_txid, chain: swap.evm_chain_id, type: 'destination' })
  }
  return transactions
}

/**
 * Throws unless `fromTokenAmount` (an exact-in source amount) is present.
 *
 * @param {SwidgeOptions} options - The swidge options.
 * @param {string} direction - The direction label, for the error message.
 */
function requireFromAmount (options, direction) {
  if (options.fromTokenAmount === undefined || options.fromTokenAmount === null) {
    throw new SatoraInvalidOptionsError(`${direction} swidge requires fromTokenAmount (exact-in)`)
  }
}

/**
 * Resolves a Lightning destination from `options.recipient` into the shape the
 * SDK expects: a BOLT11 invoice (amount carried by the invoice), a lightning
 * address, or an LNURL (the latter two require an amount in sats from
 * `fromTokenAmount`).
 *
 * @param {string} recipient - The BOLT11 invoice, lightning address, or LNURL.
 * @param {SwidgeOptions} options - The swidge options.
 * @returns {{ lightningInvoice: string } | { lightningAddress: string, amountSats: number } | { lnurl: string, amountSats: number }}
 */
function lightningDestination (recipient, options) {
  if (/^ln(bc|tb|bcrt)/i.test(recipient)) {
    return { lightningInvoice: recipient }
  }

  if (options.fromTokenAmount === undefined || options.fromTokenAmount === null) {
    throw new SatoraInvalidOptionsError(
      'a lightning address / LNURL destination requires an amount in sats (fromTokenAmount)'
    )
  }
  const amountSats = Number(options.fromTokenAmount)

  if (/^lnurl/i.test(recipient)) return { lnurl: recipient, amountSats }
  return { lightningAddress: recipient, amountSats }
}

/**
 * Builds the itemised WDK fee list from a swap's `fee_sats` (satora prices the
 * swap fee in satoshis, denominated in BTC).
 *
 * @param {number|string} feeSats - The swap fee in satoshis.
 * @returns {SwidgeFee[]} The fees.
 */
function swapFee (feeSats) {
  return [{
    type: 'protocol',
    amount: BigInt(feeSats),
    token: FEE_TOKEN,
    chain: FEE_CHAIN,
    included: true,
    description: 'Swap fee'
  }]
}

/**
 * Resolves after `ms` milliseconds.
 *
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>}
 */
function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Returns true if the chain identifier is an EVM chain (a numeric id).
 *
 * @param {string | number} chain - The chain identifier.
 * @returns {boolean}
 */
function isEvmChain (chain) {
  return Number.isInteger(Number(chain))
}

/**
 * Reduces an amount by a slippage tolerance using basis-point integer math.
 *
 * @param {bigint} amount - The amount in base units.
 * @param {number} slippage - The slippage as a decimal (e.g. 0.01 for 1%).
 * @returns {bigint} The amount after applying slippage.
 */
function applySlippage (amount, slippage) {
  if (!slippage || slippage <= 0) return amount
  const bps = BigInt(Math.round(slippage * 10000))
  return amount - (amount * bps) / 10000n
}

/**
 * Maps a satora quote response to the itemised WDK fee breakdown. The satora
 * `net_source_amount`/`net_target_amount` already account for fees, so each fee
 * is reported with `included: true`.
 *
 * @param {Object} quote - The satora quote response.
 * @returns {SwidgeFee[]} The itemised fees.
 */
function toSwidgeFees (quote) {
  const fees = [
    {
      type: 'protocol',
      amount: BigInt(quote.protocol_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: `Protocol fee (rate ${quote.protocol_fee_rate})`
    },
    {
      type: 'network',
      amount: BigInt(quote.network_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: 'Network fee (HTLC create/claim + BTC mining)'
    }
  ]

  if (quote.gasless_network_fee) {
    fees.push({
      type: 'network',
      amount: BigInt(quote.gasless_network_fee),
      token: FEE_TOKEN,
      chain: FEE_CHAIN,
      included: true,
      description: 'Gasless DEX execution gas'
    })
  }

  return fees
}
