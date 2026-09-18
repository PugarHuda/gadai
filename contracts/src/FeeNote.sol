// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "solady/tokens/ERC20.sol";

/// @title FeeNote
/// @notice ERC-20 claim on one loan's repayment stream. 1 raw note = 1 raw USDC of face value (6 decimals).
///         Minted once to the loan's CCA; redeemed 1:1 for USDC at the FeeVault (FeeVault.redeem).
contract FeeNote is ERC20 {
    address public immutable vault;
    string private _name;
    string private _symbol;

    error OnlyVault();

    constructor(string memory name_, string memory symbol_) {
        vault = msg.sender;
        _name = name_;
        _symbol = symbol_;
    }

    function name() public view override returns (string memory) {
        return _name;
    }

    function symbol() public view override returns (string memory) {
        return _symbol;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @dev Plain ERC-20 allowances: no implicit infinite Permit2 approval for noteholders.
    function _givePermit2InfiniteAllowance() internal pure override returns (bool) {
        return false;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _burn(from, amount);
    }
}
