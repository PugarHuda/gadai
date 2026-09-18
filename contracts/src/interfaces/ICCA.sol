// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Minimal vendored interfaces of Uniswap continuous-clearing-auction v2.1.0
/// (src/interfaces/IContinuousClearingAuction.sol, ContinuousClearingAuctionFactory.sol at tag v2.1.0).
struct AuctionParameters {
    address currency;
    address tokensRecipient;
    address fundsRecipient;
    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock;
    uint256 tickSpacing;
    address validationHook;
    uint256 floorPrice;
    uint128 requiredCurrencyRaised;
    bytes auctionStepsData; // abi.encodePacked(uint24 mps, uint40 blockDelta)[]
}

interface ICCAFactory {
    function create(address token, uint256 amount, bytes calldata configData, bytes32 salt) external returns (address);
    function getAddress(address token, uint256 amount, bytes calldata configData, bytes32 salt, address sender)
        external
        view
        returns (address);
}

interface ICCA {
    function onTokensReceived() external;
    function submitBid(uint256 maxPrice, uint128 amount, address owner, uint256 prevTickPrice, bytes calldata hookData)
        external
        payable
        returns (uint256 bidId);
    function exitBid(uint256 bidId) external;
    function claimTokens(uint256 bidId) external;
    function checkpoint() external;
    function sweepCurrency() external;
    function sweepUnsoldTokens() external;
    function isGraduated() external view returns (bool);
    function clearingPrice() external view returns (uint256);
    function currencyRaised() external view returns (uint256);
    function floorPrice() external view returns (uint256);
    function endBlock() external view returns (uint64);
    function claimBlock() external view returns (uint64);
}
