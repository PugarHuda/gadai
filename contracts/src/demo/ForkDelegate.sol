// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// DEMO_FORK ONLY. The real test-pool beneficiary is an EIP-7702 account whose key we don't hold, so on an Anvil fork
/// scripts/fork-borrower.mjs re-points its 7702 delegation here: ERC-1271 then accepts personal_sign signatures from
/// `signer` (a demo key) on the beneficiary's behalf — same trust shape as any 7702 smart account, never deployed to Base.
contract ForkDelegate {
    address public immutable signer;

    constructor(address s) {
        signer = s;
    }

    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        if (sig.length != 65) return 0xffffffff;
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        return ecrecover(hash, v, r, s) == signer ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    receive() external payable {}
}
