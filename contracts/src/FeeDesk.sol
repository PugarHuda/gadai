// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FeeVault, CreateLoanParams} from "./FeeVault.sol";
import {IFeesManager} from "./interfaces/IFeesManager.sol";

/// @title FeeDesk
/// @notice Registry + factory. The keeper (the desk's Dynamic agent wallet) opens one FeeVault per approved loan.
contract FeeDesk {
    address public owner;
    address public keeper;
    address public treasury;
    uint256 public loanCount;
    mapping(uint256 => address) public vaultOf; // loanId (from 1) => vault
    mapping(bytes32 => address) public activeVaultByPool; // one open loan per pool
    mapping(address => bool) public isVault;

    event LoanCreated(
        uint256 indexed loanId,
        address indexed vault,
        address indexed borrower,
        address note,
        bytes32 poolId,
        address feesManager,
        address creatorToken,
        uint256 principal,
        uint256 faceValue,
        uint256 drawLimit
    );
    event KeeperSet(address keeper);
    event TreasurySet(address treasury);
    event OwnerSet(address owner);

    error Unauthorized();
    error BadParams();
    error PoolHasOpenLoan(address vault);
    error BorrowerHasNoShares();

    constructor(address keeper_, address treasury_) {
        if (keeper_ == address(0) || treasury_ == address(0)) revert BadParams();
        owner = msg.sender;
        keeper = keeper_;
        treasury = treasury_;
        emit OwnerSet(msg.sender);
        emit KeeperSet(keeper_);
        emit TreasurySet(treasury_);
    }

    function createLoan(CreateLoanParams calldata p) external returns (uint256 loanId, address vault, address note) {
        if (msg.sender != keeper) revert Unauthorized();
        if (
            p.borrower == address(0) || p.feesManager == address(0) || p.creatorToken == address(0) || p.principal == 0
                || p.faceValue < p.principal || p.faceValue > type(uint128).max || p.drawLimit > p.principal
        ) revert BadParams();
        if (activeVaultByPool[p.poolId] != address(0)) revert PoolHasOpenLoan(activeVaultByPool[p.poolId]);
        // The borrower must currently own fee shares, otherwise there is nothing to pledge.
        if (IFeesManager(p.feesManager).getShares(p.poolId, p.borrower) == 0) revert BorrowerHasNoShares();

        loanId = ++loanCount;
        FeeVault v = new FeeVault(loanId, p);
        vault = address(v);
        note = address(v.note());
        vaultOf[loanId] = vault;
        activeVaultByPool[p.poolId] = vault;
        isVault[vault] = true;
        emit LoanCreated(
            loanId, vault, p.borrower, note, p.poolId, p.feesManager, p.creatorToken, p.principal, p.faceValue, p.drawLimit
        );
    }

    /// @notice Called by a vault when it is Released or Cancelled; frees the pool for a new loan.
    function onVaultClosed(bytes32 poolId) external {
        if (!isVault[msg.sender]) revert Unauthorized();
        if (activeVaultByPool[poolId] == msg.sender) delete activeVaultByPool[poolId];
    }

    function setKeeper(address k) external {
        if (msg.sender != owner) revert Unauthorized();
        if (k == address(0)) revert BadParams();
        keeper = k;
        emit KeeperSet(k);
    }

    function setTreasury(address t) external {
        if (msg.sender != owner) revert Unauthorized();
        if (t == address(0)) revert BadParams();
        treasury = t;
        emit TreasurySet(t);
    }

    function setOwner(address o) external {
        if (msg.sender != owner) revert Unauthorized();
        if (o == address(0)) revert BadParams();
        owner = o;
        emit OwnerSet(o);
    }
}
