import { beforeEach, describe, expect, jest, test } from '@jest/globals'

// Mock the satora swap client so the unit tests stay fast and isolated and do
// not load its ESM-only dependency graph (exercised for real by the Node-based
// integration tests). Must be registered before importing the module.
jest.unstable_mockModule('@satora/swap', () => ({
  Client: {
    builder: () => {
      const builder = {
        withBaseUrl: () => builder,
        withMnemonic: () => builder,
        build: async () => ({})
      }
      return builder
    }
  }
}))

const { default: SatoraProtocol } = await import('../index.js')

describe('SatoraProtocol', () => {
  let account,
      protocol

  beforeEach(() => {
    account = {
      sendTransaction: jest.fn()
    }

    protocol = new SatoraProtocol(account)
  })

  describe('quoteSwidge', () => {
    test.todo('should successfully quote a swidge operation (exact-in)')

    test.todo('should successfully quote a swidge operation (exact-out)')
  })

  describe('swidge', () => {
    test.todo('should successfully perform a swidge operation (exact-in)')

    test.todo('should successfully perform a swidge operation (exact-out)')

    test.todo('should throw if the swidge fees exceed the max network fee configuration')

    test.todo('should throw if the swidge fees exceed the max protocol fee configuration')

    test.todo('should throw if the account is read-only')
  })

  describe('getSwidgeStatus', () => {
    test.todo('should successfully return the status of an operation')

    test.todo('should successfully return the status of an operation by filtering the source and target chain')

    test.todo('should throw if no operation exists for the given id')
  })

  describe('getSupportedChains', () => {
    test.todo('should successfully return supported chains')
  })

  describe('getSupportedTokens', () => {
    test.todo('should successfully return supported tokens')

    test.todo('should filter tokens by chain when options are provided')
  })
})
