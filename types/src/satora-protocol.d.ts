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
/** @typedef {import('@satora/swap').WalletStorage} WalletStorage */
/** @typedef {import('@satora/swap').SwapStorage} SwapStorage */
/** @typedef {import('@satora/swap').GetSwapResponse} GetSwapResponse */
/** @typedef {import('@satora/swap').RefundOptions} RefundOptions */
/** @typedef {import('@satora/swap').ClaimOptions} ClaimOptions */
/** @typedef {import('@satora/swap').QuoteResponse} QuoteResponse */
/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number} [defaultSlippage] - The default slippage tolerance as a decimal (e.g., 0.01 for 1%).
 * @property {string} [baseUrl] - Override the satora API base URL. Defaults to the SDK's production endpoint.
 * @property {string} [mnemonic] - BIP39 mnemonic for the swap client's secret material (HTLC preimage + gasless-claim key). Separate from the funding account. Not required for read-only operations (chains, tokens, quotes).
 * @property {string} [arkadeServerUrl] - Override the Arkade server URL.
 * @property {string} [esploraUrl] - Override the Esplora (Bitcoin) API URL.
 * @property {WalletStorage} [signerStorage] - Persists the seed / key index (the swap client's database). Recommended for fund-moving operations so an interrupted swap survives a restart. Omit for in-memory (not recoverable across restarts).
 * @property {SwapStorage} [swapStorage] - Persists per-swap state (the preimage, keys, last response) for recovery/refund.
 * @property {(string | number)[]} [accountChains] - The chains the provided wallet account can fund/operate on (e.g. ['Arkade'] for an Arkade wallet, or [1, 137, 42161] for an EVM wallet). When set, `swidge` validates that the source chain is one of these.
 * @property {number} [feeRateSatPerVb] - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
 */
/**
 * @typedef {Object} SatoraRefundOptions
 * @property {'swap-back' | 'direct'} [settlement] - For an EVM-sourced swap: refund as the original token via DEX ('swap-back', the default) or as WBTC ('direct').
 * @property {boolean} [manual] - For an EVM-sourced swap: use the timelock-based refund (user pays gas) instead of the gasless collaborative one. Ignored for Arkade/Bitcoin sources, whose other fields are forwarded as {@link RefundOptions}.
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
    /** @private */
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
    /** @private */
    private _swidgeArkadeToEvm;
    /** @private */
    private _swidgeBitcoinToEvm;
    /** @private */
    private _swidgeLightningToEvm;
    /** @private */
    private _swidgeEvmToArkade;
    /** @private */
    private _swidgeEvmToBitcoin;
    /** @private */
    private _swidgeEvmToLightning;
    /** @private */
    private _waitForSwapStatus;
    /** @private */
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
     * @param {SatoraRefundOptions} [options] - Refund options (`settlement`/`manual` for EVM sources; SDK {@link RefundOptions} fields are forwarded for Arkade/Bitcoin sources).
     * @returns {Promise<SwidgeStatusResult & { id: string, message?: string }>} The 'refunded' status and transactions.
     * @throws {import('./errors.js').SatoraInvalidOptionsError} If no (suitable) account is bound, or the direction cannot be refunded.
     * @throws {Error} If the swap cannot be refunded.
     */
    refundSwidge(id: string, options?: SatoraRefundOptions): Promise<SwidgeStatusResult & {
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
export type WalletStorage = import("@satora/swap").WalletStorage;
export type SwapStorage = import("@satora/swap").SwapStorage;
export type GetSwapResponse = import("@satora/swap").GetSwapResponse;
export type RefundOptions = import("@satora/swap").RefundOptions;
export type ClaimOptions = import("@satora/swap").ClaimOptions;
export type QuoteResponse = import("@satora/swap").QuoteResponse;
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
     * - Persists the seed / key index (the swap client's database). Recommended for fund-moving operations so an interrupted swap survives a restart. Omit for in-memory (not recoverable across restarts).
     */
    signerStorage?: WalletStorage;
    /**
     * - Persists per-swap state (the preimage, keys, last response) for recovery/refund.
     */
    swapStorage?: SwapStorage;
    /**
     * - The chains the provided wallet account can fund/operate on (e.g. ['Arkade'] for an Arkade wallet, or [1, 137, 42161] for an EVM wallet). When set, `swidge` validates that the source chain is one of these.
     */
    accountChains?: (string | number)[];
    /**
     * - Fee rate (sat/vB) for the on-chain Bitcoin claim of an EVM -> Bitcoin swap. Defaults to the SDK's default.
     */
    feeRateSatPerVb?: number;
};
export type SatoraRefundOptions = {
    /**
     * - For an EVM-sourced swap: refund as the original token via DEX ('swap-back', the default) or as WBTC ('direct').
     */
    settlement?: "swap-back" | "direct";
    /**
     * - For an EVM-sourced swap: use the timelock-based refund (user pays gas) instead of the gasless collaborative one. Ignored for Arkade/Bitcoin sources, whose other fields are forwarded as {@link RefundOptions}.
     */
    manual?: boolean;
};
export type SwidgeFee = import("@tetherto/wdk-wallet/protocols").SwidgeFee;
import { SwidgeProtocol } from '@tetherto/wdk-wallet/protocols';
