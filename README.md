# @satora/wdk-protocol-bridge-satora-bitcoin

WDK module to make bitcoin BIP-32 wallets interact with the satora bridge protocol.

## Installation

```bash
npm install @satora/wdk-protocol-bridge-satora-bitcoin
```

## Usage

```javascript
import SatoraProtocol from '@satora/wdk-protocol-bridge-satora-bitcoin'
import WalletManagerBitcoin from '@tetherto/wdk-wallet-bitcoin'

// Create wallet and get account
const wallet = new WalletManagerBitcoin('your mnemonic...')
const account = await wallet.getAccount()

// Create bridge protocol
const bridgeProtocol = new SatoraProtocolBitcoin(account)

// Get a quote
const quote = await bridgeProtocol.quoteBridge({
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: 'USDT_ADDRESS',
  amount: 1000000n
})

console.log('Quote:', quote)

// Execute bridge
const result = await bridgeProtocol.bridge({
  targetChain: 'arbitrum',
  recipient: '0x...',
  token: 'USDT_ADDRESS',
  amount: 1000000n
})

console.log('Bridge result:', result)
```

## API Reference

### SatoraProtocolBitcoin

#### Constructor

```javascript
new SatoraProtocolBitcoin(account, config?)
```

- `account` - Wallet account (full or read-only)
- `config` - Optional configuration
  - `bridgeMaxFee` - Maximum allowed bridge fee

#### Methods

- `bridge(options)` - Execute a cross-chain bridge
- `quoteBridge(options)` - Get a quote for a bridge

## Development

```bash
npm install
npm test
npm run lint
```

## License

Apache-2.0
