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

import { toChainId } from './chains.js'

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */

// Satora's `token_id` alone is ambiguous: 'btc' is the identifier for BTC on
// Bitcoin, Lightning, AND Arkade. So the WDK token identifier is chain-qualified
// as `chain:tokenId` (e.g. '137:0x...', 'Bitcoin:btc', 'Lightning:btc'), which
// carries the chain through the standard fromToken/toToken options.
const SEPARATOR = ':'

/**
 * Builds a chain-qualified WDK token identifier.
 *
 * @param {string | number} chain - The satora chain identifier.
 * @param {string} tokenId - The satora token id ('btc' or a contract address).
 * @returns {string} The `chain:tokenId` identifier.
 */
export function composeTokenId (chain, tokenId) {
  return `${chain}${SEPARATOR}${tokenId}`
}

/**
 * Splits a chain-qualified WDK token identifier into its parts. If the
 * identifier is not chain-qualified, `chain` is undefined.
 *
 * @param {string} token - The token identifier (`chain:tokenId` or `tokenId`).
 * @returns {{ chain: string | undefined, tokenId: string }} The parts.
 */
export function parseTokenId (token) {
  const value = String(token)
  const index = value.indexOf(SEPARATOR)
  if (index === -1) return { chain: undefined, tokenId: value }
  return { chain: value.slice(0, index), tokenId: value.slice(index + 1) }
}

/**
 * Maps a satora `TokenInfo` to a WDK {@link SwidgeSupportedToken}. The `token`
 * identifier is chain-qualified (`chain:tokenId`) so it can be passed straight
 * back as `fromToken`/`toToken`. For EVM tokens the contract address is also
 * surfaced as `address`.
 *
 * @param {Object} info - The satora token info.
 * @param {string} info.token_id - The provider-specific token identifier.
 * @param {string | number} info.chain - The satora chain identifier.
 * @param {string} info.symbol - The token symbol.
 * @param {number} info.decimals - The token's base-unit decimals.
 * @param {string} info.name - The token's full name.
 * @returns {SwidgeSupportedToken} The WDK supported-token descriptor.
 */
export function toSupportedToken (info) {
  const isEvmAddress = typeof info.token_id === 'string' && info.token_id.startsWith('0x')

  const token = {
    token: composeTokenId(info.chain, info.token_id),
    chain: toChainId(info.chain),
    symbol: info.symbol,
    decimals: info.decimals,
    name: info.name
  }

  if (isEvmAddress) token.address = info.token_id

  return token
}
