/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').IWalletAccountReadOnly} IWalletAccountReadOnly */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeOptions} BridgeOptions */
/** @typedef {import('@tetherto/wdk-wallet/protocols').BridgeResult} BridgeResult */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').Chain} Chain */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').Asset} LendaswapAsset */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').WalletStorage} WalletStorage */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').SwapStorage} SwapStorage */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').GetSwapResponse} GetSwapResponse */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').ClaimResult} ClaimResult */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').RefundResult} RefundResult */
/** @typedef {import('@lendasat/lendaswap-sdk-pure').StoredSwap} StoredSwap */
/**
 * @typedef {Object} SatoraProtocolConfig
 * @property {number | bigint} [bridgeMaxFee] - The maximum fee amount for bridge operations.
 * @property {string} [apiKey] - Lendaswap API key.
 * @property {string} [mnemonic] - BIP39 mnemonic for lendaswap key derivation. If omitted, a new one is generated.
 * @property {string} [baseUrl] - Lendaswap API base URL. Defaults to 'https://api.lendaswap.com/'.
 * @property {string} [esploraUrl] - Bitcoin esplora API URL. Defaults to 'https://mempool.space/api'.
 * @property {WalletStorage} [walletStorage] - Wallet storage backend. Defaults to InMemoryWalletStorage.
 * @property {SwapStorage} [swapStorage] - Swap storage backend. Defaults to InMemorySwapStorage.
 * @property {string} [referralCode] - Optional referral code for fee exemption.
 */
/**
 * Extended bridge options that allow specifying the source chain and token.
 *
 * @typedef {BridgeOptions & SatoraBridgeExtra} SatoraBridgeOptions
 */
/**
 * @typedef {Object} SatoraBridgeExtra
 * @property {string} sourceChain - The source blockchain (e.g. "bitcoin", "lightning", "arkade").
 * @property {string} [sourceToken] - The source token identifier. Defaults to "btc".
 */
/**
 * @typedef {Object} SatoraBridgeResult
 * @property {string} hash - The swap ID.
 * @property {bigint} fee - Network fee in satoshis.
 * @property {bigint} bridgeFee - Protocol fee in satoshis.
 * @property {string} [depositAddress] - Bitcoin HTLC address to send BTC to (BTC on-chain → EVM swaps).
 * @property {string} [lightningInvoice] - Lightning invoice to pay (Lightning → * swaps).
 * @property {string} [evmHtlcAddress] - EVM HTLC contract address (EVM → * swaps). Fund via {@link fundSwapGasless}.
 * @property {bigint} depositAmount - Exact amount in source token's smallest unit to deposit.
 * @property {string} targetAmount - Amount of target token the user will receive (in smallest unit).
 */
/**
 * @typedef {Object} ClaimOptions
 * @property {string} [destinationAddress] - BTC refund address (for error recovery).
 * @property {number} [feeRateSatPerVb] - Fee rate for on-chain claim. Defaults to 2.
 */
/**
 * @typedef {Object} RefundOptions
 * @property {string} destinationAddress - BTC address to receive refunded funds.
 * @property {number} [feeRateSatPerVb] - Fee rate for on-chain refund. Defaults to 2.
 */
