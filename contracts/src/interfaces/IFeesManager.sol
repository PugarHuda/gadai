// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Doppler/Whetstone FeesManager subset (verified source of 0xD59cE43E53D69F190E15d9822Fb4540dCcc91178 on Base).
/// collectFees returns POOL totals collected, not the caller's share; the caller's share is transferred to it.
interface IFeesManager {
    function collectFees(bytes32 poolId) external returns (uint128 fees0, uint128 fees1);
    function updateBeneficiary(bytes32 poolId, address newBeneficiary) external;
    function getShares(bytes32 poolId, address beneficiary) external view returns (uint256);
    function getPoolKey(bytes32 poolId)
        external
        view
        returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks);
}
