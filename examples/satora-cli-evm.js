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

// End-to-end EVM -> Arkade swidge example. This MOVES REAL FUNDS.
//
// It builds an EVM wallet from a persistent BIP-39 seed (viem), wraps it as the
// SDK's EvmSigner, and runs a real EVM -> Arkade swap via SatoraProtocol. The
// account funds the EVM HTLC (token approval + deposit, so it needs some native
// gas), and the BTC is claimed to your Arkade recipient address.
//
// Requires a FUNDED EVM wallet (source token + a little gas). Configure via the
// shared examples/.env (see examples/.env.example), loaded with --env-file:
//
//   SATORA_MNEMONIC="twelve word seed phrase ..."   # persistent seed (shared)
//   SATORA_EVM_RPC=https://arb1.arbitrum.io/rpc      # RPC for the source chain (optional)
//   SATORA_ARKADE_SERVER, SATORA_ESPLORA, SATORA_DB, SATORA_BASE_URL  # optional
//
// Usage:
//   node --env-file=examples/.env examples/satora-cli-evm.js address
//   # EVM -> Arkade
//   node --env-file=examples/.env examples/satora-cli-evm.js swap \
//     --from 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --recipient ark1q... \
//     --amount 1.5
//   # EVM -> Lightning (recipient is a BOLT11 invoice, e.g. from satora-cli-spark.js invoice)
//   node --env-file=examples/.env examples/satora-cli-evm.js swap \
//     --from 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
//     --to Lightning:btc --recipient lnbc...
//   node --env-file=examples/.env examples/satora-cli-evm.js status <swap-id>
//   node --env-file=examples/.env examples/satora-cli-evm.js resume <swap-id>

import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { createPublicClient, createWalletClient, formatUnits, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, mainnet, polygon } from 'viem/chains'

import SatoraProtocol from '../index.js'

// BIP-44 EVM account path (index 0).
const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0"

const CHAINS = { 1: mainnet, 137: polygon, 42161: arbitrum }

// USDT0 token address per chain, for the `balance` command.
const USDT0_BY_CHAIN = { 42161: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' }

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
])

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

// Parses a decimal token amount into a base-unit bigint (e.g. "1.5" @ 6 -> 1500000n).
function parseUnits (value, decimals) {
  const [whole, fraction = ''] = String(value).trim().split('.')
  if (fraction.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimal places`)
  return BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`)
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

// Wraps a viem wallet/public client into the SDK's EvmSigner interface.
function buildEvmSigner (walletClient, publicClient) {
  return {
    address: walletClient.account.address,
    chainId: walletClient.chain.id,
    signTypedData: (td) => walletClient.signTypedData({ ...td, account: walletClient.account }),
    sendTransaction: (tx) => walletClient.sendTransaction({ to: tx.to, data: tx.data, chain: walletClient.chain, gas: tx.gas }),
    waitForReceipt: async (hash) => {
      const r = await publicClient.waitForTransactionReceipt({ hash })
      return { status: r.status, blockNumber: r.blockNumber, transactionHash: r.transactionHash }
    },
    getTransaction: async (hash) => {
      const t = await publicClient.getTransaction({ hash })
      return { to: t.to ?? null, input: t.input, from: t.from }
    },
    call: async (tx) => {
      const r = await publicClient.call({ to: tx.to, data: tx.data, account: tx.from, blockNumber: tx.blockNumber })
      return r.data ?? '0x'
    }
  }
}

// Builds an EvmSigner for the given chain from the seed.
function buildEvmAccount (mnemonic, chainId) {
  const chain = CHAINS[chainId]
  if (!chain) throw new Error(`unsupported EVM chain ${chainId} (supported: ${Object.keys(CHAINS).join(', ')})`)

  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic, '')).derive(EVM_DERIVATION_PATH)
  if (!node.privateKey) throw new Error('failed to derive the EVM key from the seed')

  const account = privateKeyToAccount(`0x${Buffer.from(node.privateKey).toString('hex')}`)
  const transport = process.env.SATORA_EVM_RPC ? http(process.env.SATORA_EVM_RPC) : http()
  const walletClient = createWalletClient({ account, chain, transport })
  const publicClient = createPublicClient({ chain, transport })

  return { signer: buildEvmSigner(walletClient, publicClient), publicClient, chain }
}

