// Copyright 2026 bonomat <philipp@lendasat.com>
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

import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols'
import {
  Client,
  Asset,
  InMemoryWalletStorage,
  InMemorySwapStorage,
  toChain
} from '@lendasat/lendaswap-sdk-pure'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */

/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeOptions} BridgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */

/** @typedef {import('@lendasat/lendaswap-sdk-pure').Chain} Chain */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').Asset} LendaswapAsset */

/** @typedef {import('@lendasat/lendaswap-sdk-pure').WalletStorage} WalletStorage */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').SwapStorage} SwapStorage */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').GetSwapResponse} GetSwapResponse */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').ClaimResult} ClaimResult */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').RefundResult} RefundResult */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').StoredSwap} StoredSwap */

/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number | bigint} [bridgeMaxFee] - The maximum fee amount for bridge operations.
 * @property {string} [apiKey] - Lendaswap API key.
 * @property {string} [mnemonic] - BIP39 mnemonic for lendaswap key derivation. If omitted, a new one is generated.
 * @property {string} [baseUrl] - Lendaswap API base URL. Defaults to 'https://api.lendaswap.com/'.
 * @property {string} [esploraUrl] - Bitcoin esplora API URL. Defaults to 'https://mempool.space/api'.
 * @property {WalletStorage} [walletStorage] - Wallet storage backend. Defaults to InMemoryWalletStorage.
 * @property {SwapStorage} [swapStorage] - Swap storage backend. Defaults to InMemorySwapStorage.
 * @property {string} [referralCode] - Optional referral code for fee exemption.
 */

/**
 * Extended bridge options that allow specifying the source chain and token.
 *
 * @typedef {BridgeOptions & SatoraBridgeExtra} SatoraBridgeOptions
 */

/**
 * @typedef {Object} SatoraBridgeExtra
 * @property {string} sourceChain - The source blockchain (e.g. "bitcoin", "lightning", "arkade").
 * @property {string} [sourceToken] - The source token identifier. Defaults to "btc".
 */

/**
 * @typedef {Object} SatoraBridgeResult
 * @property {string} hash - The swap ID.
 * @property {bigint} fee - Network fee in satoshis.
 * @property {bigint} bridgeFee - Protocol fee in satoshis.
 * @property {string} [depositAddress] - Bitcoin HTLC address to send BTC to (on-chain swaps).
 * @property {string} [lightningInvoice] - Lightning invoice to pay (Lightning swaps).
 * @property {bigint} depositAmount - Exact amount in satoshis to send.
 * @property {string} targetAmount - Amount of target token the user will receive (in smallest unit).
 */

/**
 * @typedef {Object} ClaimOptions
 * @property {string} [destinationAddress] - BTC refund address (for error recovery).
 * @property {number} [feeRateSatPerVb] - Fee rate for on-chain claim. Defaults to 2.
 */

/**
 * @typedef {Object} RefundOptions
 * @property {string} destinationAddress - BTC address to receive refunded funds.
 * @property {number} [feeRateSatPerVb] - Fee rate for on-chain refund. Defaults to 2.
 */

export default class SatoraProtocolBitcoin extends BridgeProtocol {
  /**
   * Creates a new read-only interface to the satora protocol for the bitcoin blockchain.
   *
   * @overload
   * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
   * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
   */

  /**
   * Creates a new interface to the satora protocol for the bitcoin blockchain.
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
     * Lazily initialized lendaswap client.
     *
     * @private
     * @type {import('@lendasat/lendaswap-sdk-pure').Client | null}
     */
    this._client = null

