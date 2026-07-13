/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeOptions} SwidgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeQuote} SwidgeQuote */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeResult} SwidgeResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeProtocolConfig} SwidgeProtocolConfig */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusOptions} SwidgeStatusOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeStatusResult} SwidgeStatusResult */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedChain} SwidgeSupportedChain */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedToken} SwidgeSupportedToken */
/** @typedef {import('@tetherto/wdk-wallet/protocols').SwidgeSupportedTokensOptions} SwidgeSupportedTokensOptions */
/** @typedef {import('@satora/swap').Client} SatoraClient */
/** @typedef {import('@satora/swap').EvmSigner} EvmSigner */
/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number} [defaultSlippage] - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
 * @property {string} [baseUrl] - Override the satora API base URL. Defaults to the SDK's production endpoint.
 * @property {string} [mnemonic] - BIP39 mnemonic for the swap client's secret material (HTLC preimage + gasless-claim key). Separate from the funding account. Not required for read-only operations (chains, tokens, quotes).
 * @property {string} [arkadeServerUrl] - Override the Arkade server URL.
 * @property {string} [esploraUrl] - Override the Esplora (Bitcoin) API URL.
 * @property {Object} [signerStorage] - A satora `WalletStorage` adapter persisting the seed / key index (the swap client's database). Recommended for fund-moving operations so an interrupted swap survives a restart. Omit for in-memory (not recoverable across restarts).
 * @property {Object} [swapStorage] - A satora `SwapStorage` adapter persisting per-swap state for recovery/refund.
 * @property {(string | number)[]} [accountChains] - The chains the provided wallet account can fund/operate on (e.g. ['Arkade'] for an Arkade wallet, or [1, 137, 42161] for an EVM wallet). When set, `swidge` validates that the source chain is one of these.
 * @property {number} [feeRateSatPerVb] - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
 */
export default class SatoraProtocol extends SwidgeProtocol {
    /**
     * Creates a new satora swidge protocol without binding it to a wallet account.
     *
     * @overload
     * @param {undefined} [account] - The wallet account to use to interact with the protocol.
     * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
     */
    constructor(account?: undefined, config?: SatoraProtocolConfig);
    /**
     * Creates a new read-only satora swidge protocol.
     *
     * @overload
     * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
     * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
     */
    constructor(account: IWalletAccountReadOnly, config?: SatoraProtocolConfig);
    /**
     * Creates a new satora swidge protocol.
     *
     * @overload
     * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
     * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
     */
    constructor(account: IWalletAccount, config?: SatoraProtocolConfig);
    /**
     * The lazily-constructed satora swap client.
     *
     * @private
     * @type {Promise<SatoraClient> | undefined}
     */
    private _clientPromise;
    /**
     * Lazily constructs (and memoizes) the underlying satora swap client.
     * Read-only operations build a stateless client; a mnemonic is only
     * required for fund-moving operations.
     *
     * @protected
     * @returns {Promise<SatoraClient>} The satora swap client.
     */
    protected _getClient(): Promise<SatoraClient>;
    /**
     * Executes an Arkade -> EVM swap: create, fund the Arkade VHTLC from the
     * account, then complete. See {@link swidge}.
     *
     * @private
     */
    private _swidgeArkadeToEvm;
    /**
     * Executes a Bitcoin (on-chain) -> EVM swap: create, fund the on-chain BTC
     * HTLC from the account, then complete (gasless EVM claim). Like Arkade -> EVM
     * but the source funding confirms on-chain, so it uses a longer timeout. See
     * {@link swidge}.
     *
     * @private
     */
    private _swidgeBitcoinToEvm;
    /**
     * Executes a Lightning -> EVM swap: create, pay the returned BOLT11 invoice
     * from the account, then complete. The invoice is a hold invoice that only
     * settles once the swap reveals the preimage (during claim), so the payment
     * runs concurrently with completion. See {@link swidge}.
     *
     * @private
     */
    private _swidgeLightningToEvm;
    /**
     * Executes an EVM -> Arkade swap: create, fund the EVM HTLC from the account
     * (an {@link EvmSigner}) via `client.fundSwap`, then complete. See
     * {@link swidge}.
     *
     * @private
     */
    private _swidgeEvmToArkade;
    /**
     * Executes an EVM -> Bitcoin (on-chain) swap: create against the recipient's
     * BTC address, fund the EVM HTLC via `client.fundSwap`, then complete. The
     * client claims the BTC HTLC to the recipient (`destinationAddress`), paying
     * the on-chain claim fee at `config.feeRateSatPerVb`. See {@link swidge}.
     *
     * @private
     */
    private _swidgeEvmToBitcoin;
    /**
     * Executes an EVM -> Lightning swap: create against the recipient's Lightning
     * invoice (or address), fund the EVM HTLC from the account (an
     * {@link EvmSigner}), then wait for settlement. The server pays the lightning invoice
     * and claims the EVM HTLC, so there is no client claim. See {@link swidge}.
     *
     * @private
     */
    private _swidgeEvmToLightning;
    /**
     * Polls a swap's status until it reaches one of `targets`, throwing if it
     * reaches a failure state or the timeout elapses.
     *
     * @private
     * @param {SatoraClient} client - The satora swap client.
     * @param {string} id - The swap id.
     * @param {string[]} targets - Status values that resolve the wait.
     * @param {string[]} failStates - Status values that reject the wait.
     * @param {{ timeoutMs?: number, intervalMs?: number }} [opts] - Timing options.
     * @returns {Promise<Object>} The swap once it reaches a target status.
     */
    private _waitForSwapStatus;
    /**
     * Drives an already-funded swap to settlement: waits for the destination to
     * be locked, claims (gaslessly), and waits for the atomic swap to settle.
     * Shared by {@link swidge} and {@link resumeSwidge}.
     *
     * @private
     * @param {SatoraClient} client - The satora swap client.
     * @param {string} id - The swap id.
     * @param {{ timeoutMs?: number, intervalMs?: number }} [waitOpts] - Polling overrides.
     * @param {import('@satora/swap').ClaimOptions} [claimOptions] - Claim options (e.g. a Bitcoin `destinationAddress` + `feeRateSatPerVb` for EVM -> Bitcoin).
     * @returns {Promise<{ swap: Object, claim: Object }>} The settled swap and the claim result.
     * @throws {Error} If the claim fails or the swap reaches a failure state.
     */
    private _completeSwap;
    /**
     * Resumes a persisted swap, driving it to completion: waits for the
     * destination to be locked, claims (gaslessly, to the swap's stored
     * recipient), and settles. Throws if the swap cannot complete (e.g. it
     * expired or was refunded).
     *
     * This is a recovery operation for a swap interrupted after {@link swidge}
     * created and funded it (e.g. the process died mid-flight). It is driven by
     * the swap client's persisted secret (mnemonic + storage); no account is
     * needed, since the claim goes to the recipient recorded on the swap.
     *
     * @param {string} id - The swap id.
     * @param {{ timeoutMs?: number, intervalMs?: number }} [options] - Polling overrides.
     * @returns {Promise<SwidgeStatusResult & { id: string }>} The 'completed' status and transactions.
     * @throws {Error} If the swap cannot be completed.
     */
    resumeSwidge(id: string, options?: {
        timeoutMs?: number;
        intervalMs?: number;
    }): Promise<SwidgeStatusResult & {
        id: string;
    }>;
    /**
     * Refunds a swap that can no longer complete, reclaiming the source funds.
     * Use this when {@link resumeSwidge} throws. The mechanism depends on the swap
     * direction:
     * - **EVM source** (EVM -> Arkade/Bitcoin/Lightning): reclaims the EVM HTLC
     *   with the account's {@link EvmSigner}. Collaborative (gasless, no timelock
     *   wait) by default; pass `options.manual` for the timelock-based refund.
     *   `options.settlement` is 'swap-back' (return the original token, default)
     *   or 'direct' (WBTC).
     * - **Arkade/Bitcoin source**: reclaims to the account's address via the
     *   satora refund (`options` are forwarded, e.g. an on-chain `feeRateSatPerVb`).
     * - **Lightning source**: cannot be refunded — the unpaid invoice expires.
     *
     * @param {string} id - The swap id.
     * @param {Object} [options] - Refund options (`settlement`/`manual` for EVM sources; SDK refund options otherwise).
     * @returns {Promise<SwidgeStatusResult & { id: string, message?: string }>} The 'refunded' status and transactions.
     * @throws {import('./errors.js').SatoraInvalidOptionsError} If no (suitable) account is bound, or the direction cannot be refunded.
     * @throws {Error} If the swap cannot be refunded.
     */
    refundSwidge(id: string, options?: any): Promise<SwidgeStatusResult & {
        id: string;
        message?: string;
    }>;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type SwidgeOptions = import("@tetherto/wdk-wallet/protocols").SwidgeOptions;
export type SwidgeQuote = import("@tetherto/wdk-wallet/protocols").SwidgeQuote;
export type SwidgeResult = import("@tetherto/wdk-wallet/protocols").SwidgeResult;
export type SwidgeProtocolConfig = import("@tetherto/wdk-wallet/protocols").SwidgeProtocolConfig;
export type SwidgeStatusOptions = import("@tetherto/wdk-wallet/protocols").SwidgeStatusOptions;
export type SwidgeStatusResult = import("@tetherto/wdk-wallet/protocols").SwidgeStatusResult;
export type SwidgeSupportedChain = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedChain;
export type SwidgeSupportedToken = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedToken;
export type SwidgeSupportedTokensOptions = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedTokensOptions;
export type SatoraClient = import("@satora/swap").Client;
export type EvmSigner = import("@satora/swap").EvmSigner;
export type SatoraProtocolConfig = {
    /**
     * - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
     */
    defaultSlippage?: number;
    /**
     * - Override the satora API base URL. Defaults to the SDK's production endpoint.
     */
    baseUrl?: string;
    /**
     * - BIP39 mnemonic for the swap client's secret material (HTLC preimage + gasless-claim key). Separate from the funding account. Not required for read-only operations (chains, tokens, quotes).
     */
    mnemonic?: string;
    /**
     * - Override the Arkade server URL.
     */
    arkadeServerUrl?: string;
    /**
     * - Override the Esplora (Bitcoin) API URL.
     */
    esploraUrl?: string;
    /**
     * - A satora `WalletStorage` adapter persisting the seed / key index (the swap client's database). Recommended for fund-moving operations so an interrupted swap survives a restart. Omit for in-memory (not recoverable across restarts).
     */
    signerStorage?: any;
    /**
     * - A satora `SwapStorage` adapter persisting per-swap state for recovery/refund.
     */
    swapStorage?: any;
    /**
     * - The chains the provided wallet account can fund/operate on (e.g. ['Arkade'] for an Arkade wallet, or [1, 137, 42161] for an EVM wallet). When set, `swidge` validates that the source chain is one of these.
     */
    accountChains?: (string | number)[];
    /**
     * - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
     */
    feeRateSatPerVb?: number;
};
export type SwidgeFee = import("@tetherto/wdk-wallet/protocols").SwidgeFee;
import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
