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
     * The satora protocol configuration.
     *
     * @protected
     * @type {SatoraProtocolConfig}
     */
    protected _config: SatoraProtocolConfig;
    /**
     * Bridges a token to a different blockchain.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @returns {Promise<BridgeResult>} The bridge's result.
     */
    bridge(options: BridgeOptions): Promise<BridgeResult>;
    /**
     * Quotes the costs of a bridge operation.
     *
     * @param {BridgeOptions} options - The bridge's options.
     * @returns {Promise<Omit<BridgeResult, 'hash'>>} The bridge's quote.
     */
    quoteBridge(options: BridgeOptions): Promise<Omit<BridgeResult, 'hash'>>;
}
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type IWalletAccountReadOnly = import("@tetherto/wdk-wallet").IWalletAccountReadOnly;
export type BridgeOptions = import("@tetherto/wdk-wallet/protocols").BridgeOptions;
export type BridgeResult = import("@tetherto/wdk-wallet/protocols").BridgeResult;
export type SatoraProtocolConfig = {
    /**
     * - The maximum fee amount for bridge operations.
     */
    bridgeMaxFee?: number | bigint;
};
import { BridgeProtocol } from '@tetherto/wdk-wallet/protocols';
