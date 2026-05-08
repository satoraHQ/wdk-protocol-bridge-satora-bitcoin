# Satora Bridge Sample

A CLI wallet and bridge demo using WDK with the Satora bridge protocol. Manages Bitcoin, Arbitrum, and Spark
(Lightning) wallets from a single seed phrase.

## Setup

```bash
npm install
```

## CLI

```bash
npm run cli -- <command> [args]
```

Chain names are case-sensitive: `Bitcoin`, `Arbitrum`, `Spark`, `Lightning`. `Spark` and `Lightning` share the same
underlying Spark wallet — `Lightning` is an alias used to make Lightning-based flows explicit.

### Commands

#### `balance <chain> <asset>`

Check the balance of a native asset or token.

```bash
npm run cli -- balance Bitcoin btc
npm run cli -- balance Spark btc
npm run cli -- balance Arbitrum eth
npm run cli -- balance Arbitrum usdt0
```

#### `receive <chain> [sats]`

Show the receive address for a chain. For `Spark` / `Lightning`, passing an amount in sats also generates a Lightning
invoice for that amount.

```bash
npm run cli -- receive Bitcoin
npm run cli -- receive Arbitrum
npm run cli -- receive Spark
npm run cli -- receive Spark 10000
```

#### `send <chain> <to> <amount> [feeRate]`

Send native assets. Amount is in human-readable units (BTC, not sats). The optional `feeRate` is in sat/vB for Bitcoin.
For `Spark` / `Lightning`, `<to>` can be a Spark address or a Lightning invoice.

```bash
npm run cli -- send Bitcoin bc1q... 0.001 2
npm run cli -- send Arbitrum 0x... 0.01
npm run cli -- send Spark sp1p... 0.0001
```

#### `swap --source <chain:token> --target <chain:token> --source-amount <n> | --target-amount <n>`

Bridge between chains via the Satora protocol. Specify source and target as `chain:token` pairs. Provide either
`--source-amount` (how much to send) or `--target-amount` (how much to receive).

```bash
# BTC → USDT on Arbitrum (send 0.001 BTC)
npm run cli -- swap --source Bitcoin:btc --target Arbitrum:usdt --source-amount 0.001

# Spark → USDT on Arbitrum (send 0.001 BTC via Lightning)
npm run cli -- swap --source Spark:btc --target Arbitrum:usdt --source-amount 0.001

# USDT → Spark (send 10 USDT, receive BTC on Spark via Lightning)
npm run cli -- swap --source Arbitrum:usdt --target Spark:btc --source-amount 10

# USDT → BTC on-chain (receive exactly 0.001 BTC)
npm run cli -- swap --source Arbitrum:usdt --target Bitcoin:btc --target-amount 0.001
```

Spark swaps use Lightning under the hood — the CLI automatically creates/pays Lightning invoices via the Spark wallet.

#### `payment-status <paymentId>`

Check the status of a Lightning payment by its ID (useful for diagnosing in-flight or stuck Spark swaps).

```bash
npm run cli -- payment-status <paymentId>
```

### Supported chains and assets

| Chain       | Native | Tokens                  |
|-------------|--------|-------------------------|
| `Bitcoin`   | `btc`  | —                       |
| `Arbitrum`  | `eth`  | `usdt`, `usdt0`, `usdc` |
| `Spark`     | `btc`  | —                       |
| `Lightning` | `btc`  | —                       |

### Seed phrase

The CLI loads the seed phrase from (in order):

1. `SEED_PHRASE` environment variable
2. `~/.wdk-cli-seed` file
3. Generates a new one and saves to `~/.wdk-cli-seed`

```bash
# Use a specific seed
SEED_PHRASE="your twelve word seed phrase ..." npm run cli -- balance Bitcoin btc
```

Swap state is persisted to `~/.wdk-cli-swaps.db` (SQLite).

## Test flow: Lightning → USDT0 on Arbitrum

A simple end-to-end smoke test: receive sats over Lightning, then bridge them to USDT0 on Arbitrum.

1. **Generate a Lightning invoice** for 10 000 sats:

   ```bash
   npm run cli -- receive Spark 10000
   ```

   Copy the `lnbc...` invoice and pay it from any external Lightning wallet.

2. **Confirm the funds arrived** on the Spark wallet:

   ```bash
   npm run cli -- balance Spark btc
   ```

3. **Bridge to USDT0** on Arbitrum (sending ~9 000 sats so there's headroom for the Lightning + bridge fees):

   ```bash
   npm run cli -- swap --source Spark:btc --target Arbitrum:usdt0 --source-amount 0.00009
   ```

   The CLI will print a quote, pay the swap's Lightning invoice from the Spark wallet, poll until the server funds the
   Arbitrum side, and then claim the USDT0 (gasless).

4. **Verify the USDT0 balance** on Arbitrum:

   ```bash
   npm run cli -- balance Arbitrum usdt0
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
