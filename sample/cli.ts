import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isBtcOnchain, isEvmToken, isLightning } from '@lendasat/lendaswap-sdk-pure'
import { sqliteStorageFactory } from '@lendasat/lendaswap-sdk-pure/node'
import type { SatoraBridgeOptions, SatoraProtocolConfig } from '@satora/wdk-protocol-bridge-satora-bitcoin'
import SatoraProtocolBitcoin from '@satora/wdk-protocol-bridge-satora-bitcoin'
import type { IWalletAccountWithProtocols } from '@tetherto/wdk'
import WDK from '@tetherto/wdk'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import WalletManagerSpark, {LightningSendRequest, WalletAccountSpark} from '@tetherto/wdk-wallet-spark'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEED_FILE = join(homedir(), '.wdk-cli-seed')
const DB_FILE = join(homedir(), '.wdk-cli-swaps.db')
const POLL_INTERVAL_MS = 1_000

const SUPPORTED_CHAINS = ['Bitcoin', 'Arbitrum', 'Spark', 'Lightning'] as const
type ChainName = (typeof SUPPORTED_CHAINS)[number]

const NATIVE: Record<ChainName, { symbol: string; decimals: number }> = {
  Bitcoin: { symbol: 'btc', decimals: 8 },
  Arbitrum: { symbol: 'eth', decimals: 18 },
  Spark: { symbol: 'btc', decimals: 8 },
  Lightning: { symbol: 'btc', decimals: 8 },
}

const TOKENS: Record<string, Record<string, { address: string; decimals: number }>> = {
  Arbitrum: {
    usdt: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    usdt0: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 },
    usdc: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadOrCreateSeed(): string {
  if (process.env.SEED_PHRASE) return process.env.SEED_PHRASE

  if (existsSync(SEED_FILE)) {
    return readFileSync(SEED_FILE, 'utf-8').trim()
  }

  const seed = WDK.getRandomSeedPhrase()
  writeFileSync(SEED_FILE, `${seed}\n`, { mode: 0o600 })
  console.log(`Generated new seed phrase and saved to ${SEED_FILE}`)
  console.log(`Seed: ${seed}`)
  console.log('Back this up!\n')
  return seed
}

async function initWdk(seed: string) {
  const wdk = new WDK(seed)
    .registerWallet('bitcoin', WalletManagerBtc as any, {
      client: { type: 'electrum', clientConfig: { host: 'blockstream.info', port: 700, protocol: 'ssl' } },
    })
    .registerWallet('arbitrum', WalletManagerEvm, {
      provider: 'https://arb1.arbitrum.io/rpc',
    })
    .registerWallet('spark', WalletManagerSpark as any, {
      network: 'MAINNET',
    })

  const accounts: Record<ChainName, IWalletAccountWithProtocols> = {
    Bitcoin: await wdk.getAccount('bitcoin', 0),
    Arbitrum: await wdk.getAccount('arbitrum', 0),
    Spark: await wdk.getAccount('spark', 0),
    Lightning: await wdk.getAccount('spark', 0),
  }

  return { wdk, accounts }
}

function resolveChain(name: string): ChainName {
  const chainName = name as ChainName
  if (!SUPPORTED_CHAINS.includes(chainName)) {
    throw new Error(`Unknown chain "${name}". Supported: ${SUPPORTED_CHAINS.join(', ')}`)
  }
  if (chainName === 'Spark') {
    // for now spark is connected via lightning payments because spark is not supported directly yet
    return 'Lightning'
  }
  return chainName
}

function formatUnits(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals)
  return `${whole}.${frac}`
}

function parseUnits(value: string, decimals: number): bigint {
  const [whole = '0', frac = ''] = value.split('.')
  const padded = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole + padded)
}

