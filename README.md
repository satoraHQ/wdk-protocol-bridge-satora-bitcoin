# @satora/wdk-protocol-bridge-satora-bitcoin

WDK bridge protocol for swapping between Bitcoin, Lightning, Spark, and EVM chains via the [Lendaswap](https://lendaswap.com) atomic swap protocol.

## Supported Directions

| Source | Target |
|---|---|
| Bitcoin (on-chain) | EVM (Arbitrum, Ethereum, Polygon) |
| Lightning / Spark | EVM (Arbitrum, Ethereum, Polygon) |
| EVM (Arbitrum, Ethereum, Polygon) | Bitcoin (on-chain) |
| EVM (Arbitrum, Ethereum, Polygon) | Lightning / Spark |
| Bitcoin (on-chain) | Arkade |
| Lightning | Arkade |

## Installation

```bash
npm install @satora/wdk-protocol-bridge-satora-bitcoin
```

## Usage

```javascript
import SatoraProtocolBitcoin from '@satora/wdk-protocol-bridge-satora-bitcoin'
import { IdbWalletStorage, IdbSwapStorage } from '@satora/wdk-protocol-bridge-satora-bitcoin/storage'

// Create bridge protocol with browser storage
const satora = new SatoraProtocolBitcoin(account, {
  walletStorage: new IdbWalletStorage(),
  swapStorage: new IdbSwapStorage(),
  apiKey: 'optional-api-key'
})

// 1. Get a quote
const quote = await satora.quoteBridge({
  sourceChain: 'bitcoin',
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT on Arbitrum
  amount: 100_000 // 100,000 sats
})

console.log('Fee:', quote.fee, 'sats')
console.log('Bridge fee:', quote.bridgeFee, 'sats')
console.log('You will receive:', quote.targetAmount, 'USDT (smallest unit)')

// 2. Create a bridge swap
const result = await satora.bridge({
  sourceChain: 'bitcoin',
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  amount: 100_000
})

console.log('Swap ID:', result.hash)

// Bitcoin on-chain → deposit address
if (result.depositAddress) {
  console.log('Send BTC to:', result.depositAddress)
  console.log('Amount:', result.depositAmount, 'sats')
}

// Lightning/Spark → pay invoice
if (result.lightningInvoice) {
  console.log('Pay invoice:', result.lightningInvoice)
}

// EVM source → fund via gasless relay
if (result.evmHtlcAddress) {
  await satora.fundSwapGasless(result.hash)
}

// 3. Poll for server funding
let swap = await satora.getSwap(result.hash)
// Wait until swap.status === 'serverfunded'

// 4. Claim the HTLC (gasless)
const claim = await satora.claim(result.hash)

// 5. If something goes wrong, refund
const refund = await satora.refund(result.hash, {
  destinationAddress: 'bc1q...'
})
```

### Lightning / Spark Example

```javascript
const result = await satora.bridge({
  sourceChain: 'lightning', // or 'spark'
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  amount: 50_000
})

// Pay the Lightning invoice to fund the swap
console.log('Pay invoice:', result.lightningInvoice)
```

### EVM to Bitcoin Example

```javascript
const result = await satora.bridge({
  sourceChain: 'arbitrum',
  sourceToken: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
  targetChain: 'bitcoin',
  recipient: 'bc1q...',
  token: 'btc',
  amount: 10_000_000 // 10 USDT (6 decimals)
})

// Fund via gasless Permit2 relay
await satora.fundSwapGasless(result.hash)
```

## API Reference

### SatoraProtocolBitcoin

#### Constructor

```javascript
new SatoraProtocolBitcoin(account, config?)
```

- `account` - WDK wallet account (full or read-only)
- `config` - Optional configuration:
  - `bridgeMaxFee` - Maximum allowed total fee (sats). Throws if exceeded.
  - `apiKey` - Lendaswap API key
  - `mnemonic` - BIP39 mnemonic for lendaswap key derivation (auto-generated if omitted)
  - `baseUrl` - API URL (default: `https://api.lendaswap.com`)
  - `esploraUrl` - Bitcoin API URL (default: `https://mempool.space/api`)
  - `walletStorage` - Wallet storage backend (default: `InMemoryWalletStorage`)
  - `swapStorage` - Swap storage backend (default: `InMemorySwapStorage`)
  - `referralCode` - Optional referral code

#### Bridge Options

| Field | Required | Description |
|---|---|---|
| `sourceChain` | Yes | Source chain: `bitcoin`, `lightning`, `spark`, `arkade`, or EVM chain ID |
| `sourceToken` | No | Source token address. Defaults to `btc`. |
| `targetChain` | Yes | Target chain name or ID |
| `token` | Yes | Target token address or `btc` |
| `recipient` | Yes | Recipient address on target chain |
| `amount` | Yes | Amount in source token's smallest unit |
| `gasless` | No | Use gasless relay. Only relevant for EVM source swaps. |

#### Bridge Result

| Field | Description |
|---|---|
| `hash` | Swap ID |
| `fee` | Network fee (bigint, sats) |
| `bridgeFee` | Protocol fee (bigint, sats) |
| `depositAddress` | Bitcoin HTLC address (BTC on-chain sources) |
| `lightningInvoice` | Lightning invoice to pay (Lightning/Spark sources) |
| `evmHtlcAddress` | EVM HTLC contract address (EVM sources) |
| `depositAmount` | Exact deposit amount (bigint, smallest unit) |
| `targetAmount` | Amount to receive (string, smallest unit) |

#### Methods

| Method | Description |
|---|---|
| `quoteBridge(options)` | Get a fee quote for a bridge operation |
| `bridge(options)` | Create a swap and get deposit instructions |
| `fundSwapGasless(swapId)` | Fund an EVM-sourced swap via Permit2 relay |
| `isEvmSource(options)` | Check if the source chain is an EVM chain |
| `getSwap(swapId)` | Check the current status of a swap |
| `claim(swapId, options?)` | Claim the HTLC after server funds the target side |
| `refund(swapId, options?)` | Refund a swap (collaborative or on-chain) |
| `listSwaps()` | List all tracked swaps from local storage |
| `recoverSwaps()` | Recover swaps from the server using the wallet's xpub |

### Storage

The module ships with pluggable storage. Import from `@satora/wdk-protocol-bridge-satora-bitcoin/storage`:

| Storage | Environment | Persistence |
|---|---|---|
| `InMemoryWalletStorage` / `InMemorySwapStorage` | Any | None (lost on close) |
| `IdbWalletStorage` / `IdbSwapStorage` | Browser | IndexedDB |

For Node.js SQLite storage, import directly from `@lendasat/lendaswap-sdk-pure/node`:

```javascript
import { sqliteStorageFactory } from '@lendasat/lendaswap-sdk-pure/node'

const { walletStorage, swapStorage, close } = sqliteStorageFactory('/path/to/swaps.db')
```

## Swap Lifecycle

```
bridge() → Fund swap → Server locks target HTLC → claim() → Done
                                                  ↘ refund() (if timeout)
```

**Funding depends on the source chain:**
- **Bitcoin on-chain**: Send BTC to `depositAddress`
- **Lightning / Spark**: Pay the `lightningInvoice`
- **EVM**: Call `fundSwapGasless(swapId)` for gasless Permit2 funding

## Development

```bash
npm install
npm test
npm run lint          # Standard (JS)
npm run format        # Biome format (TS)
npm run check         # Biome lint (TS)
npm run build:types   # Generate .d.ts
```

## License

Apache-2.0