async function createProtocol (account, { mnemonic, chainId, dbPath }) {
  const { signerStorage, swapStorage } = await createStorage(dbPath)
  return new SatoraProtocol(account, {
    mnemonic,
    arkadeServerUrl: process.env.SATORA_ARKADE_SERVER || 'https://arkade.computer',
    esploraUrl: process.env.SATORA_ESPLORA || 'https://mempool.space/api',
    ...(chainId ? { accountChains: [chainId] } : {}),
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
  console.log(`satora-cli-evm — EVM -> Arkade swidge example

Usage:
  node --env-file=examples/.env examples/satora-cli-evm.js <command> [options]

Commands:
  address           Show the EVM wallet address (--chain <id>, default 42161)
  balance           Show native + USDT0 balance (--chain <id>, --token <address>)
  swap              Perform an EVM -> Arkade or EVM -> Lightning swap:
                      --from <chain:token>    EVM source token (e.g. 42161:0xfd08...)
                      --to <chain:token>      destination (default Arkade:btc; or Lightning:btc)
                      --recipient <address>   Arkade address, or a BOLT11 invoice for Lightning
                      --amount <units>        source-token units (Arkade only; Lightning uses the invoice)
  status <swap-id>  Show the status of a swap by id
  resume <swap-id>  Drive an interrupted swap to completion (throws if it cannot)

The EVM wallet needs the source token plus a little native gas.
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

  // status/resume are read-only of the wallet — no EVM signer needed.
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

  if (command === 'address') {
    const chainId = Number(flags.chain || 42161)
    const { signer } = buildEvmAccount(mnemonic, chainId)
    console.log('EVM wallet:', signer.address, `(chain ${chainId})`)
    process.exit(0)
  }

  if (command === 'balance') {
    const chainId = Number(flags.chain || 42161)
    const { signer, publicClient, chain } = buildEvmAccount(mnemonic, chainId)
    const tokenAddress = flags.token || USDT0_BY_CHAIN[chainId]

    console.log('EVM wallet:', signer.address, `(chain ${chainId})`)

    const native = await publicClient.getBalance({ address: signer.address })
    console.log(`  native: ${formatUnits(native, chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol}`)

    if (tokenAddress) {
      const contract = { address: tokenAddress, abi: ERC20_ABI }
      const [bal, decimals, symbol] = await Promise.all([
        publicClient.readContract({ ...contract, functionName: 'balanceOf', args: [signer.address] }),
        publicClient.readContract({ ...contract, functionName: 'decimals' }),
        publicClient.readContract({ ...contract, functionName: 'symbol' })
      ])
      console.log(`  ${symbol}: ${formatUnits(bal, decimals)} (${tokenAddress})`)
    } else {
      console.log(`  (no USDT0 known for chain ${chainId}; pass --token <address>)`)
    }

    process.exit(0)
  }

  if (command !== 'swap') {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  if (!flags.from || !flags.recipient) {
    console.error('swap requires: --from <chain:token> --recipient <address|invoice> [--to <chain:token>] [--amount <units>]')
    process.exit(1)
  }

  const toToken = flags.to || 'Arkade:btc'
  const toLightning = toToken.startsWith('Lightning')

  const chainId = Number(flags.from.split(':')[0])
  const { signer } = buildEvmAccount(mnemonic, chainId)
  const protocol = await createProtocol(signer, { mnemonic, chainId, dbPath })

  const info = (await protocol.getSupportedTokens()).find(t => t.token === flags.from)
  if (!info) throw new Error(`unknown token ${flags.from} — run: node examples/satora-cli.js tokens`)

  const swapOptions = { fromToken: flags.from, toToken, recipient: flags.recipient }
  if (toLightning) {
    // EVM -> Lightning: the recipient is a BOLT11 invoice that carries the amount.
    if (!flags.recipient.toLowerCase().startsWith('ln')) {
      console.error('swap to Lightning requires --recipient to be a BOLT11 invoice (lnbc...)')
      process.exit(1)
    }
  } else {
    // EVM -> Arkade: exact-in, amount in source-token units.
    if (flags.amount === undefined || flags.amount === true) {
      console.error(`swap to ${toToken} requires --amount <${info.symbol} units>`)
      process.exit(1)
    }
    swapOptions.fromTokenAmount = parseUnits(flags.amount, info.decimals)
  }

  console.log('EVM wallet:', signer.address, `(chain ${chainId})`)
  console.log(`\nSwapping ${flags.amount ?? '(invoice amount)'} ${info.symbol} -> ${toToken} for ${flags.recipient} ...`)
  console.log('(this funds the EVM HTLC, then drives the whole flow — it can take a little while)\n')

  const result = await protocol.swidge(swapOptions)

  console.log('Done:')
  console.log('  swap id: ', result.id)
  console.log(`  spent:   ${result.fromTokenAmount} ${info.symbol} (base units)`)
  console.log('  received:', result.toTokenAmount, 'sats')
  for (const tx of result.transactions) console.log(`  ${tx.type} tx (${tx.chain}): ${tx.hash}`)
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
