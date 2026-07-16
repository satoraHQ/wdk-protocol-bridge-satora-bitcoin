/**
 * Builds a chain-qualified WDK token identifier.
 *
 * @param {string | number} chain - The satora chain identifier.
 * @param {string} tokenId - The satora token id ('btc' or a contract address).
 * @returns {string} The `chain:tokenId` identifier.
 */
export function composeTokenId(chain: string | number, tokenId: string): string;
/**
 * Splits a chain-qualified WDK token identifier into its parts. If the
 * identifier is not chain-qualified, `chain` is undefined.
 *
 * @param {string} token - The token identifier (`chain:tokenId` or `tokenId`).
 * @returns {{ chain: string | undefined, tokenId: string }} The parts.
 */
export function parseTokenId(token: string): {
    chain: string | undefined;
    tokenId: string;
};
/**
 * Maps a satora `TokenInfo` to a WDK {@link SwidgeSupportedToken}. The `token`
 * identifier is chain-qualified (`chain:tokenId`) so it can be passed straight
 * back as `fromToken`/`toToken`. For EVM tokens the contract address is also
 * surfaced as `address`.
 *
 * @param {Object} info - The satora token info.
 * @param {string} info.token_id - The provider-specific token identifier.
 * @param {string | number} info.chain - The satora chain identifier.
 * @param {string} info.symbol - The token symbol.
 * @param {number} info.decimals - The token's base-unit decimals.
 * @param {string} info.name - The token's full name.
 * @returns {SwidgeSupportedToken} The WDK supported-token descriptor.
 */
export function toSupportedToken(info: {
    token_id: string;
    chain: string | number;
    symbol: string;
    decimals: number;
    name: string;
}): SwidgeSupportedToken;
export type SwidgeSupportedToken = import("@tetherto/wdk-wallet/protocols").SwidgeSupportedToken;
