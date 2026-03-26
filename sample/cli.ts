import WDK from '@tetherto/wdk'
import type { IWalletAccountWithProtocols } from '@tetherto/wdk'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import SatoraProtocolBitcoin from '@satora/wdk-protocol-bridge-satora-bitcoin'
import type { SatoraProtocolConfig, SatoraBridgeOptions } from '@satora/wdk-protocol-bridge-satora-bitcoin'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED_FILE = join(homedir(), '.wdk-cli-seed')
const POLL_INTERVAL_MS = 10_000

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

/** Parse --key value pairs from argv. Returns { flags, positional }. */
function parseFlags (args: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[++i]
    } else {
      positional.push(args[i])
    }
  }
  return { flags, positional }
}

/** Parse "chain:token" into { chain, token }. Token defaults to the chain's native asset. */
function parseChainToken (value: string): { chain: ChainName; token: string } {
  const [chainStr, token] = value.split(':')
  const chain = resolveChain(chainStr)
  return { chain, token: (token || NATIVE[chain].symbol).toLowerCase() }
}

/** Resolve a token key to its decimals on a given chain. */
function getDecimals (chain: ChainName, tokenKey: string): number {
  return TOKENS[chain]?.[tokenKey]?.decimals ?? NATIVE[chain].decimals
}

