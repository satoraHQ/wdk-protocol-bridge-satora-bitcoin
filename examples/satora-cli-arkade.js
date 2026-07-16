#!/usr/bin/env node
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

// End-to-end Arkade -> EVM swidge example. This MOVES REAL FUNDS.
//
// It builds an Arkade wallet from a persistent BIP-39 seed and wraps it as a
// WDK account, then hands it to SatoraProtocol. The account funds the Arkade
// side; the swap client (same seed, backed by a SQLite database) drives the
// HTLC and claims the EVM tokens gaslessly to your recipient address.
//
// Requires a FUNDED Arkade wallet. Configure via the shared examples/.env file
// (see examples/.env.example), loaded with Node's --env-file:
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # persistent seed (shared)
//   SATORA_ARKADE_SERVER=https://arkade.computer     # optional
//   SATORA_ESPLORA=https://mempool.space/api         # optional
//   SATORA_DB=./.satora.db                           # optional (sqlite)
//   SATORA_BASE_URL=https://api.satora.io/           # optional
//
// Usage:
//   # 1. show the Arkade address to fund
//   node --env-file=examples/.env examples/satora-cli-arkade.js address
//
//   # 2. run the swap
//   node --env-file=examples/.env examples/satora-cli-arkade.js swap \
//     --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --recipient 0xYourEvmAddress \
//     --amount 0.0001
//
//   # 3. check a swap's status by id
//   node --env-file=examples/.env examples/satora-cli-arkade.js status <swap-id>
//
//   # recover an interrupted swap: drive it to completion, or refund if it cannot
//   node --env-file=examples/.env examples/satora-cli-arkade.js resume <swap-id>
//   node --env-file=examples/.env examples/satora-cli-arkade.js refund <swap-id>

import {
  EsploraProvider,
  InMemoryContractRepository,
  InMemoryWalletRepository,
  RestArkProvider,
  RestIndexerProvider,
  SingleKey,
  Wallet
} from '@arkade-os/sdk'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { EventSource } from 'eventsource'

import SatoraProtocol from '../index.js'

// The Arkade SDK opens a background indexer subscription via the browser
// EventSource API, which is not a Node global. Polyfill it.
if (!('EventSource' in globalThis)) globalThis.EventSource = EventSource

// BIP-85 derivation path for the Arkade identity (index 0).
const ARKADE_DERIVATION_PATH = "m/83696968'/11811'/0/0"

function parseArgs (argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else { flags[key] = next; i++ }
  }
  return flags
}

function requireEnv (name) {
  const value = process.env[name]
  if (!value) throw new Error(`missing required env var ${name} (see examples/.env.example)`)
  return value
}

// Persistent SQLite storage (via the native better-sqlite3 addon). A durable
// database is REQUIRED: it holds the swap secret/state so an interrupted swap
// can be recovered/refunded. If it isn't available, fail loudly rather than
// risk funds with ephemeral in-memory storage.
async function createStorage (dbPath) {
  try {
    const { SqliteWalletStorage, SqliteSwapStorage } = await import('@satora/swap/node')
    return { signerStorage: new SqliteWalletStorage(dbPath), swapStorage: new SqliteSwapStorage(dbPath) }
  } catch (err) {
    throw new Error(
      `persistent SQLite storage is unavailable (${err.message.split('\n')[0]}). ` +
      'It is required so an interrupted swap can be recovered — refusing to run with ephemeral storage. ' +
      'Build the native addon with: (cd node_modules/better-sqlite3 && npx node-gyp rebuild)'
    )
  }
}

// Builds a SatoraProtocol backed by persistent storage. Pass `undefined` as the
// account for read-only commands (status).
async function createProtocol (account, { mnemonic, arkadeServerUrl, esploraUrl, dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    mnemonic,
    arkadeServerUrl,
    esploraUrl,
    accountChains: ['Arkade'], // the account is an Arkade wallet
    ...(process.env.SATORA_BASE_URL ? { baseUrl: process.env.SATORA_BASE_URL } : {}),
    signerStorage,
    swapStorage
  })
}

/**
 * Builds an Arkade wallet from the seed and adapts it to the minimal WDK
 * account surface `swidge` needs: getAddress + sendTransaction({ to, value }).
 */
async function buildArkadeAccount (mnemonic, { arkadeServerUrl, esploraUrl }) {
  const seed = mnemonicToSeedSync(mnemonic, '')
  const node = HDKey.fromMasterSeed(seed).derive(ARKADE_DERIVATION_PATH)
  if (!node.privateKey) throw new Error('failed to derive the Arkade key from the seed')

  const wallet = await Wallet.create({
    identity: SingleKey.fromHex(Buffer.from(node.privateKey).toString('hex')),
    arkProvider: new RestArkProvider(arkadeServerUrl),
    indexerProvider: new RestIndexerProvider(arkadeServerUrl),
    onchainProvider: new EsploraProvider(esploraUrl),
    storage: {
      walletRepository: new InMemoryWalletRepository(),
      contractRepository: new InMemoryContractRepository()
    }
  })

  return {
    async getAddress () {
      return wallet.getAddress()
    },
    async getBalance () {
      const balance = await wallet.getBalance()
      return BigInt(balance.settled + balance.preconfirmed)
    },
    // The swidge funding step: send native sats to the VHTLC address.
    async sendTransaction ({ to, value }) {
      const hash = await wallet.sendBitcoin({ address: to, amount: Number(value) })
      return { hash, fee: 0n }
    }
  }
}

