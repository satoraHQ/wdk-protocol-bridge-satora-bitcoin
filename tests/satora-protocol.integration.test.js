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
})
