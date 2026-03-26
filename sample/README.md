# Satora Bridge Sample

A CLI wallet and bridge demo using WDK with the Satora bridge protocol. Manages Bitcoin and Arbitrum wallets from a
single seed phrase.

## Setup

```bash
npm install
```

## CLI

```bash
npm run cli -- <command> [args]
```

### Commands

#### `balance <chain> <asset>`

Check the balance of a native asset or token.

```bash
npm run cli -- balance bitcoin btc
npm run cli -- balance arbitrum eth
npm run cli -- balance arbitrum usdt0
```

#### `receive <chain>`

Show the receive address for a chain.

```bash
npm run cli -- receive bitcoin
npm run cli -- receive arbitrum
```

#### `send <chain> <to> <amount> [feeRate]`

Send native assets. Amount is in human-readable units (BTC, not sats). The optional `feeRate` is in sat/vB for Bitcoin.

```bash
npm run cli -- send bitcoin bc1q... 0.001 2
npm run cli -- send arbitrum 0x... 0.01
```

#### `swap --source <chain:token> --target <chain:token> --source-amount <n> | --target-amount <n>`

Bridge between chains via the Satora protocol. Specify source and target as `chain:token` pairs. Provide either
`--source-amount` (how much to send) or `--target-amount` (how much to receive).

```bash
# BTC → USDT on Arbitrum (send 0.001 BTC)
npm run cli -- swap --source bitcoin:btc --target arbitrum:usdt --source-amount 0.001

# USDT → BTC (send 10 USDT)
npm run cli -- swap --source arbitrum:usdt --target bitcoin:btc --source-amount 10

# USDT → BTC (receive exactly 0.001 BTC)
npm run cli -- swap --source arbitrum:usdt --target bitcoin:btc --target-amount 0.001
```

### Supported chains and assets

| Chain      | Native | Tokens                  |
|------------|--------|-------------------------|
| `bitcoin`  | `btc`  | —                       |
| `arbitrum` | `eth`  | `usdt`, `usdt0`, `usdc` |

### Seed phrase

The CLI loads the seed phrase from (in order):

1. `SEED_PHRASE` environment variable
2. `~/.wdk-cli-seed` file
3. Generates a new one and saves to `~/.wdk-cli-seed`

```bash
# Use a specific seed
SEED_PHRASE="your twelve word seed phrase ..." npm run cli -- balance bitcoin btc
```

## Bridge script

The `index.ts` script runs a full end-to-end bridge flow (BTC on-chain to USDT on Arbitrum):

```bash
npm start
```

It will:

1. Initialize both wallets from a seed phrase
2. Quote the bridge
3. Check the BTC balance
4. Create a swap and fund the deposit address
5. Poll until the server funds the EVM side
6. Claim the USDT on Arbitrum (gasless)

### Bridge configuration

| Env Variable    | Description                        | Default            |
|-----------------|------------------------------------|--------------------|
| `SEED_PHRASE`   | BIP39 seed phrase for both wallets | Randomly generated |
| `BRIDGE_AMOUNT` | Amount to bridge in satoshis       | `10000`            |
