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

// End-to-end Lightning -> EVM swidge example, using a Spark wallet. MOVES REAL
// FUNDS.
//
// It builds a Spark wallet from a persistent BIP-39 seed and wraps it as the
// Lightning source account (it can pay a BOLT11 invoice). SatoraProtocol
// creates the swap, the Spark wallet pays the returned invoice, and the EVM
// tokens are claimed to your recipient address.
//
// Requires a FUNDED Spark wallet (Lightning-spendable sats). Configure via the
// shared examples/.env (see examples/.env.example), loaded with --env-file:
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # persistent seed (shared)
//   SATORA_SPARK_MAX_FEE_SATS=100                     # max Lightning routing fee (optional)
//   SATORA_DB, SATORA_BASE_URL, SATORA_ARKADE_SERVER, SATORA_ESPLORA  # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-spark.js address
//   node --env-file=examples/.env examples/satora-cli-spark.js balance
//   node --env-file=examples/.env examples/satora-cli-spark.js invoice --amount 1000
//   node --env-file=examples/.env examples/satora-cli-spark.js pay --invoice lnbc...
//   node --env-file=examples/.env examples/satora-cli-spark.js swap \
//     --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --recipient 0xYourEvmAddress \
//     --amount 5000

import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { SparkWallet } from '@buildonspark/spark-sdk'

import SatoraProtocol from '../index.js'

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

// Persistent SQLite storage; fail loudly if unavailable (see satora-cli-arkade.js).
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

// Builds a Spark wallet and adapts it to the Lightning source account surface
// swidge needs: payInvoice(bolt11). Also exposes helpers for the CLI commands.
async function buildSparkAccount (mnemonic) {
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    options: { network: 'MAINNET' }
  })

  const maxFeeSats = Number(process.env.SATORA_SPARK_MAX_FEE_SATS || 100)

  return {
    getSparkAddress: () => wallet.getSparkAddress(),
    async getBalance () {
      const { satsBalance } = await wallet.getBalance()
      return satsBalance.available
    },
    async createInvoice (amountSats, memo) {
      const request = await wallet.createLightningInvoice({ amountSats, memo })
      return request.invoice.encodedInvoice
    },
    // The swidge funding step: pay the swap's BOLT11 invoice.
    payInvoice: (invoice) => wallet.payLightningInvoice({ invoice, maxFeeSats })
  }
}

async function createProtocol (account, { mnemonic, dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    mnemonic,
    accountChains: ['Lightning'],
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
    esploraUrl: process.env.SATORA_ESPLORA || 'https://mempool.space/api',
    ...(process.env.SATORA_BASE_URL ? { baseUrl: process.env.SATORA_BASE_URL } : {}),
    signerStorage,
    swapStorage
  })
}

function printResult (result) {
  console.log('status:', result.status ?? 'completed')
  if (result.message) console.log('note:  ', result.message)
  for (const tx of result.transactions ?? []) {
    console.log(`  ${tx.type} tx${tx.chain ? ` (${tx.chain})` : ''}: ${tx.hash}`)
  }
}

function usage () {
  console.log(`satora-cli-spark — Lightning -> EVM swidge example (Spark wallet)

Usage:
  node --env-file=examples/.env examples/satora-cli-spark.js <command> [options]

Commands:
  address              Show the Spark address
  balance              Show the spendable Lightning balance (sats)
  invoice --amount <n> Create a Lightning invoice for <n> sats (--memo optional)
  pay --invoice <b11>  Pay a BOLT11 Lightning invoice
  swap                 Perform a Lightning -> EVM swap:
                         --to <chain:token>      destination token (e.g. 42161:0xfd08...)
                         --recipient <address>   EVM address to receive the tokens
                         --amount <sats>         amount to send, in sats
  status <swap-id>     Show the status of a swap by id
  resume <swap-id>     Drive an interrupted swap to completion (throws if it cannot)

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

  const mnemonic = requireEnv('SATORA_MNEMONIC')
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('SATORA_MNEMONIC is not a valid BIP-39 mnemonic')
  }

  const dbPath = process.env.SATORA_DB || './.satora.db'

  // status/resume are read-only of the Spark wallet — no wallet needed.
  if (command === 'status' || command === 'resume') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error(`${command} requires a swap id: ${command} <swap-id>`)
      process.exit(1)
    }

    const protocol = await createProtocol(undefined, { mnemonic, dbPath })
    if (command === 'status') {
      printResult(await protocol.getSwidgeStatus(swapId))
    } else {
      console.log(`Resuming swap ${swapId} (driving it to completion) ...`)
      printResult(await protocol.resumeSwidge(swapId))
    }

    process.exit(0)
  }

  const account = await buildSparkAccount(mnemonic)

  if (command === 'address') {
    console.log('Spark address:', await account.getSparkAddress())
    console.log('LNURL:         not exposed by the Spark SDK (receive via `invoice` or the Spark address)')
    process.exit(0)
  }

  if (command === 'balance') {
    console.log('Balance:', await account.getBalance(), 'sats')
    process.exit(0)
  }

  if (command === 'invoice') {
    if (flags.amount === undefined || flags.amount === true) {
      console.error('invoice requires: --amount <sats> [--memo <text>]')
      process.exit(1)
    }
    const invoice = await account.createInvoice(Number(flags.amount), typeof flags.memo === 'string' ? flags.memo : undefined)
    console.log(invoice)
    process.exit(0)
  }

  if (command === 'pay') {
    if (!flags.invoice || flags.invoice === true) {
      console.error('pay requires: --invoice <bolt11>')
      process.exit(1)
    }
    console.log(`Paying invoice ${flags.invoice.slice(0, 30)}... `)
    const result = await account.payInvoice(flags.invoice)
    console.log('Paid. status:', result.status ?? 'submitted')
    process.exit(0)
  }

  if (command !== 'swap') {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  if (!flags.to || !flags.recipient || flags.amount === undefined || flags.amount === true) {
    console.error('swap requires: --to <chain:token> --recipient <evm-address> --amount <sats>')
    process.exit(1)
  }

  const protocol = await createProtocol(account, { mnemonic, dbPath })

  console.log('Spark address:', await account.getSparkAddress())
  console.log(`\nSwapping ${flags.amount} sats (Lightning) -> ${flags.to} for ${flags.recipient} ...`)
  console.log('(pays the swap invoice, then drives the whole flow — it can take a little while)\n')

  const result = await protocol.swidge({
    fromToken: 'Lightning:btc',
    toToken: flags.to,
    fromTokenAmount: BigInt(flags.amount),
    recipient: flags.recipient
  })

  console.log('Done:')
  console.log('  swap id: ', result.id)
  console.log('  spent:   ', result.fromTokenAmount, 'sats')
  console.log('  received:', result.toTokenAmount, `(${flags.to})`)
  for (const tx of result.transactions) console.log(`  ${tx.type} tx (${tx.chain}): ${tx.hash}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