function usage () {
  console.log(`satora-cli-arkade — Arkade -> EVM swidge example

Usage:
  node --env-file=examples/.env examples/satora-cli-arkade.js <command> [options]

Commands:
  address           Show the Arkade wallet address and balance (fund this before swapping)
  send              Send BTC out via Arkade:
                      --to <arkade-address>   destination Arkade address
                      --amount <btc>          amount to send, in BTC (e.g. 0.0001)
  swap              Perform an Arkade -> EVM swap:
                      --to <chain:token>      destination token (e.g. 42161:0xfd08...)
                      --recipient <address>   EVM address to receive the tokens
                      --amount <btc>          amount to send, in BTC (e.g. 0.0001)
  status <swap-id>  Show the status of a swap by id
  resume <swap-id>  Drive an interrupted swap to completion (throws if it cannot)
  refund <swap-id>  Refund a swap that cannot complete, back to the wallet

Config comes from examples/.env (copy from examples/.env.example).`)
}

async function main () {
  const argv = process.argv.slice(2)
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined
  const flags = parseArgs(argv)

  if (!command || command === 'help' || flags.help) {
    usage()
    process.exit(command && command !== 'help' ? 1 : 0)
  }

  // Every command needs the seed.
  const mnemonic = requireEnv('SATORA_MNEMONIC')
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('SATORA_MNEMONIC is not a valid BIP-39 mnemonic')
  }

  const arkadeServerUrl = process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer'
  const esploraUrl = process.env.SATORA_ESPLORA || 'https://mempool.space/api'
  const dbPath = process.env.SATORA_DB || './.satora.db'

  // `status` is read-only — look up a swap by id, no Arkade wallet needed.
  if (command === 'status') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('status requires a swap id: status <swap-id>')
      process.exit(1)
    }

    const statusProtocol = await createProtocol(undefined, { mnemonic, arkadeServerUrl, esploraUrl, dbPath })
    const { status, transactions } = await statusProtocol.getSwidgeStatus(swapId)
    console.log('swap id:', swapId)
    console.log('status: ', status)
    for (const tx of transactions ?? []) {
      console.log(`  ${tx.type} tx${tx.chain ? ` (${tx.chain})` : ''}: ${tx.hash}`)
    }

    process.exit(0)
  }

  // `resume` drives a swap to completion via the client's stored secret — no
  // Arkade wallet needed (the claim goes to the swap's recorded recipient).
  if (command === 'resume') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('resume requires a swap id: resume <swap-id>')
      process.exit(1)
    }

    const resumeProtocol = await createProtocol(undefined, { mnemonic, arkadeServerUrl, esploraUrl, dbPath })
    console.log(`Resuming swap ${swapId} (driving it to completion) ...`)

    const result = await resumeProtocol.resumeSwidge(swapId)
    console.log('status:', result.status)
    for (const tx of result.transactions ?? []) {
      console.log(`  ${tx.type} tx${tx.chain ? ` (${tx.chain})` : ''}: ${tx.hash}`)
    }

    process.exit(0)
  }

  // The address/send/refund/swap commands fund or read the Arkade wallet.
  const account = await buildArkadeAccount(mnemonic, { arkadeServerUrl, esploraUrl })

  if (command === 'address' || command === 'balance') {
    console.log('Arkade wallet:', await account.getAddress())
    console.log('Balance:      ', await account.getBalance(), 'sats')

    process.exit(0)
  }

  if (command === 'send') {
    if (!flags.to || flags.amount === undefined || flags.amount === true) {
      console.error('send requires: --to <arkade-address> --amount <btc-amount>')
      process.exit(1)
    }

    const amountSats = BigInt(Math.round(Number(flags.amount) * 1e8))
    console.log('Arkade wallet:', await account.getAddress())
    console.log(`Sending ${flags.amount} BTC to ${flags.to} ...`)

    const { hash } = await account.sendTransaction({ to: flags.to, value: amountSats })
    console.log('Sent. txid:', hash)

    return
  }

  if (command === 'refund') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error('refund requires a swap id: refund <swap-id>')
      process.exit(1)
    }

    const protocol = await createProtocol(account, { mnemonic, arkadeServerUrl, esploraUrl, dbPath })
    console.log(`Refunding swap ${swapId} to ${await account.getAddress()} ...`)

    const result = await protocol.refundSwidge(swapId)
    console.log('status:', result.status)
    if (result.message) console.log('note:  ', result.message)
    for (const tx of result.transactions ?? []) {
      console.log(`  ${tx.type} tx${tx.chain ? ` (${tx.chain})` : ''}: ${tx.hash}`)
    }

    return
  }

  if (command !== 'swap') {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  if (!flags.to || !flags.recipient || flags.amount === undefined || flags.amount === true) {
    console.error('swap requires: --to <chain:token> --recipient <evm-address> --amount <btc-amount>')
    process.exit(1)
  }

  console.log('Arkade wallet:', await account.getAddress())
  console.log('Balance:      ', await account.getBalance(), 'sats')

  const protocol = await createProtocol(account, { mnemonic, arkadeServerUrl, esploraUrl, dbPath })

  // --amount is BTC; convert to sats.
  const amountSats = BigInt(Math.round(Number(flags.amount) * 1e8))

  console.log(`\nSwapping ${flags.amount} BTC (Arkade) -> ${flags.to} for ${flags.recipient} ...`)
  console.log('(this drives the whole HTLC flow and can take a little while)\n')

  const result = await protocol.swidge({
    fromToken: 'Arkade:btc',
    toToken: flags.to,
    fromTokenAmount: amountSats,
    recipient: flags.recipient
  })

  console.log('Done:')
  console.log('  swap id: ', result.id)
  console.log('  spent:   ', result.fromTokenAmount, 'sats')
  console.log('  received:', result.toTokenAmount, `(${flags.to})`)
  for (const tx of result.transactions) console.log(`  ${tx.type} tx (${tx.chain}): ${tx.hash}`)
}

// The Arkade wallet keeps a background subscription open, so exit explicitly
// once the command finishes (or fails).
main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
