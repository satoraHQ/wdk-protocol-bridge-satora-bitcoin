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

// End-to-end Bitcoin (on-chain) -> EVM swidge example. This MOVES REAL FUNDS.
//
// It derives a native-segwit (BIP-84) wallet from a persistent BIP-39 seed and
// adapts it to the Bitcoin source account (it sends on-chain BTC to an
// address). SatoraProtocol creates the swap, the wallet funds the on-chain
// HTLC, and the EVM tokens are claimed to your recipient address. On-chain
// confirmations make this the slowest direction.
//
// UTXOs and broadcasting go through an Esplora API; only confirmed UTXOs are
// spent. Configure via the shared examples/.env (see examples/.env.example):
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # persistent seed (shared)
//   SATORA_ESPLORA=https://mempool.space/api          # Esplora API (optional)
//   SATORA_BTC_FEE_RATE=2                              # sat/vB (optional; else Esplora estimate)
//   SATORA_DB, SATORA_BASE_URL                         # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-btc.js address
//   node --env-file=examples/.env examples/satora-cli-btc.js balance
//   node --env-file=examples/.env examples/satora-cli-btc.js send --to bc1q... --amount 5000
//   node --env-file=examples/.env examples/satora-cli-btc.js swap \
//     --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --recipient 0xYourEvmAddress \
//     --amount 20000
//   node --env-file=examples/.env examples/satora-cli-btc.js status <swap-id>

import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import * as btc from '@scure/btc-signer'

import SatoraProtocol from '../index.js'

// BIP-84 native-segwit path (index 0).
const BTC_DERIVATION_PATH = "m/84'/0'/0'/0/0"
const DUST_SATS = 330

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

const esplora = () => process.env.SATORA_ESPLORA || 'https://mempool.space/api'

async function esploraGet (path) {
  const res = await fetch(esplora() + path)
  if (!res.ok) throw new Error(`esplora GET ${path} failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function esploraPost (path, body) {
  const res = await fetch(esplora() + path, { method: 'POST', body })
  if (!res.ok) throw new Error(`esplora POST ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.text()).trim()
}

async function resolveFeeRate (flags) {
  if (flags['fee-rate'] !== undefined && flags['fee-rate'] !== true) return Number(flags['fee-rate'])
  if (process.env.SATORA_BTC_FEE_RATE) return Number(process.env.SATORA_BTC_FEE_RATE)
  try {
    const est = await esploraGet('/fee-estimates')
    return Math.max(1, Math.ceil(est['6'] ?? est['3'] ?? 2))
  } catch {
    return 2
  }
}

// Derives a BIP-84 native-segwit wallet from the seed.
function deriveWallet (mnemonic) {
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, '')).derive(BTC_DERIVATION_PATH)
  if (!node.privateKey || !node.publicKey) throw new Error('failed to derive the Bitcoin key from the seed')
  const payment = btc.p2wpkh(node.publicKey, btc.NETWORK)
  return { address: payment.address, script: payment.script, privateKey: node.privateKey }
}

async function confirmedUtxos (address) {
  const utxos = await esploraGet(`/address/${address}/utxo`)
  return utxos.filter(u => u.status && u.status.confirmed)
}

// Builds, signs, and broadcasts a payment to `to` for `amountSats`, spending
// confirmed P2WPKH UTXOs. Returns the broadcast txid.
async function sendBitcoin (wallet, to, amountSats, feeRate) {
  const utxos = (await confirmedUtxos(wallet.address)).sort((a, b) => b.value - a.value)

  const tx = new btc.Transaction()
  let totalIn = 0
  let selected = 0
  const feeFor = (nIn) => Math.ceil((11 + nIn * 68 + 2 * 31) * feeRate)

  for (const u of utxos) {
    tx.addInput({
      txid: Buffer.from(u.txid, 'hex'),
      index: u.vout,
      witnessUtxo: { script: wallet.script, amount: BigInt(u.value) }
    })
    totalIn += u.value
    selected++
    if (totalIn >= amountSats + feeFor(selected)) break
  }

  const fee = feeFor(selected)
  if (totalIn < amountSats + fee) {
    throw new Error(`insufficient confirmed balance: have ${totalIn} sats, need ${amountSats + fee} (amount ${amountSats} + fee ${fee})`)
  }

  tx.addOutputAddress(to, BigInt(amountSats), btc.NETWORK)
  const change = totalIn - amountSats - fee
  if (change >= DUST_SATS) tx.addOutputAddress(wallet.address, BigInt(change), btc.NETWORK)

  tx.sign(wallet.privateKey)
  tx.finalize()
  return esploraPost('/tx', tx.hex)
}

