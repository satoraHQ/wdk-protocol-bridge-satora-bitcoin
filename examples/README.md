# Examples

`satora-cli.js` is a small manual sample for exercising `SatoraProtocol`
against a live Satora deployment. It constructs the protocol exactly like a
real consumer would, so it doubles as living documentation.

All commands are **read-only** (discovery and quotes) — no account, mnemonic,
API key, or build step is required, and no funds are moved. By default it hits
production (`https://api.satora.io/`).

Run everything from the module root:

```bash
node examples/satora-cli.js <command> [options]
```

## Commands

### `chains` — list supported chains

```bash
node examples/satora-cli.js chains
```

EVM chains are shown with numeric ids (`1`, `137`, `42161`); Bitcoin-family
chains by name (`Bitcoin`, `Lightning`, `Arkade`).

### `tokens` — list supported tokens

```bash
node examples/satora-cli.js tokens

# optionally filter by chain
node examples/satora-cli.js tokens --to-chain 42161
node examples/satora-cli.js tokens --from-chain Bitcoin
```

The first column is the **chain-qualified token id** (`chain:tokenId`), e.g.
`Bitcoin:btc`, `Lightning:btc`, `42161:0xfd08…`. Copy it straight into `quote`.
(Note `btc` alone is ambiguous — `Bitcoin:btc`, `Lightning:btc` and `Arkade:btc`
are three different things.) The `decimals` column tells you the base unit for
amounts.

### `quote` — quote a swidge

Pass chain-qualified token ids and one amount:

```bash
# exact-in: spend 0.001 BTC, receive Arbitrum USDT0
node examples/satora-cli.js quote \
  --from Bitcoin:btc \
  --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
  --amount 0.001

# exact-out: receive exactly 10 USDT0, pay from BTC
node examples/satora-cli.js quote \
  --from Bitcoin:btc \
  --to 42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9 \
  --out-amount 10
```

Amounts are in **decimal token units** — `--amount` in the source token
(e.g. `0.001` BTC), `--out-amount` in the destination token (e.g. `10` USDT0).
Use `--amount` for exact-in (source amount) or `--out-amount` for exact-out
(destination amount).

The quote is printed in **decimal token units**:

```
Quote:
  spend:   0.001 BTC  (Bitcoin:btc)
  receive: 58.71538 USDT0 (min 58.71538)  (42161:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9)
  fees:
    protocol 0.0000025 btc  Protocol fee (rate 0.0025)
    network  0.00000179 btc  Network fee (HTLC create/claim + BTC mining)
```

## Typical flow

```bash
# 1. find a token id
node examples/satora-cli.js tokens --to-chain 42161

# 2. quote against it
node examples/satora-cli.js quote --from Bitcoin:btc --to 42161:0xfd08… --amount 0.001
```

## Options

| Option              | Applies to | Description                                                  |
| ------------------- | ---------- | ------------------------------------------------------------ |
| `--base-url <url>`  | all        | Override the API base URL (or set `SATORA_BASE_URL`).        |
| `--from-chain <id>` | `tokens`   | Filter tokens by source chain.                               |
| `--to-chain <id>`   | `tokens`   | Filter tokens by destination chain.                          |
| `--from <chain:id>` | `quote`    | Source token, chain-qualified.                               |
| `--to <chain:id>`   | `quote`    | Destination token, chain-qualified.                          |
| `--to-chain <id>`   | `quote`    | Destination chain (fallback if `--to` isn't chain-qualified).|
| `--amount <n>`      | `quote`    | Exact-in amount, in source token units (e.g. `0.001`).       |
| `--out-amount <n>`  | `quote`    | Exact-out amount, in destination token units (e.g. `10`).    |

Point at a non-production deployment with `--base-url` or `SATORA_BASE_URL`:

```bash
SATORA_BASE_URL=https://staging.satora.io/ node examples/satora-cli.js chains
```