/** Resolve a token key to its contract address (or 'btc' for bitcoin). */
function getTokenAddress (chain: ChainName, tokenKey: string): string {
  if (chain === 'bitcoin' && tokenKey === 'btc') return 'btc'
  const info = TOKENS[chain]?.[tokenKey]
  if (!info) {
    throw new Error(`Unknown token "${tokenKey}" on ${chain}. Known: ${Object.keys(TOKENS[chain] || {}).join(', ') || NATIVE[chain].symbol}`)
  }
  return info.address
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

async function cmdSwap (accounts: Record<ChainName, IWalletAccountWithProtocols>, flags: Record<string, string>) {
  if (!flags.source || !flags.target) {
    throw new Error('Required: --source <chain:token> --target <chain:token> and --source-amount or --target-amount')
  }
  if (!flags['source-amount'] && !flags['target-amount']) {
    throw new Error('Provide either --source-amount or --target-amount')
  }

  const src = parseChainToken(flags.source)
  const tgt = parseChainToken(flags.target)
  const account = accounts[src.chain]

  const satoraConfig: SatoraProtocolConfig = {}
  const satora = new SatoraProtocolBitcoin(account, satoraConfig)

  const srcDecimals = getDecimals(src.chain, src.token)
  const tgtDecimals = getDecimals(tgt.chain, tgt.token)
  const srcTokenAddress = getTokenAddress(src.chain, src.token)
  const tgtTokenAddress = getTokenAddress(tgt.chain, tgt.token)

  // Parse amount — one of the two must be set
  const sourceAmount = flags['source-amount'] ? Number(parseUnits(flags['source-amount'], srcDecimals)) : undefined
  const targetAmount = flags['target-amount'] ? Number(parseUnits(flags['target-amount'], tgtDecimals)) : undefined
  const amount = sourceAmount ?? targetAmount!

  const recipientAddress = await accounts[tgt.chain].getAddress()

  const bridgeOptions: SatoraBridgeOptions = {
    sourceChain: src.chain,
    sourceToken: srcTokenAddress,
    amount,
    recipient: recipientAddress,
    targetChain: tgt.chain,
    token: tgtTokenAddress
  }

  console.log(`Swap: ${src.chain}:${src.token} → ${tgt.chain}:${tgt.token}`)
  console.log()

  // Quote
  const quote = await satora.quoteBridge(bridgeOptions)
  console.log('Quote:')
  console.log(`  Exchange rate : ${quote.exchangeRate}`)
  console.log(`  Network fee   : ${quote.fee.toString()} sats`)
  console.log(`  Protocol fee  : ${quote.bridgeFee.toString()} sats`)
  console.log(`  You receive   : ${quote.targetAmount} (smallest unit)`)
  console.log(`  Min/Max       : ${quote.minAmount} / ${quote.maxAmount} sats`)
  console.log()

  // Balance check
  const isEvmSrc = satora.isEvmSource(bridgeOptions)

  if (isEvmSrc) {
    const srcToken = TOKENS[src.chain]?.[src.token]
    if (srcToken) {
      const tokenBal = await account.getTokenBalance(srcToken.address)
      console.log(`Token balance: ${formatUnits(tokenBal, srcToken.decimals)} ${src.token.toUpperCase()}`)
      if (sourceAmount && tokenBal < BigInt(sourceAmount)) {
        const addr = await account.getAddress()
        console.log(`\nInsufficient token balance. Send tokens to ${addr} and try again.`)
        return
      }
    }
  } else if (sourceAmount) {
    const balance = await account.getBalance()
    const estimatedTxFee = BigInt(300)
    const totalRequired = BigInt(sourceAmount) + estimatedTxFee
    console.log(`Balance: ${balance.toString()} sats, need ~${totalRequired.toString()} sats`)
    if (balance < totalRequired) {
      const addr = await account.getAddress()
      console.log(`\nInsufficient balance. Send BTC to ${addr} and try again.`)
      return
    }
  }
  console.log()

  // Create swap
  console.log('Creating swap...')
  const bridge = await satora.bridge(bridgeOptions)

  console.log(`Swap ID  : ${bridge.hash}`)
  console.log(`Deposit  : ${bridge.depositAmount.toString()} (smallest unit)`)
  console.log(`Receive  : ${bridge.targetAmount} ${tgt.token.toUpperCase()}`)

  // Fund the swap based on source chain type
  if (bridge.depositAddress) {
    console.log(`Address  : ${bridge.depositAddress}`)
    console.log()
    console.log('Funding swap...')
    const tx = await account.sendTransaction({
      to: bridge.depositAddress,
      value: Number(bridge.depositAmount)
    })
    console.log(`Funded: ${tx.hash}`)
  } else if (bridge.evmHtlcAddress) {
    console.log(`HTLC     : ${bridge.evmHtlcAddress}`)
    console.log()
    console.log('Funding swap via gasless relay...')
    const { txHash } = await satora.fundSwapGasless(bridge.hash)
    console.log(`Funded: ${txHash}`)
  } else if (bridge.lightningInvoice) {
    console.log(`Invoice  : ${bridge.lightningInvoice}`)
    console.log('\nPay this Lightning invoice to fund the swap.')
  }

  // Poll
  console.log('\nWaiting for swap completion...')
  while (true) {
    const swap = await satora.getSwap(bridge.hash)
    console.log(`  Status: ${swap.status}`)

    if (swap.status === 'serverfunded') break
    if (swap.status === 'clientrefunded' || swap.status === 'clientrefundedserverrefunded') {
      console.log('Swap was refunded.')
      return
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Claim
  console.log('\nClaiming...')
  const claim = await satora.claim(bridge.hash)
  console.log('Done!', JSON.stringify(claim, null, 2))
  console.log(`${tgt.token.toUpperCase()} should now be in: ${recipientAddress}`)
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage () {
  console.log(`Usage:
  cli balance <chain> <asset>              Check balance
  cli send <chain> <to> <amount> [feeRate] Send native asset
  cli receive <chain>                      Show receive address
  cli swap --source <chain:token> --target <chain:token> --source-amount <n> | --target-amount <n>

Chains: ${SUPPORTED_CHAINS.join(', ')}
Assets: btc, eth, usdt, usdt0, usdc

Examples:
  cli balance bitcoin btc
  cli balance arbitrum usdt0
  cli send bitcoin bc1q... 0.001 2
  cli receive arbitrum
  cli swap --source bitcoin:btc --target arbitrum:usdt --source-amount 0.001
  cli swap --source arbitrum:usdt --target bitcoin:btc --target-amount 0.001
  cli swap --source arbitrum:usdt --target bitcoin:btc --source-amount 10`)
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
      case 'swap': {
        const { flags } = parseFlags(args)
        await cmdSwap(accounts, flags)
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
