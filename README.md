# @satora/wdk-protocol-bridge-satora-bitcoin

WDK module to bridge Bitcoin (on-chain) to USDT via the [Lendaswap](https://lendaswap.com) atomic swap protocol. Currently supports Bitcoin → USDT on Arbitrum.

## Installation

```bash
npm install @satora/wdk-protocol-bridge-satora-bitcoin
```

## Usage

```javascript
import SatoraProtocolBitcoin from '@satora/wdk-protocol-bridge-satora-bitcoin'
import { IdbWalletStorage, IdbSwapStorage } from '@satora/wdk-protocol-bridge-satora-bitcoin/storage'

// Create bridge protocol with browser storage
const bridge = new SatoraProtocolBitcoin(account, {
  walletStorage: new IdbWalletStorage(),
  swapStorage: new IdbSwapStorage(),
  apiKey: 'optional-api-key'
})

// 1. Get a quote
const quote = await bridge.quoteBridge({
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT on Arbitrum
  amount: 100_000n // 100,000 sats
})

console.log('Fee:', quote.fee, 'sats')
console.log('Bridge fee:', quote.bridgeFee, 'sats')
console.log('You will receive:', quote.targetAmount, 'USDT (smallest unit)')

// 2. Create a bridge swap
const result = await bridge.bridge({
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  amount: 100_000n
})

console.log('Swap ID:', result.hash)
console.log('Send BTC to:', result.depositAddress)
console.log('Amount:', result.depositAmount, 'sats')

// 3. After sending BTC, poll for server funding
let swap = await bridge.getSwap(result.hash)
// Wait until swap.status === 'serverfunded'

// 4. Claim the HTLC (gasless)
const claim = await bridge.claim(result.hash)
console.log('Claimed:', claim.success)

// 5. If something goes wrong, refund
const refund = await bridge.refund(result.hash, {
  destinationAddress: 'bc1q...'
})
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
  - `baseUrl` - API URL (default: `https://api.lendaswap.com/`)
  - `esploraUrl` - Bitcoin API URL (default: `https://mempool.space/api`)
  - `walletStorage` - Wallet storage backend (default: `InMemoryWalletStorage`)
  - `swapStorage` - Swap storage backend (default: `InMemorySwapStorage`)
  - `referralCode` - Optional referral code

#### Methods

| Method | Description |
|---|---|
| `quoteBridge(options)` | Get a fee quote for a bridge operation |
| `bridge(options)` | Create a swap and get deposit instructions |
| `getSwap(swapId)` | Check the current status of a swap |
| `claim(swapId, options?)` | Claim the HTLC after server funds the EVM side |
| `refund(swapId, options?)` | Refund a swap (collaborative or on-chain) |
| `listSwaps()` | List all tracked swaps from local storage |
| `recoverSwaps()` | Recover swaps from the server using the wallet's xpub |

### Storage

The module ships with pluggable storage. Import from `@satora/wdk-protocol-bridge-satora-bitcoin/storage`:

| Storage | Environment | Persistence |
|---|---|---|
| `InMemoryWalletStorage` / `InMemorySwapStorage` | Any | None (lost on close) |
| `IdbWalletStorage` / `IdbSwapStorage` | Browser | IndexedDB |

For Node.js SQLite storage, import directly from `@lendasat/lendaswap-sdk-pure/node`.

For React Native, implement the `WalletStorage` and `SwapStorage` interfaces with your preferred storage (e.g., AsyncStorage, MMKV).

## Swap Lifecycle

```
bridge() → User sends BTC → Server locks EVM HTLC → claim() → Done
                                                   ↘ refund() (if timeout)
```

1. **`bridge()`** - Creates the swap, returns a BTC deposit address and amount
2. **User sends BTC** - Send exactly `depositAmount` to `depositAddress`
3. **Poll `getSwap()`** - Wait for status `serverfunded`
4. **`claim()`** - Claims the USDT on the target chain (gasless by default)
5. **`refund()`** - If something goes wrong, refund your BTC

## Development

```bash
npm install
npm test
npm run lint
```

## License

Apache-2.0
