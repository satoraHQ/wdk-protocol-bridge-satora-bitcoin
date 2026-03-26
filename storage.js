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

/**
 * Re-exports storage implementations from lendaswap SDK.
 *
 * @example
 * ```js
 * // Browser (IndexedDB)
 * import { IdbWalletStorage, IdbSwapStorage } from '@satora/wdk-protocol-bridge-satora-bitcoin/storage'
 *
 * // Node.js (SQLite) — requires better-sqlite3
 * import { SqliteWalletStorage, SqliteSwapStorage } from '@lendasat/lendaswap-sdk-pure/node'
 *
 * // In-memory (tests, stateless)
 * import { InMemoryWalletStorage, InMemorySwapStorage } from '@satora/wdk-protocol-bridge-satora-bitcoin/storage'
 * ```
 */

export {
  InMemoryWalletStorage,
  InMemorySwapStorage,
  inMemoryStorageFactory,
  IdbWalletStorage,
  IdbSwapStorage,
  idbStorageFactory
} from '@lendasat/lendaswap-sdk-pure'
