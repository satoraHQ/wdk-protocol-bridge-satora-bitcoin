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
    const address = token.address ? `  ${token.address}` : ''
    console.log(
      `  ${String(token.chain).padEnd(10)} ${token.symbol.padEnd(8)} decimals: ${String(token.decimals).padEnd(4)} ${token.name}${address}`
    )
  }
}

const COMMANDS = {
  chains,
  tokens
}

function usage () {
  console.log(`satora-cli — manual sample for @satora/wdk-protocol-swidge-satora

Usage:
  node examples/satora-cli.js <command> [options]

Commands:
  chains            List the chains supported by the satora protocol
  tokens            List the tokens supported by the satora protocol

Options:
  --base-url <url>  Override the satora API base URL (or set SATORA_BASE_URL).
                    Defaults to the SDK's production endpoint.
  --from-chain <id> Filter tokens by source chain (tokens command).
  --to-chain <id>   Filter tokens by destination chain (tokens command).`)
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