// Adapts the wallet to the Bitcoin source account surface swidge needs.
function toAccount (wallet, feeRate) {
  return {
    getAddress: async () => wallet.address,
    async getBalance () {
      const utxos = await confirmedUtxos(wallet.address)
      return BigInt(utxos.reduce((sum, u) => sum + u.value, 0))
    },
    // The swidge funding step: send native BTC on-chain to the HTLC address.
    async sendTransaction ({ to, value }) {
      return { hash: await sendBitcoin(wallet, to, Number(value), feeRate) }
    }
  }
}

async function createProtocol (account, { mnemonic, dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    mnemonic,
    ...(account ? { accountChains: ['Bitcoin'] } : {}),
    esploraUrl: esplora(),
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
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
  console.log(`satora-cli-btc — Bitcoin (on-chain) -> EVM swidge example

Usage:
  node --env-file=examples/.env examples/satora-cli-btc.js <command> [options]

Commands:
  address              Show the Bitcoin address (BIP-84 native segwit)
  balance              Show the confirmed on-chain balance (sats)
  send                 Send on-chain BTC:
                         --to <btc-address>      destination address
                         --amount <sats>         amount to send, in sats
                         --fee-rate <sat/vB>     optional (or SATORA_BTC_FEE_RATE / Esplora estimate)
  swap                 Perform a Bitcoin -> EVM swap:
                         --to <chain:token>      destination token (e.g. 42161:0xfd08...)
                         --recipient <address>   EVM address to receive the tokens
                         --amount <sats>         amount to send, in sats
                         --fee-rate <sat/vB>     optional funding-tx fee rate
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

  // status/resume are read-only of the wallet.
  if (command === 'status' || command === 'resume') {
    const swapId = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined
    if (!swapId) {
      console.error(`${command} requires a swap id: ${command} <swap-id>`)
      process.exit(1)
    }

    const protocol = await createProtocol(undefined, { mnemonic, dbPath })
    if (command === 'status') printResult(await protocol.getSwidgeStatus(swapId))
    else {
      console.log(`Resuming swap ${swapId} (driving it to completion) ...`)
      printResult(await protocol.resumeSwidge(swapId))
    }

    process.exit(0)
  }

  const wallet = deriveWallet(mnemonic)

  if (command === 'address') {
    console.log('Bitcoin address:', wallet.address)
    process.exit(0)
  }

  if (command === 'balance') {
    const utxos = await confirmedUtxos(wallet.address)
    console.log('Bitcoin address:', wallet.address)
    console.log('Balance:', utxos.reduce((sum, u) => sum + u.value, 0), 'sats (confirmed)')
    process.exit(0)
  }

  const feeRate = await resolveFeeRate(flags)

  if (command === 'send') {
    if (!flags.to || flags.amount === undefined || flags.amount === true) {
      console.error('send requires: --to <btc-address> --amount <sats>')
      process.exit(1)
    }
    console.log('Bitcoin address:', wallet.address)
    console.log(`Sending ${flags.amount} sats to ${flags.to} (fee rate ${feeRate} sat/vB) ...`)
    const txid = await sendBitcoin(wallet, flags.to, Number(flags.amount), feeRate)
    console.log('Sent. txid:', txid)
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

  const protocol = await createProtocol(toAccount(wallet, feeRate), { mnemonic, dbPath })

  console.log('Bitcoin address:', wallet.address)
  console.log(`\nSwapping ${flags.amount} sats (Bitcoin) -> ${flags.to} for ${flags.recipient} ...`)
  console.log('(funds the on-chain HTLC, then waits for confirmations — this is the slow one)\n')

  const result = await protocol.swidge({
    fromToken: 'Bitcoin:btc',
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
