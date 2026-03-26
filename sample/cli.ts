import WDK from '@tetherto/wdk'
import type { IWalletAccountWithProtocols } from '@tetherto/wdk'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED_FILE = join(homedir(), '.wdk-cli-seed')

const SUPPORTED_CHAINS = ['bitcoin', 'arbitrum'] as const
type ChainName = typeof SUPPORTED_CHAINS[number]

const NATIVE: Record<ChainName, { symbol: string; decimals: number }> = {
  bitcoin: { symbol: 'btc', decimals: 8 },
  arbitrum: { symbol: 'eth', decimals: 18 }
}

const TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
  arbitrum: {
    usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    usdt0: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadOrCreateSeed (): string {
  if (process.env.SEED_PHRASE) return process.env.SEED_PHRASE

  if (existsSync(SEED_FILE)) {
    return readFileSync(SEED_FILE, 'utf-8').trim()
  }

  const seed = WDK.getRandomSeedPhrase()
  writeFileSync(SEED_FILE, seed + '\n', { mode: 0o600 })
  console.log(`Generated new seed phrase and saved to ${SEED_FILE}`)
  console.log(`Seed: ${seed}`)
  console.log('Back this up!\n')
  return seed
}

async function initWdk (seed: string) {
  const wdk = new WDK(seed)
    .registerWallet('bitcoin', WalletManagerBtc as any, {
      client: { type: 'electrum', clientConfig: { host: 'blockstream.info', port: 700, protocol: 'ssl' } }
    })
    .registerWallet('arbitrum', WalletManagerEvm, {
      provider: 'https://arb1.arbitrum.io/rpc'
    })

  const accounts: Record<ChainName, IWalletAccountWithProtocols> = {
    bitcoin: await wdk.getAccount('bitcoin', 0),
    arbitrum: await wdk.getAccount('arbitrum', 0)
  }

  return { wdk, accounts }
}

function resolveChain (name: string): ChainName {
  const lower = name.toLowerCase() as ChainName
  if (!SUPPORTED_CHAINS.includes(lower)) {
    throw new Error(`Unknown chain "${name}". Supported: ${SUPPORTED_CHAINS.join(', ')}`)
  }
  return lower
}

function formatUnits (value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals)
  return `${whole}.${frac}`
}

function parseUnits (value: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = value.split('.')
  const padded = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + padded)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdBalance (accounts: Record<ChainName, IWalletAccountWithProtocols>, chain: ChainName, asset: string) {
  const account = accounts[chain]
  const native = NATIVE[chain]
  const assetLower = asset.toLowerCase()

  if (assetLower === native.symbol) {
    const balance = await account.getBalance()
    console.log(`${formatUnits(balance, native.decimals)} ${native.symbol.toUpperCase()}`)
    if (chain === 'bitcoin') console.log(`(${balance.toString()} sats)`)
  } else {
    const token = TOKENS[chain]?.[assetLower]
    if (!token) {
      throw new Error(`Unknown asset "${asset}" on ${chain}. Known tokens: ${Object.keys(TOKENS[chain] || {}).join(', ') || 'none'}`)
    }
    const balance = await account.getTokenBalance(token.address)
    console.log(`${formatUnits(balance, token.decimals)} ${asset.toUpperCase()}`)
  }
}

async function cmdReceive (accounts: Record<ChainName, IWalletAccountWithProtocols>, chain: ChainName) {
  const address = await accounts[chain].getAddress()
  console.log(`${chain}: ${address}`)
}

async function cmdSend (accounts: Record<ChainName, IWalletAccountWithProtocols>, chain: ChainName, to: string, amount: string, feeRate?: string) {
  const account = accounts[chain]
  const native = NATIVE[chain]
  const value = parseUnits(amount, native.decimals)

  console.log(`Sending ${amount} ${native.symbol.toUpperCase()} to ${to}...`)

  let result
  if (chain === 'bitcoin') {
    result = await account.sendTransaction({
      to,
      value: Number(value),
      ...(feeRate ? { feeRate: Number(feeRate) } : {})
    })
  } else {
    result = await account.sendTransaction({ to, value })
  }

  console.log(`TX: ${result.hash}`)
  console.log(`Fee: ${result.fee.toString()} ${chain === 'bitcoin' ? 'sats' : 'wei'}`)
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage () {
  console.log(`Usage:
  cli balance <chain> <asset>              Check balance
  cli send <chain> <to> <amount> [feeRate] Send native asset
  cli receive <chain>                      Show receive address

Chains: ${SUPPORTED_CHAINS.join(', ')}
Assets: btc, eth, usdt, usdt0, usdc

Examples:
  cli balance bitcoin btc
  cli balance arbitrum usdt0
  cli send bitcoin bc1q... 0.001 2
  cli receive arbitrum`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main () {
  const [command, ...args] = process.argv.slice(2)

  if (!command || command === 'help') {
    printUsage()
    return
  }

  const seed = loadOrCreateSeed()
  const { wdk, accounts } = await initWdk(seed)

  try {
    switch (command) {
      case 'balance': {
        if (args.length < 2) throw new Error('Usage: cli balance <chain> <asset>')
        const chain = resolveChain(args[0])
        await cmdBalance(accounts, chain, args[1])
        break
      }
      case 'receive': {
        if (args.length < 1) throw new Error('Usage: cli receive <chain>')
        const chain = resolveChain(args[0])
        await cmdReceive(accounts, chain)
        break
      }
      case 'send': {
        if (args.length < 3) throw new Error('Usage: cli send <chain> <to> <amount> [feeRate]')
        const chain = resolveChain(args[0])
        await cmdSend(accounts, chain, args[1], args[2], args[3])
        break
      }
      default:
        console.error(`Unknown command: ${command}`)
        printUsage()
        process.exitCode = 1
    }
  } finally {
    wdk.dispose()
  }
}

main().catch(err => {
  console.error('Error:', err.message || err)
  process.exit(1)
})