export default class SatoraProtocolBitcoin extends BridgeProtocol {
    /**
     * Creates a new read-only interface to the satora protocol for the bitcoin blockchain.
     *
     * @overload
     * @param {IWalletAccountReadOnly} account - The wallet account to use to interact with the protocol.
     * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
     */
    constructor(account: IWalletAccountReadOnly, config?: SatoraProtocolConfig);
    /**
     * Creates a new interface to the satora protocol for the bitcoin blockchain.
     *
     * @overload
     * @param {IWalletAccount} account - The wallet account to use to interact with the protocol.
     * @param {SatoraProtocolConfig} [config] - The satora protocol configuration.
     */
    constructor(account: IWalletAccount, config?: SatoraProtocolConfig);
    /**
     * Lazily initialized lendaswap client.
     *
     * @private
     * @type {import('@lendasat/lendaswap-sdk-pure').Client | null}
     */
    private _client;
    /**
     * Promise that resolves when the client is ready.
     *
     * @private
     * @type {Promise<import('@lendasat/lendaswap-sdk-pure').Client> | null}
     */
    private _clientPromise;
    /**
     * Returns the initialized lendaswap Client, creating it on first call.
     *
     * @private
     * @returns {Promise<import('@lendasat/lendaswap-sdk-pure').Client>}
     */
    private _getClient;
    /**
     * Builds the lendaswap Client from config.
     *
     * @private
     * @returns {Promise<import('@lendasat/lendaswap-sdk-pure').Client>}
     */
    private _buildClient;
    /**
     * Resolves the source Asset from bridge options.
     *
     * Supports "bitcoin" (on-chain), "lightning", and "arkade". Defaults to Bitcoin on-chain.
     *
     * @private
     * @param {SatoraBridgeOptions} options
     * @returns {LendaswapAsset}
     */
    private _resolveSourceAsset;
    /**
     * Resolves the target Asset from bridge options.
     *
     * Supports EVM chains (arbitrum, ethereum, polygon, etc.), "lightning", and "arkade".
     * Defaults to USDT on Arbitrum.
     *
     * @private
     * @param {SatoraBridgeOptions} options
     * @returns {LendaswapAsset}
     */
    private _resolveTargetAsset;
    /**
     * Quotes the costs of a bridge operation.
     *
     * @param {SatoraBridgeOptions} options - The bridge's options.
     * @returns {Promise<Omit<BridgeResult, 'hash'> & { exchangeRate: string, sourceAmount: string, targetAmount: string, minAmount: number, maxAmount: number }>} The bridge's quote.
     */
    quoteBridge(options: SatoraBridgeOptions): Promise<Omit<BridgeResult, "hash"> & {
        exchangeRate: string;
        sourceAmount: string;
        targetAmount: string;
        minAmount: number;
        maxAmount: number;
    }>;
    /**
     * Creates a bridge swap.
     *
     * Supports multiple directions:
     * - Bitcoin on-chain → EVM token
     * - Lightning → EVM token / Arkade
     * - EVM token → Bitcoin on-chain / Lightning / Arkade
     *
     * For BTC on-chain sources, returns a `depositAddress` (Bitcoin HTLC).
     * For Lightning sources, returns a `lightningInvoice` to pay.
     * For EVM sources, returns an `evmHtlcAddress`. Use {@link fundSwapGasless} to fund.
     *
     * After funding, use {@link claim} to complete the swap.
     *
     * @param {SatoraBridgeOptions} options - The bridge's options.
     * @returns {Promise<SatoraBridgeResult>} The bridge result with deposit instructions.
     */
    bridge(options: SatoraBridgeOptions): Promise<SatoraBridgeResult>;
    /**
     * Funds an EVM-sourced swap via gasless relay (Permit2).
     *
     * Call this after {@link bridge} when the source is an EVM chain.
     * The SDK signs the Permit2 authorization off-chain and submits
     * it to the server, which funds the HTLC on behalf of the user.
     *
     * @param {string} swapId - The swap ID returned by {@link bridge}.
     * @returns {Promise<{ txHash: string }>} The relay transaction hash.
     */
    fundSwapGasless(swapId: string): Promise<{
        txHash: string;
    }>;
    /**
     * Returns true if the source chain in the given options is an EVM chain.
     *
     * @param {SatoraBridgeOptions} options
     * @returns {boolean}
     */
    isEvmSource(options: SatoraBridgeOptions): boolean;
    /**
     * Gets the current status of a swap.
     *
     * @param {string} swapId - The swap ID returned by {@link bridge}.
     * @returns {Promise<GetSwapResponse>} The swap status from the server.
     */
    getSwap(swapId: string): Promise<GetSwapResponse>;
    /**
     * Claims the HTLC after the server has funded the EVM side.
     *
     * Call this after the swap status transitions to 'serverfunded'.
     * For gasless swaps, this triggers a Gelato relay claim.
     *
     * @param {string} swapId - The swap ID returned by {@link bridge}.
     * @param {ClaimOptions} [options] - Claim options.
     * @returns {Promise<ClaimResult>} The claim result.
     */
    claim(swapId: string, options?: ClaimOptions): Promise<ClaimResult>;
    /**
     * Refunds a swap that has not been completed.
     *
     * Use collaborative refund when the swap is still active (before timelock expiry).
     * Falls back to on-chain refund after the timelock expires.
     *
     * @param {string} swapId - The swap ID returned by {@link bridge}.
     * @param {RefundOptions} [options] - Refund options.
     * @returns {Promise<RefundResult>} The refund result.
     */
    refund(swapId: string, options?: RefundOptions): Promise<RefundResult>;
    /**
     * Lists all tracked swaps from local storage.
     *
     * @returns {Promise<StoredSwap[]>} All stored swaps.
     */
    listSwaps(): Promise<StoredSwap[]>;
    /**
     * Recovers swaps from the server using the wallet's xpub.
     *
     * Useful when switching devices or after clearing local storage.
     *
     * @returns {Promise<StoredSwap[]>} Recovered swaps.
     */
    recoverSwaps(): Promise<StoredSwap[]>;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type BridgeOptions = import("@tetherto/wdk-wallet/protocols").BridgeOptions;
export type BridgeResult = import("@tetherto/wdk-wallet/protocols").BridgeResult;
export type Chain = import("@lendasat/lendaswap-sdk-pure").Chain;
export type LendaswapAsset = import("@lendasat/lendaswap-sdk-pure").Asset;
export type WalletStorage = import("@lendasat/lendaswap-sdk-pure").WalletStorage;
export type SwapStorage = import("@lendasat/lendaswap-sdk-pure").SwapStorage;
export type GetSwapResponse = import("@lendasat/lendaswap-sdk-pure").GetSwapResponse;
export type ClaimResult = import("@lendasat/lendaswap-sdk-pure").ClaimResult;
export type RefundResult = import("@lendasat/lendaswap-sdk-pure").RefundResult;
export type StoredSwap = import("@lendasat/lendaswap-sdk-pure").StoredSwap;
export type SatoraProtocolConfig = {
    /**
     * - The maximum fee amount for bridge operations.
     */
    bridgeMaxFee?: number | bigint;
    /**
     * - Lendaswap API key.
     */
    apiKey?: string;
    /**
     * - BIP39 mnemonic for lendaswap key derivation. If omitted, a new one is generated.
     */
    mnemonic?: string;
    /**
     * - Lendaswap API base URL. Defaults to 'https://api.lendaswap.com/'.
     */
    baseUrl?: string;
    /**
     * - Bitcoin esplora API URL. Defaults to 'https://mempool.space/api'.
     */
    esploraUrl?: string;
    /**
     * - Wallet storage backend. Defaults to InMemoryWalletStorage.
     */
    walletStorage?: WalletStorage;
    /**
     * - Swap storage backend. Defaults to InMemorySwapStorage.
     */
    swapStorage?: SwapStorage;
    /**
     * - Optional referral code for fee exemption.
     */
    referralCode?: string;
};
/**
 * Extended bridge options that allow specifying the source chain and token.
 */
export type SatoraBridgeOptions = BridgeOptions & SatoraBridgeExtra;
export type SatoraBridgeExtra = {
    /**
     * - The source blockchain (e.g. "bitcoin", "lightning", "arkade").
     */
    sourceChain: string;
    /**
     * - The source token identifier. Defaults to "btc".
     */
    sourceToken?: string;
};
export type SatoraBridgeResult = {
    /**
     * - The swap ID.
     */
    hash: string;
    /**
     * - Network fee in satoshis.
     */
    fee: bigint;
    /**
     * - Protocol fee in satoshis.
     */
    bridgeFee: bigint;
    /**
     * - Bitcoin HTLC address to send BTC to (BTC on-chain → EVM swaps).
     */
    depositAddress?: string;
    /**
     * - Lightning invoice to pay (Lightning → * swaps).
     */
    lightningInvoice?: string;
    /**
     * - EVM HTLC contract address (EVM → * swaps). Fund via {@link fundSwapGasless}.
     */
    evmHtlcAddress?: string;
    /**
     * - Exact amount in source token's smallest unit to deposit.
     */
    depositAmount: bigint;
    /**
     * - Amount of target token the user will receive (in smallest unit).
     */
    targetAmount: string;
};
export type ClaimOptions = {
    /**
     * - BTC refund address (for error recovery).
     */
    destinationAddress?: string;
    /**
     * - Fee rate for on-chain claim. Defaults to 2.
     */
    feeRateSatPerVb?: number;
};
export type RefundOptions = {
    /**
     * - BTC address to receive refunded funds.
     */
    destinationAddress: string;
    /**
     * - Fee rate for on-chain refund. Defaults to 2.
     */
    feeRateSatPerVb?: number;
};
import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols';
