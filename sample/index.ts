/**
 * Sample: Bridge Bitcoin to USDT on Arbitrum
 *
 * This example demonstrates:
 * 1. Initializing WDK with Bitcoin and EVM wallets
 * 2. Registering the Satora bridge protocol on the Bitcoin wallet
 * 3. Getting a quote for bridging BTC → USDT (Arbitrum)
 * 4. Creating a bridge swap and printing deposit instructions
 * 5. Sending BTC from the Bitcoin wallet to fund the swap
 * 6. Polling for swap completion and claiming the USDT
 */

import type {
  SatoraBridgeOptions,
  SatoraBridgeResult,
  SatoraProtocolConfig,
} from '@satora/wdk-protocol-bridge-satora-bitcoin'
import SatoraProtocolBitcoin from '@satora/wdk-protocol-bridge-satora-bitcoin'
import type { IWalletAccountWithProtocols } from '@tetherto/wdk'
import WDK from '@tetherto/wdk'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Generate a fresh seed phrase or restore an existing one
const seedPhrase: string = process.env.SEED_PHRASE || WDK.getRandomSeedPhrase()

// Satora bridge configuration (all optional — sensible defaults are used)
const satoraConfig: SatoraProtocolConfig = {
  // apiKey: process.env.SATORA_API_KEY,          // Lendaswap API key
  // mnemonic: process.env.SATORA_MNEMONIC,       // separate mnemonic for swap key derivation
  // baseUrl: 'https://api.lendaswap.com/',        // Lendaswap API URL
  // esploraUrl: 'https://mempool.space/api',      // Bitcoin esplora URL
  // bridgeMaxFee: 50_000,                         // max fee in sats — rejects if exceeded
  // referralCode: 'my-referral-code',             // referral code
}

// Amount to bridge in satoshis (e.g. 100 000 sats = 0.0001 BTC)
const BRIDGE_AMOUNT_SATS = Number(process.env.BRIDGE_AMOUNT || 10_000)

// Poll interval for swap status (ms)
const POLL_INTERVAL_MS = 10_000

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== Satora Bridge Sample ===\n')

  // --- 1. Initialize WDK with Bitcoin + EVM wallets ---

  console.log('Seed phrase:', seedPhrase, '\n')
  console.log('⚠  Back up this seed phrase! It controls both wallets.\n')

  const wdk = new WDK(seedPhrase)
    .registerWallet('bitcoin', WalletManagerBtc as any, {
      client: { type: 'electrum', clientConfig: { host: 'blockstream.info', port: 700, protocol: 'ssl' } },
    })
    .registerWallet('arbitrum', WalletManagerEvm, {
      provider: 'https://arb1.arbitrum.io/rpc',
    })

  // --- 2. Get accounts ---

  const btcAccount: IWalletAccountWithProtocols = await wdk.getAccount('bitcoin', 0)
  const evmAccount: IWalletAccountWithProtocols = await wdk.getAccount('arbitrum', 0)

  const btcAddress: string = await btcAccount.getAddress()
  const evmAddress: string = await evmAccount.getAddress()

  console.log('Bitcoin address :', btcAddress)
  console.log('EVM address     :', evmAddress)
  console.log()

  // --- 3. Create the Satora bridge protocol instance directly ---

  // We instantiate directly rather than using wdk.registerProtocol() + getBridgeProtocol()
  // because the symlinked plugin resolves a different copy of BridgeProtocol than WDK,
  // which causes the instanceof check in registerProtocol to silently fail.
  const satora = new SatoraProtocolBitcoin(btcAccount, satoraConfig)

  // --- 4. Quote the bridge ---

  console.log(`Quoting bridge for ${BRIDGE_AMOUNT_SATS} sats → USDT on Arbitrum...\n`)

  const bridgeOptions: SatoraBridgeOptions = {
    sourceChain: 'bitcoin',
    amount: BRIDGE_AMOUNT_SATS,
    recipient: evmAddress,
    targetChain: 'arbitrum',
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT on Arbitrum
  }

  const quote = await satora.quoteBridge(bridgeOptions)

  console.log('Quote:')
  console.log('  Exchange rate :', quote.exchangeRate)
  console.log('  Network fee   :', quote.fee.toString(), 'sats')
  console.log('  Protocol fee  :', quote.bridgeFee.toString(), 'sats')
  console.log('  You receive   :', quote.targetAmount, 'USDT (smallest unit)')
  console.log('  Min amount    :', quote.minAmount, 'sats')
  console.log('  Max amount    :', quote.maxAmount, 'sats')
  console.log()

  // --- 5. Check BTC balance ---

  const btcBalance = await btcAccount.getBalance()
  // A typical 1-input 1-output SegWit tx is ~110 vbytes. At ~2 sat/vB that's ~220 sats.
  const estimatedTxFee = BigInt(300)
  const totalRequired = BigInt(BRIDGE_AMOUNT_SATS) + estimatedTxFee
  console.log('BTC balance     :', btcBalance.toString(), 'sats')
  console.log(
    'Total required  :',
    totalRequired.toString(),
    `sats (${BRIDGE_AMOUNT_SATS} deposit + ~${estimatedTxFee.toString()} on-chain fee)`,
  )

  if (btcBalance < totalRequired) {
    console.log(`\nInsufficient balance. Need ~${totalRequired.toString()} sats, have ${btcBalance.toString()}.`)
    console.log(`Send BTC to ${btcAddress} and try again.`)
    return
  }

  console.log()

  // --- 6. Create the bridge swap ---

  console.log('Creating bridge swap...\n')

  const bridge: SatoraBridgeResult = await satora.bridge(bridgeOptions)

  console.log('Swap created!')
  console.log('  Swap ID         :', bridge.hash)
  console.log('  Deposit address :', bridge.depositAddress)
  console.log('  Deposit amount  :', bridge.depositAmount.toString(), 'sats')
  console.log('  You will receive:', bridge.targetAmount, 'USDT (smallest unit)')
  console.log()

  // --- 7. Fund the swap — send BTC from wallet to the deposit address ---

  if (!bridge.depositAddress) {
    throw new Error('Expected a deposit address for an on-chain swap')
  }

  console.log(`Sending ${bridge.depositAmount.toString()} sats to deposit address...\n`)

  const fundingTx = await btcAccount.sendTransaction({
    to: bridge.depositAddress,
    value: Number(bridge.depositAmount),
  })

  console.log('Funding TX broadcast!')
  console.log('  TX ID:', fundingTx.hash)
  console.log()

  // --- 8. Poll for deposit confirmation and server funding ---

  console.log('Waiting for deposit confirmation and server funding...')

  while (true) {
    const swap = await satora.getSwap(bridge.hash)
    console.log(`  Status: ${swap.status}`)

    if (swap.status === 'serverfunded') {
      console.log('\nServer has funded the EVM side! Claiming...\n')
      break
    }

    if (swap.status === 'clientrefunded' || swap.status === 'clientrefundedserverrefunded') {
      console.log('\nSwap was refunded. Exiting.')
      return
    }

    await sleep(POLL_INTERVAL_MS)
  }

  // --- 9. Claim the USDT ---

  const claimResult = await satora.claim(bridge.hash)

  console.log('Claim successful!')
  console.log('  Result:', JSON.stringify(claimResult, null, 2))
  console.log()
  console.log('Done! USDT should now be in your EVM wallet:', evmAddress)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
