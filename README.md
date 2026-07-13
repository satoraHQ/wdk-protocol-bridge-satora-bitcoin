# @satora/wdk-protocol-swidge-satora

[![build](https://github.com/satoraHQ/wdk-protocol-bridge-satora-bitcoin/actions/workflows/build.yml/badge.svg)](https://github.com/satoraHQ/wdk-protocol-bridge-satora-bitcoin/actions/workflows/build.yml)
[![Built with WDK](assets/built-with-wdk.png)](https://github.com/tetherto/wdk)

A [WDK](https://github.com/tetherto/wdk) swidge protocol that performs
cross-chain atomic swaps via the [Satora](https://docs.satora.io/) protocol —
BTC (on-chain), Arkade, and Lightning on one side, EVM tokens on the other.

`SatoraProtocol` subclasses `SwidgeProtocol` from `@tetherto/wdk-wallet`, so it
plugs into WDK like any other swidge provider.

## Installation

```bash
npm install @satora/wdk-protocol-swidge-satora
```

## Supported directions

The account you pass to the constructor is the **source** wallet; the
destination is always given as `options.recipient`.

| From ↓ / To →          | EVM | Arkade | Bitcoin | Lightning |
|------------------------|:---:|:------:|:-------:|:---------:|
| **EVM**                |  —  |   ✅    |    ✅    |     ✅     |
| **Arkade**             |  ✅  |   —    |    —    |     —     |
| **Bitcoin** (on-chain) |  ✅  |   —    |    —    |     —     |
| **Lightning**          |  ✅  |   —    |    —    |     —     |

## Token identifiers

Tokens are **chain-qualified** as `chain:tokenId`, so `fromToken`/`toToken`
carry the chain (WDK's `SwidgeOptions` has no `fromChain`):

- EVM: `42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9` (USDT0 on Arbitrum)
- Bitcoin (on-chain): `Bitcoin:btc`
- Arkade: `Arkade:btc`
- Lightning: `Lightning:btc`

EVM chains use their numeric id (`1`, `137`, `42161`); Bitcoin-family chains use
their name. `btc` alone is ambiguous, which is why the chain prefix is required.
Discover the exact ids with `getSupportedTokens()`.

## The account model

Your module never holds keys for the source funding — that flows through the
**account** you construct the protocol with. Each source chain needs a
different capability, so the account differs by direction:

| Source             | Account must provide                                                                                                                                                | How it funds                               |
|--------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------|
| Arkade             | `sendTransaction({ to, value })`                                                                                                                                    | native Arkade send to the VHTLC            |
| Bitcoin (on-chain) | `sendTransaction({ to, value })`                                                                                                                                    | on-chain BTC send to the HTLC              |
| Lightning          | `payInvoice(bolt11)`                                                                                                                                                | pays the swap's BOLT11 invoice             |
| EVM                | an [`EvmSigner`](https://docs.satora.io/) (`address`, `chainId`, `signTypedData`, `sendTransaction({ to, data, gas })`, `waitForReceipt`, `getTransaction`, `call`) | `fundSwap` (token approval + HTLC deposit) |

The EVM source needs a full `EvmSigner` (richer than WDK's `IWalletAccount`) —
build one from viem/ethers. The `examples/` directory has a ready adapter for
each wallet type.

Separately, the **swap client** needs its own secret material (the HTLC preimage
and the gasless-claim key) plus a database — these are `config.mnemonic` and
`config.signerStorage`/`config.swapStorage`, not the account.

## Configuration

```javascript
new SatoraProtocol(account, {
  mnemonic,          // swap-client secret: HTLC preimage + gasless-claim key
  signerStorage,     // WalletStorage — persists the seed / key index (the DB)
  swapStorage,       // SwapStorage  — persists per-swap state (recovery/refund)
  accountChains,     // e.g. ['Arkade'] or [1, 137, 42161] — swidge validates the source chain
  feeRateSatPerVb,   // on-chain fee rate for an EVM -> Bitcoin claim (default: SDK default)
  defaultSlippage,   // decimal, e.g. 0.01 for 1%
  baseUrl,           // Satora API base URL (defaults to production)
  arkadeServerUrl,   // Arkade server URL
  esploraUrl         // Esplora (Bitcoin) API URL
})
```

- **Read-only** operations (`getSupportedChains`, `getSupportedTokens`,
  `quoteSwidge`) need no account, mnemonic, or storage.
- **Fund-moving** operations (`swidge`, `resumeSwidge`, `refundSwidge`) need the
  account and the swap client's `mnemonic` + storage. Storage is **strongly
  recommended** and pluggable (`Sqlite*` in Node, IndexedDB in the browser) so
  an interrupted swap survives a restart and can be recovered.
- `accountChains` is optional but recommended: WDK accounts expose no chain id,
  so declaring the account's chains lets `swidge` reject a mismatched source
  before creating a swap.

## Usage

### Discovery & quotes (no account)

```javascript
import SatoraProtocol from '@satora/wdk-protocol-swidge-satora'

const satora = new SatoraProtocol()

await satora.getSupportedChains()
await satora.getSupportedTokens({ toChain: 42161 })

const quote = await satora.quoteSwidge({
  fromToken: 'Bitcoin:btc',
  toToken: '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT0 on Arbitrum
  fromTokenAmount: 100000n // 0.001 BTC in sats
})
```

### Executing a swap

`swidge` is **one-shot**: it creates the swap, funds the source, drives the
claim, waits for settlement, and resolves with the `SwidgeResult`.

```javascript
// Arkade -> EVM (account is an Arkade wallet)
const satora = new SatoraProtocol(arkadeAccount, {
  mnemonic, signerStorage, swapStorage, accountChains: ['Arkade']
})

const result = await satora.swidge({
  fromToken: 'Arkade:btc',
  toToken: '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  fromTokenAmount: 100000n,
  recipient: '0xYourEvmAddress' // destination — the account is the source
})
```

```javascript
// EVM -> Lightning (account is an EvmSigner; recipient is a BOLT11 invoice)
await satora.swidge({
  fromToken: '42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',
  toToken: 'Lightning:btc',
  recipient: 'lnbc...' // the amount is carried by the invoice
})
```

### Status & recovery

```javascript
await satora.getSwidgeStatus(result.id) // -> { status, transactions }

// Recover a swap interrupted after funding (needs the same storage):
await satora.resumeSwidge(result.id)    // drive it to completion, or throw

// If it can't complete, reclaim the source funds:
await satora.refundSwidge(result.id)    // direction-aware
```

`refundSwidge` dispatches on the swap direction:

- **EVM source** — reclaims the EVM HTLC with the account's `EvmSigner`,
  collaborative/gasless by default (no timelock wait), or `{ manual: true }`
  for the timelock refund; `{ settlement: 'swap-back' | 'direct' }`.
- **Arkade / Bitcoin source** — reclaims to the account's address.
- **Lightning source** — throws; the unpaid invoice simply expires.

## API

- `getSupportedChains()` → `SwidgeSupportedChain[]`
- `getSupportedTokens(options?)` → `SwidgeSupportedToken[]`
- `quoteSwidge(options)` → `SwidgeQuote`
- `swidge(options, config?)` → `SwidgeResult`
- `getSwidgeStatus(id, options?)` → `SwidgeStatusResult`
- `resumeSwidge(id, options?)` → completes a persisted swap (Satora extension)
- `refundSwidge(id, options?)` → reclaims a stuck swap (Satora extension)

The inherited `swap`/`quoteSwap`/`bridge`/`quoteBridge` delegate to
`swidge`/`quoteSwidge`.

## Examples

Runnable CLIs live in [`examples/`](./examples) — one per wallet type, all
sharing a single seed via `examples/.env` (copy from `examples/.env.example`):

| CLI                    | Wallet                             | Directions                         |
|------------------------|------------------------------------|------------------------------------|
| `satora-cli.js`        | none (read-only)                   | chains / tokens / quote            |
| `satora-cli-arkade.js` | Arkade (`@arkade-os/sdk`)          | Arkade → EVM                       |
| `satora-cli-evm.js`    | EVM (`viem`)                       | EVM → Arkade / Bitcoin / Lightning |
| `satora-cli-spark.js`  | Spark (`@buildonspark/spark-sdk`)  | Lightning → EVM                    |
| `satora-cli-btc.js`    | on-chain BTC (`@scure/btc-signer`) | Bitcoin → EVM                      |

```bash
node examples/satora-cli.js tokens --to-chain 42161
node --env-file=examples/.env examples/satora-cli-arkade.js swap \
  --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 --recipient 0x... --amount 0.0001
```

## Development

```bash
npm install
npm test              # unit tests (jest, mocked SDK)
npm run lint

# live read-only tests against production (opt-in)
SATORA_INTEGRATION=1 npm run test:integration
```

## License

Apache-2.0
