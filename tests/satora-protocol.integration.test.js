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

// Integration tests run against the live satora API. They use Node's built-in
// test runner (not jest) so the real @satora/swap ESM dependency graph loads
// exactly as it does in production, with no transpilation. They are excluded
// from `npm test` (jest) and run via:
//
//   SATORA_INTEGRATION=1 npm run test:integration
//
// Without SATORA_INTEGRATION the whole suite is skipped. Override the endpoint
// with SATORA_BASE_URL (defaults to production).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import SatoraProtocol from '../index.js'

const skip = process.env.SATORA_INTEGRATION ? false : 'set SATORA_INTEGRATION=1 to run'
const config = process.env.SATORA_BASE_URL ? { baseUrl: process.env.SATORA_BASE_URL } : {}

describe('SatoraProtocol (integration)', { skip }, () => {
  describe('getSupportedChains', () => {
    it('returns the live set of supported chains', async () => {
      const protocol = new SatoraProtocol(undefined, config)

      const chains = await protocol.getSupportedChains()

      assert.ok(Array.isArray(chains), 'chains is an array')
      assert.ok(chains.length > 0, 'at least one chain is returned')

      for (const chain of chains) {
        assert.notEqual(chain.id, undefined, 'chain has an id')
        assert.equal(typeof chain.name, 'string')
        assert.equal(typeof chain.type, 'string')
        assert.equal(typeof chain.nativeToken, 'string')
      }

      const ids = chains.map(c => String(c.id))
      assert.equal(new Set(ids).size, ids.length, 'chain ids are unique')

      // Satora is a Bitcoin <-> EVM bridge, so Bitcoin must be present.
      assert.ok(ids.includes('Bitcoin'), 'Bitcoin is supported')
    })
  })

  describe('getSupportedTokens', () => {
    it('returns the live set of supported tokens', async () => {
      const protocol = new SatoraProtocol(undefined, config)

      const tokens = await protocol.getSupportedTokens()

      assert.ok(Array.isArray(tokens), 'tokens is an array')
      assert.ok(tokens.length > 0, 'at least one token is returned')

      for (const token of tokens) {
        assert.equal(typeof token.token, 'string')
        assert.notEqual(token.chain, undefined, 'token has a chain')
        assert.equal(typeof token.symbol, 'string')
        assert.equal(typeof token.decimals, 'number')
        // EVM tokens carry a contract address; BTC does not.
        if (token.address !== undefined) {
          assert.ok(token.address.startsWith('0x'), 'address is an EVM contract address')
        }
      }

      // Token ids are chain-qualified; BTC on Bitcoin must be discoverable.
      assert.ok(tokens.some(t => t.token === 'Bitcoin:btc'), 'Bitcoin:btc is supported')
    })

    it('filters tokens by chain', async () => {
      const protocol = new SatoraProtocol(undefined, config)

      const polygon = await protocol.getSupportedTokens({ toChain: 42161 })

      assert.ok(polygon.length > 0, 'at least one Arbitrum token')
      assert.ok(
        polygon.every(t => String(t.chain) === '42161'),
        'every returned token is on Arbitrum (42161)'
      )
    })
  })

  describe('quoteSwidge', () => {
    it('quotes an exact-in Bitcoin -> Arbitrum USDT0 swap using chain-qualified tokens', async () => {
      const protocol = new SatoraProtocol(undefined, config)

      const quote = await protocol.quoteSwidge({
        fromToken: 'Bitcoin:btc',
        toToken: '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT0 on Arbitrum
        fromTokenAmount: 100000n // 0.001 BTC in sats
      })

      assert.equal(typeof quote.fromTokenAmount, 'bigint')
      assert.equal(typeof quote.toTokenAmount, 'bigint')
      assert.equal(typeof quote.toTokenAmountMin, 'bigint')
      assert.ok(quote.toTokenAmount > 0n, 'receives a positive amount')
      assert.ok(quote.toTokenAmountMin <= quote.toTokenAmount, 'min does not exceed expected')

      assert.ok(Array.isArray(quote.fees) && quote.fees.length > 0, 'fees is a populated array')
      for (const fee of quote.fees) {
        assert.ok(['network', 'protocol', 'affiliate', 'other'].includes(fee.type), 'valid fee type')
        assert.equal(typeof fee.amount, 'bigint')
        assert.equal(typeof fee.token, 'string')
      }
    })
  })
})
