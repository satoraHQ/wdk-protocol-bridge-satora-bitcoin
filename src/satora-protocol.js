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

import { toSupportedChain } from './chains.js'

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

/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number} [defaultSlippage] - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
 * @property {string} [baseUrl] - Override the satora API base URL. Defaults to the SDK's production endpoint.
 * @property {string} [mnemonic] - BIP39 mnemonic for the SDK's Bitcoin/Arkade HD wallet. Not required for read-only operations (chains, tokens, quotes).
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
   * @param {SwidgeOptions} options - The swidge options.
   * @returns {Promise<SwidgeQuote>} The quoted swidge details.
   */
  async quoteSwidge (options) {
    // TODO: Implement protocol-specific swidge fee estimation
  }

  /**
   * Executes a swidge operation.
   *
   * @param {SwidgeOptions} options - The swidge options.
   * @param {SwidgeProtocolConfig} [config] - Optional provider-specific execution configuration.
   * @returns {Promise<SwidgeResult>} The swidge execution result.
   */
  async swidge (options, config) {
    // TODO: Implement protocol-specific swidge
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
    // TODO: Implement protocol-specific swidge status fetching
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
  async getSupportedTokens (options) {
    // TODO: Implement protocol-specific supported tokens fetching
  }
}