    /**
     * Promise that resolves when the client is ready.
     *
     * @private
     * @type {Promise<import('@lendasat/lendaswap-sdk-pure').Client> | null}
     */
    this._clientPromise = null
  }

  /**
   * Returns the initialized lendaswap Client, creating it on first call.
   *
   * @private
   * @returns {Promise<import('@lendasat/lendaswap-sdk-pure').Client>}
   */
  async _getClient () {
    if (this._client) return this._client

    if (!this._clientPromise) {
      this._clientPromise = this._buildClient()
    }

    this._client = await this._clientPromise
    return this._client
  }

  /**
   * Builds the lendaswap Client from config.
   *
   * @private
   * @returns {Promise<import('@lendasat/lendaswap-sdk-pure').Client>}
   */
  async _buildClient () {
    const {
      apiKey,
      mnemonic,
      baseUrl = 'https://api.lendaswap.com/',
      esploraUrl = 'https://mempool.space/api',
      walletStorage = new InMemoryWalletStorage(),
      swapStorage = new InMemorySwapStorage()
    } = /** @type {SatoraProtocolConfig} */ (this._config)

    const builder = Client.builder()
      .withBaseUrl(baseUrl)
      .withEsploraUrl(esploraUrl)
      .withSignerStorage(walletStorage)
      .withSwapStorage(swapStorage)

    if (apiKey) builder.withApiKey(apiKey)
    if (mnemonic) builder.withMnemonic(mnemonic)

    return builder.build()
  }

  /**
   * Resolves the source Asset from bridge options.
   *
   * Supports "bitcoin" (on-chain), "lightning", and "arkade". Defaults to Bitcoin on-chain.
   *
   * @private
   * @param {SatoraBridgeOptions} options
   * @returns {LendaswapAsset}
   */
  _resolveSourceAsset (options) {
    const chain = options.sourceChain.toLowerCase()
    const tokenId = options.sourceToken || 'btc'

    if (chain === 'lightning') return Asset.BTC_LIGHTNING
    if (chain === 'arkade') return Asset.BTC_ARKADE
    if (chain === 'bitcoin') return Asset.BTC_ONCHAIN

    return { chain: toChain(chain), tokenId }
  }

  /**
   * Resolves the target Asset from bridge options.
   *
   * Supports EVM chains (arbitrum, ethereum, polygon, etc.), "lightning", and "arkade".
   * Defaults to USDT on Arbitrum.
   *
   * @private
   * @param {SatoraBridgeOptions} options
   * @returns {LendaswapAsset}
   */
  _resolveTargetAsset (options) {
    const chain = options.targetChain.toLowerCase()
    const tokenId = options.token

    if (chain === 'lightning') return Asset.BTC_LIGHTNING
    if (chain === 'arkade') return Asset.BTC_ARKADE

    return { chain: toChain(chain), tokenId }
  }

  /**
   * Quotes the costs of a bridge operation.
   *
   * @param {SatoraBridgeOptions} options - The bridge's options.
   * @returns {Promise<Omit<BridgeResult, 'hash'> & { exchangeRate: string, sourceAmount: string, targetAmount: string, minAmount: number, maxAmount: number }>} The bridge's quote.
   */
  async quoteBridge (options) {
    const client = await this._getClient()
    const source = this._resolveSourceAsset(options)
    const target = this._resolveTargetAsset(options)

    const quote = await client.getQuote({
      sourceChain: /** @type {Chain} */ (source.chain),
      sourceToken: source.tokenId,
      targetChain: /** @type {Chain} */ (target.chain),
      targetToken: target.tokenId,
      sourceAmount: Number(options.amount)
    })

    const networkFee = BigInt(quote.network_fee + quote.gasless_network_fee)
    const protocolFee = BigInt(quote.protocol_fee)

    if (this._config.bridgeMaxFee != null) {
      const maxFee = BigInt(this._config.bridgeMaxFee)
      if (networkFee + protocolFee > maxFee) {
        throw new Error(
          `Total fee ${networkFee + protocolFee} sats exceeds bridgeMaxFee ${maxFee} sats`
        )
      }
    }

    return {
      fee: networkFee,
      bridgeFee: protocolFee,
      exchangeRate: quote.exchange_rate,
      sourceAmount: quote.source_amount,
      targetAmount: quote.target_amount,
      minAmount: quote.min_amount,
      maxAmount: quote.max_amount
    }
  }

  /**
   * Creates a bridge swap.
   *
   * Supports multiple directions:
   * - Bitcoin on-chain → EVM token (default)
   * - Lightning → EVM token
   * - Lightning → Arkade
   * - Bitcoin on-chain → Arkade
   *
   * For on-chain swaps, returns a `depositAddress` (Bitcoin HTLC).
   * For Lightning swaps, returns a `lightningInvoice` to pay.
   * After funding, use {@link claim} to complete the swap.
   *
   * @param {SatoraBridgeOptions} options - The bridge's options.
   * @returns {Promise<SatoraBridgeResult>} The bridge result with deposit instructions.
   */
  async bridge (options) {
    const client = await this._getClient()
    const source = this._resolveSourceAsset(options)
    const target = this._resolveTargetAsset(options)

    const result = await client.createSwap({
      source,
      target,
      sourceAmount: Number(options.amount),
      targetAddress: options.recipient,
      referralCode: /** @type {SatoraProtocolConfig} */ (this._config).referralCode,
      gasless: true
    })

    const response = result.response

    return {
      hash: response.id,
      fee: BigInt(response.fee_sats || 0),
      bridgeFee: BigInt(response.fee_sats || 0),
      depositAddress: response.btc_htlc_address || undefined,
      lightningInvoice: response.lightning_invoice || undefined,
      depositAmount: BigInt(response.source_amount),
      targetAmount: response.target_amount
    }
  }

  /**
   * Gets the current status of a swap.
   *
   * @param {string} swapId - The swap ID returned by {@link bridge}.
   * @returns {Promise<GetSwapResponse>} The swap status from the server.
   */
  async getSwap (swapId) {
    const client = await this._getClient()
    return client.getSwap(swapId)
  }

  /**
   * Claims the HTLC after the server has funded the EVM side.
   *
   * Call this after the swap status transitions to 'serverfunded'.
   * For gasless swaps, this triggers a Gelato relay claim.
   *
   * @param {string} swapId - The swap ID returned by {@link bridge}.
   * @param {ClaimOptions} [options] - Claim options.
   * @returns {Promise<ClaimResult>} The claim result.
   */
  async claim (swapId, options = {}) {
    const client = await this._getClient()
    return client.claim(swapId, options)
  }

  /**
   * Refunds a swap that has not been completed.
   *
   * Use collaborative refund when the swap is still active (before timelock expiry).
   * Falls back to on-chain refund after the timelock expires.
   *
   * @param {string} swapId - The swap ID returned by {@link bridge}.
   * @param {RefundOptions} [options] - Refund options.
   * @returns {Promise<RefundResult>} The refund result.
   */
  async refund (swapId, options) {
    const client = await this._getClient()
    return client.refundSwap(swapId, options)
  }

  /**
   * Lists all tracked swaps from local storage.
   *
   * @returns {Promise<StoredSwap[]>} All stored swaps.
   */
  async listSwaps () {
    const client = await this._getClient()
    return client.listAllSwaps()
  }

  /**
   * Recovers swaps from the server using the wallet's xpub.
   *
   * Useful when switching devices or after clearing local storage.
   *
   * @returns {Promise<StoredSwap[]>} Recovered swaps.
   */
  async recoverSwaps () {
    const client = await this._getClient()
    return client.recoverSwaps()
  }
}
