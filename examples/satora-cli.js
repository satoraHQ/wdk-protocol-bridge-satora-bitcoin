#!/usr/bin/env node
// Copyright 2026 bonomat <philipp@lendasat.com>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// A small manual sample for exercising the SatoraProtocol against a live
// satora deployment (production by default). It constructs the protocol
// exactly like a real consumer would, so it doubles as living documentation.
//
//   node examples/satora-cli.js chains
//   SATORA_BASE_URL=https://api.satora.io/ node examples/satora-cli.js chains
//
// More commands (tokens, quote, swidge, status) will land alongside the
// implementation of the corresponding protocol methods.

import SatoraProtocol from '../index.js'

function parseArgs (argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function createProtocol (flags) {
  const baseUrl = flags['base-url'] || process.env.SATORA_BASE_URL
  const config = baseUrl ? { baseUrl } : {}
  return new SatoraProtocol(undefined, config)
}

async function chains (flags) {
  const protocol = createProtocol(flags)
  const supported = await protocol.getSupportedChains()

  console.log(`Supported chains (${supported.length}):\n`)
  for (const chain of supported) {
    console.log(
      `  ${String(chain.id).padEnd(10)} ${chain.name.padEnd(20)} ${chain.type.padEnd(10)} native: ${chain.nativeToken}`
    )
  }
}

async function tokens (flags) {
  const protocol = createProtocol(flags)
  const options = {}
  if (flags['from-chain'] !== undefined) options.fromChain = flags['from-chain']
  if (flags['to-chain'] !== undefined) options.toChain = flags['to-chain']

  const supported = await protocol.getSupportedTokens(options)

  console.log(`Supported tokens (${supported.length}):\n`)
  for (const token of supported) {
    // token.token is the chain-qualified id to pass to `quote` as --from/--to.
    console.log(
      `  ${token.token.padEnd(46)} ${token.symbol.padEnd(8)} decimals: ${String(token.decimals).padEnd(4)} ${token.name}`
    )
  }
}

// BTC (and its Lightning/Arkade variants) use 8 decimals; satora quotes fees in
// satoshis, denominated in BTC.
const BTC_DECIMALS = 8

// Formats a base-unit bigint as a decimal string with the given decimals.
function formatUnits (amount, decimals) {
  const value = BigInt(amount)
  const negative = value < 0n
  const abs = negative ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = (abs / base).toString()
  const fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

// Parses a decimal token amount into a base-unit bigint (e.g. "0.001" @ 8 -> 100000n).
function parseUnits (value, decimals) {
  const str = String(value).trim()
  const negative = str.startsWith('-')
  const [whole, fraction = ''] = (negative ? str.slice(1) : str).split('.')
  if (fraction.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places`)
  }
  const result = BigInt(`${whole || '0'}${fraction.padEnd(decimals, '0')}`)
  return negative ? -result : result
}

async function quote (flags) {
  const protocol = createProtocol(flags)

  // Look up decimals up front: input amounts are given in decimal token units
  // and converted to base units, and the output is formatted the same way.
  const supported = await protocol.getSupportedTokens()
  const byId = new Map(supported.map(token => [token.token, token]))
  const decimalsOf = (tokenId) => {
    const info = byId.get(tokenId)
    if (!info) throw new Error(`unknown token "${tokenId}" — run the "tokens" command to list valid ids`)
    return info.decimals
  }

  const options = { fromToken: flags.from, toToken: flags.to }
  if (flags['to-chain'] !== undefined) options.toChain = flags['to-chain']
  if (flags.amount !== undefined) {
    options.fromTokenAmount = parseUnits(flags.amount, decimalsOf(flags.from))
  } else if (flags['out-amount'] !== undefined) {
    options.toTokenAmount = parseUnits(flags['out-amount'], decimalsOf(flags.to))
  }

  const result = await protocol.quoteSwidge(options)

  const format = (amount, tokenId) => {
    const info = byId.get(tokenId)
    if (!info) return `${amount} (base units)`
    return `${formatUnits(amount, info.decimals)} ${info.symbol}`
  }
  const bare = (amount, tokenId) => {
    const info = byId.get(tokenId)
    return info ? formatUnits(amount, info.decimals) : String(amount)
  }

  console.log('Quote:')
  console.log(`  spend:   ${format(result.fromTokenAmount, options.fromToken)}  (${options.fromToken})`)
  console.log(`  receive: ${format(result.toTokenAmount, options.toToken)} (min ${bare(result.toTokenAmountMin, options.toToken)})  (${options.toToken})`)
  console.log('  fees:')
  for (const fee of result.fees) {
    const description = fee.description ? `  ${fee.description}` : ''
    console.log(`    ${fee.type.padEnd(8)} ${formatUnits(fee.amount, BTC_DECIMALS)} ${fee.token}${description}`)
  }
}

const COMMANDS = {
  chains,
  tokens,
  quote
}

function usage () {
  console.log(`satora-cli — manual sample for @satora/wdk-protocol-swidge-satora

Usage:
  node examples/satora-cli.js <command> [options]

Commands:
  chains            List the chains supported by the satora protocol
  tokens            List the tokens supported by the satora protocol
  quote             Quote a swidge using chain-qualified token ids, e.g.
                    --from Bitcoin:btc --to 42161:0xfd08... --amount 0.001

Options:
  --base-url <url>   Override the satora API base URL (or set SATORA_BASE_URL).
                     Defaults to the SDK's production endpoint.
  --from-chain <id>  Source-chain filter (tokens command).
  --to-chain <id>    Dest-chain filter (tokens) / destination chain (quote).
  --from <chain:id>  Source token, chain-qualified (quote).
  --to <chain:id>    Destination token, chain-qualified (quote).
  --amount <n>       Exact-in amount in source token units, e.g. 0.001 (quote).
  --out-amount <n>   Exact-out amount in destination token units (quote).`)
}

async function main () {
  const { positional, flags } = parseArgs(process.argv.slice(2))
  const command = positional[0]

  if (!command || flags.help) {
    usage()
    process.exit(command ? 0 : 1)
  }

  const handler = COMMANDS[command]
  if (!handler) {
    console.error(`Unknown command: ${command}\n`)
    usage()
    process.exit(1)
  }

  await handler(flags)
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
