# Satora Bridge Sample

Bridge Bitcoin to USDT on Arbitrum using WDK with the Satora bridge protocol.

## What this does

1. Creates a WDK instance with both a **Bitcoin wallet** and an **EVM (Arbitrum) wallet** from a single seed phrase
2. Registers the **Satora bridge protocol** on the Bitcoin wallet
3. Gets a quote for bridging BTC → USDT
4. Creates a swap and prints deposit instructions (a Bitcoin HTLC address)
5. Polls for swap completion, then claims the USDT on Arbitrum (gasless via Gelato)

## Setup

```bash
npm install
```

## Run

```bash
# Generate a fresh wallet
npm start

# Or restore from an existing seed phrase
SEED_PHRASE="your twelve word seed phrase here ..." npm start

# Customize the bridge amount (in satoshis, default: 100000)
BRIDGE_AMOUNT=200000 npm start
```

## Configuration

All configuration is optional. Edit `index.ts` or set environment variables:

| Env Variable       | Description                           | Default                          |
|--------------------|---------------------------------------|----------------------------------|
| `SEED_PHRASE`      | BIP39 seed phrase for both wallets    | Randomly generated               |
| `BRIDGE_AMOUNT`    | Amount to bridge in satoshis          | `100000` (0.001 BTC)            |
| `SATORA_API_KEY`   | Lendaswap API key                     | None                             |

## Bridge Lifecycle

```
bridge()  →  Send BTC to deposit address  →  Poll getSwap()  →  claim()  →  USDT received
                                                                    OR
                                                               refund() on timeout
```
