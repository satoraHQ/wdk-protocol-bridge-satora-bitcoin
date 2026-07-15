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

/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */

/**
 * Metadata for each chain supported by the satora protocol, keyed by the
 * satora `Chain` identifier. Satora encodes EVM chains as numeric strings
 * ('1', '137', '42161') and non-EVM chains as names ('Bitcoin', 'Lightning',
 * 'Arkade'). Object keys are strings, so numeric ids are looked up by their
 * string form (e.g. `CHAIN_METADATA['137']`).
 *
 * @type {Record<string, SwidgeSupportedChain>}
 */
export const CHAIN_METADATA = {
  Bitcoin: { id: 'Bitcoin', name: 'Bitcoin', type: 'utxo', nativeToken: 'BTC' },
  Lightning: { id: 'Lightning', name: 'Lightning Network', type: 'lightning', nativeToken: 'BTC' },
  Arkade: { id: 'Arkade', name: 'Arkade', type: 'ark', nativeToken: 'BTC' },
  1: { id: 1, name: 'Ethereum', type: 'evm', nativeToken: 'ETH' },
  137: { id: 137, name: 'Polygon', type: 'evm', nativeToken: 'POL' },
  42161: { id: 42161, name: 'Arbitrum', type: 'evm', nativeToken: 'ETH' }
}

/**
 * Normalizes a satora `Chain` identifier to the WDK chain id form: EVM chains
 * (encoded as numeric strings) become numbers, non-EVM chains stay as their
 * name. This is the canonical id surfaced by {@link toSupportedChain} and used
 * for `chain` fields and route-scoped filtering.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {string | number} The normalized chain id.
 */
export function toChainId (sdkChain) {
  const asNumber = Number(sdkChain)
  return Number.isInteger(asNumber) ? asNumber : String(sdkChain)
}

/**
 * Maps a satora `Chain` identifier to a WDK {@link SwidgeSupportedChain}.
 * Unknown identifiers fall back to a best-effort mapping: numeric ids are
 * treated as EVM chains, everything else as 'other'.
 *
 * @param {string | number} sdkChain - The satora chain identifier.
 * @returns {SwidgeSupportedChain} The WDK supported-chain descriptor.
 */
export function toSupportedChain (sdkChain) {
  const meta = CHAIN_METADATA[sdkChain]
  if (meta) return { ...meta }

  const id = toChainId(sdkChain)
  const isEvm = typeof id === 'number'
  return {
    id,
    name: String(sdkChain),
    type: isEvm ? 'evm' : 'other',
    nativeToken: isEvm ? 'ETH' : 'BTC'
  }
}