/** Parse --key value pairs from argv. Returns { flags, positional }. */
function parseFlags(args: string[]): { flags: Record<string, string>; positional: string[] } {
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
function parseChainToken(value: string): { chain: ChainName; token: string } {
  const [chainStr, token] = value.split(':')
  const chain = resolveChain(chainStr)
  return { chain, token: (token || NATIVE[chain].symbol).toLowerCase() }
}

/** Resolve a token key to its decimals on a given chain. */
function getDecimals(chain: ChainName, tokenKey: string): number {
  return TOKENS[chain]?.[tokenKey]?.decimals ?? NATIVE[chain].decimals
}

/** Resolve a token key to its contract address (or 'btc' for bitcoin/spark). */
function getTokenAddress(chain: ChainName, tokenKey: string): string {
  if ((chain === 'Bitcoin' || chain === 'Spark' || chain === 'Lightning') && tokenKey === 'btc') return 'btc'
  const info = TOKENS[chain]?.[tokenKey]
  if (!info) {
    throw new Error(
      `Unknown token "${tokenKey}" on ${chain}. Known: ${Object.keys(TOKENS[chain] || {}).join(', ') || NATIVE[chain].symbol}`,
    )
  }
  return info.address
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdBalance(accounts: Record<ChainName, IWalletAccountWithProtocols>, chain: ChainName, asset: string) {
  const account = accounts[chain]
  const native = NATIVE[chain]
  const assetLower = asset.toLowerCase()

  if (assetLower === native.symbol) {
    const balance = await account.getBalance()
    console.log(`${formatUnits(balance, native.decimals)} ${native.symbol.toUpperCase()}`)
    if (chain === 'Bitcoin') console.log(`(${balance.toString()} sats)`)
  } else {
    const token = TOKENS[chain]?.[assetLower]
    if (!token) {
      throw new Error(
        `Unknown asset "${asset}" on ${chain}. Known tokens: ${Object.keys(TOKENS[chain] || {}).join(', ') || 'none'}`,
      )
    }
    const balance = await account.getTokenBalance(token.address)
    console.log(`${formatUnits(balance, token.decimals)} ${asset.toUpperCase()}`)
  }
}

async function cmdReceive(accounts: Record<ChainName, IWalletAccountWithProtocols>, chain: ChainName, amount?: string) {
  const account = accounts[chain]
  const address = await account.getAddress()
  console.log(`${chain}: ${address}`)

  if ((chain === 'Spark' || chain === 'Lightning') && amount) {
    const sats = Number(amount)
    const sparkAccount = account as any
    const result = await sparkAccount.createLightningInvoice({ amountSats: sats })
    console.log()
    console.log(`Lightning invoice (${sats} sats):`)
    console.log(result.invoice?.encodedInvoice ?? result.encodedInvoice ?? JSON.stringify(result, null, 2))
  }
}

async function cmdSend(
  accounts: Record<ChainName, IWalletAccountWithProtocols>,
  chain: ChainName,
  to: string,
  amount: string,
  feeRate?: string,
) {
  const account = accounts[chain]
  const native = NATIVE[chain]
  const value = parseUnits(amount, native.decimals)

  console.log(`Sending ${amount} ${native.symbol.toUpperCase()} to ${to}...`)

  let result: { hash: string; fee: bigint }
  if (chain === 'Bitcoin') {
    result = await account.sendTransaction({
      to,
      value: Number(value),
      ...(feeRate ? { feeRate: Number(feeRate) } : {}),
    })
  } else {
    result = await account.sendTransaction({ to, value })
  }

  console.log(`TX: ${result.hash}`)
  console.log(`Fee: ${result.fee.toString()} ${chain === 'Bitcoin' ? 'sats' : 'wei'}`)
}

async function cmdSwap(accounts: Record<ChainName, IWalletAccountWithProtocols>, flags: Record<string, string>) {
  if (!flags.source || !flags.target) {
    throw new Error('Required: --source <chain:token> --target <chain:token> and --source-amount or --target-amount')
  }
  if (!flags['source-amount'] && !flags['target-amount']) {
    throw new Error('Provide either --source-amount or --target-amount')
  }

  const src = parseChainToken(flags.source)
  const tgt = parseChainToken(flags.target)
  const account = accounts[src.chain]

  const storage = sqliteStorageFactory(DB_FILE)
  const satoraConfig: SatoraProtocolConfig = {
    walletStorage: storage.walletStorage,
    swapStorage: storage.swapStorage,
  }
  const satora = new SatoraProtocolBitcoin(account, satoraConfig)

  try {
    const srcDecimals = getDecimals(src.chain, src.token)
    const tgtDecimals = getDecimals(tgt.chain, tgt.token)
    const srcTokenAddress = getTokenAddress(src.chain, src.token)
    const tgtTokenAddress = getTokenAddress(tgt.chain, tgt.token)

    // Parse amount — one of the two must be set
    const sourceAmount = flags['source-amount'] ? Number(parseUnits(flags['source-amount'], srcDecimals)) : undefined
    const targetAmount = flags['target-amount'] ? Number(parseUnits(flags['target-amount'], tgtDecimals)) : undefined
    const amount = sourceAmount ?? targetAmount!

    // For Spark targets, create a Lightning invoice so the swap pays into Spark
    let recipientAddress: string
    if (tgt.chain === 'Spark' && targetAmount) {
      const sparkAccount = accounts.Spark as unknown as WalletAccountSpark
      const invoice = await sparkAccount.createLightningInvoice({ amountSats: targetAmount })
      recipientAddress = invoice.invoice.encodedInvoice
      console.log(`Created Lightning invoice for ${targetAmount} sats`)
    } else if (tgt.chain === 'Spark' && sourceAmount) {
      // We don't know the exact target amount yet — use the source address as placeholder.
      // The swap will use sourceAmount and the server determines the target.
      recipientAddress = await accounts[tgt.chain].getAddress()
    } else {
      recipientAddress = await accounts[tgt.chain].getAddress()
    }

    const bridgeOptions: SatoraBridgeOptions = {
      sourceChain: src.chain,
      sourceToken: srcTokenAddress,
      amount,
      recipient: recipientAddress,
      targetChain: tgt.chain,
      token: tgtTokenAddress,
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
      // Spark has zero fees; Bitcoin needs ~300 sats for a 1-in 1-out tx
      const estimatedTxFee = src.chain === 'Spark' || src.chain === 'Lightning' ? BigInt(0) : BigInt(300)
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
    const satoraBridgeResult = await satora.bridge(bridgeOptions)

    console.log(`Swap ID  : ${satoraBridgeResult.hash}`)
    console.log(`Deposit  : ${satoraBridgeResult.depositAmount.toString()} (smallest unit)`)
    console.log(`Receive  : ${satoraBridgeResult.targetAmount} ${tgt.token.toUpperCase()}`)
    console.log(`Source chain: ${bridgeOptions.sourceChain}, ${isLightning({ chain: bridgeOptions.sourceChain })}`)

    let lightningPaymentId: string | undefined
    const sparkAccount = accounts.Spark as unknown as WalletAccountSpark

    if (isLightning({ chain: bridgeOptions.sourceChain }) && satoraBridgeResult.lightningInvoice) {
      console.log('Funding swap...')
      const payment = await sparkAccount.payLightningInvoice({
        invoice: satoraBridgeResult.lightningInvoice,
        maxFeeSats: 1000,
      })
      console.log(`Paid: ${JSON.stringify(payment)}`)
      lightningPaymentId = payment.id

      // Poll until the Lightning payment settles
      console.log('Checking Lightning payment status...')
      while (true) {
        const sendRequest : LightningSendRequest | null = await sparkAccount.getLightningSendRequest(payment.id)
        const status = sendRequest?.status
        console.log(`  Lightning payment status: ${status}`)

        if (status === 'TRANSFER_COMPLETED' || status === 'LIGHTNING_PAYMENT_SUCCEEDED' || status === 'PREIMAGE_PROVIDED' || status === 'LIGHTNING_PAYMENT_INITIATED') {
          break
        }
        if (status === 'USER_SWAP_RETURNED' || status === 'USER_SWAP_RETURN_FAILED' || status === 'LIGHTNING_PAYMENT_FAILED' || status === 'TRANSFER_FAILED') {
          console.error(`\nLightning payment failed:`)
          console.error(`  Status   : ${status}`)
          console.error(`  Invoice  : ${sendRequest?.encodedInvoice}`)
          console.error(`  Fee      : ${sendRequest?.fee?.originalValue ?? 'n/a'} ${sendRequest?.fee?.originalUnit ?? ''}`)
          console.error(`  Updated  : ${sendRequest?.updatedAt}`)
          throw new Error(`Lightning payment failed (${status}). Funds should be returned to your Spark wallet.`)
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    } else if (isBtcOnchain({ chain: bridgeOptions.sourceChain }) && satoraBridgeResult.depositAddress) {
      console.log('Funding swap...')
      const tx = await account.sendTransaction({
        to: satoraBridgeResult.depositAddress,
        value: Number(satoraBridgeResult.depositAmount),
      })
      console.log(`Funded: ${tx.hash}`)
    } else if (isEvmToken(bridgeOptions.sourceChain)) {
      throw Error('not yet implemented')
    } else {
      throw Error('Unsupported swapping direction')
    }

    // Poll
    console.log('\nWaiting for swap completion...')
    while (true) {
      const swap = await satora.getSwap(satoraBridgeResult.hash)
      console.log(`  Status: ${swap.status}`)

      if (swap.status === 'serverfunded') break
      if (swap.status === 'clientrefunded' || swap.status === 'clientrefundedserverrefunded') {
        console.log('Swap was refunded.')
        return
      }

      // If the swap is still pending and we paid via Lightning, check if the payment failed
      if (lightningPaymentId) {
        const sendRequest = await sparkAccount.getLightningSendRequest(lightningPaymentId)
        const lnStatus = sendRequest?.status
        if (lnStatus === 'USER_SWAP_RETURNED' || lnStatus === 'USER_SWAP_RETURN_FAILED' || lnStatus === 'LIGHTNING_PAYMENT_FAILED' || lnStatus === 'TRANSFER_FAILED') {
          console.error(`\nLightning payment failed:`)
          console.error(`  Status   : ${lnStatus}`)
          console.error(`  Invoice  : ${sendRequest?.encodedInvoice}`)
          console.error(`  Fee      : ${sendRequest?.fee?.originalValue ?? 'n/a'} ${sendRequest?.fee?.originalUnit ?? ''}`)
          console.error(`  Updated  : ${sendRequest?.updatedAt}`)
          console.error(`  SendRequest  : ${JSON.stringify(sendRequest)}`)
          throw new Error(`Lightning payment failed (${lnStatus}). Funds should be returned to your Spark wallet.`)
        }
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }

    // Claim
    console.log('\nClaiming...')
    const claim = await satora.claim(satoraBridgeResult.hash)
    console.log('Done!', JSON.stringify(claim, null, 2))
    console.log(`${tgt.token.toUpperCase()} should now be in: ${recipientAddress}`)
  } finally {
    storage.close()
  }
}

async function cmdPaymentStatus(accounts: Record<ChainName, IWalletAccountWithProtocols>, paymentId: string) {
  const account = accounts.Spark as unknown as WalletAccountSpark
  const sendRequest = await account.getLightningSendRequest(paymentId)
  if (sendRequest) {
    console.log('Payment status:', sendRequest.status)
  } else {
    console.log('No send request found for:', paymentId)
  }
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`Usage:
  cli balance <chain> <asset>              Check balance
  cli send <chain> <to> <amount> [feeRate] Send native asset
  cli receive <chain> [sats]                Show address (+ Lightning invoice for Spark)
  cli swap --source <chain:token> --target <chain:token> --source-amount <n> | --target-amount <n>
  cli payment-status <paymentId>          Check Lightning payment status

Chains: ${SUPPORTED_CHAINS.join(', ')}
Assets: btc, eth, usdt, usdt0, usdc

Examples:
  cli balance Bitcoin btc
  cli balance Spark btc
  cli balance Arbitrum usdt0
  cli send Bitcoin bc1q... 0.001 2
  cli receive Spark
  cli receive Spark 10000
  cli swap --source Bitcoin:btc --target Arbitrum:usdt --source-amount 0.001
  cli swap --source Spark:btc --target Arbitrum:usdt --source-amount 0.001
  cli swap --source Arbitrum:usdt --target Spark:btc --source-amount 10
  cli swap --source Arbitrum:usdt --target Bitcoin:btc --target-amount 0.001`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
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
        if (args.length < 1) throw new Error('Usage: cli receive <chain> [amount]')
        const chain = resolveChain(args[0])
        await cmdReceive(accounts, chain, args[1])
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
      case 'payment-status': {
        if (args.length < 1) throw new Error('Usage: cli payment-status <paymentId>')
        await cmdPaymentStatus(accounts, args[0])
        break
      }
      default:
        console.error(`Unknown command: ${command}`)
        printUsage()
        process.exitCode = 1
    }
  } finally {
      try {
          wdk.dispose()
      } catch (err) {
          console.error(`Failed to dispose: ${err}`)
      }
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err)
  if (err.cause) console.error('Cause:', err.cause)
  if (err.response) console.error('Response:', JSON.stringify(err.response, null, 2))
  if (err.stack && !err.message) console.error(err.stack)
  process.exit(1)
})
