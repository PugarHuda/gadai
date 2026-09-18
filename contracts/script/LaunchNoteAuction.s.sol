// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {FeeVault} from "../src/FeeVault.sol";

/// Manual FeeNote CCA launch for a Pledged vault (the agent's cca module does the same automatically).
/// Must be sent by the FeeDesk keeper. On the Anvil fork the keeper (Dynamic wallet) is impersonated:
///   cast rpc anvil_impersonateAccount $AGENT_WALLET_ADDRESS --rpc-url $FORK_RPC_URL
///   VAULT=0x... forge script script/LaunchNoteAuction.s.sol --rpc-url $FORK_RPC_URL --broadcast \
///       --unlocked --sender $AGENT_WALLET_ADDRESS
/// env: VAULT, AUCTION_BLOCKS (default 150), AUCTION_CLAIM_DELAY_BLOCKS (default 0)
/// Price grid: tick = Q96/100 (0.01 USDC per note). floor = ceil(principal/face) on that grid, so selling
/// every note at the floor raises >= principal. Every CCA bid price must be k * tick (price % tick == 0).
contract LaunchNoteAuction is Script {
    uint256 constant Q96 = 2 ** 96;

    function steps(uint64 n) public pure returns (bytes memory) {
        require(n >= 2, "AUCTION_BLOCKS < 2");
        uint24 a = uint24(6_000_000 / (n - 1));
        uint24 last = uint24(10_000_000 - uint256(a) * (n - 1));
        return abi.encodePacked(a, uint40(n - 1), last, uint40(1));
    }

    function run() external returns (address auction) {
        FeeVault v = FeeVault(vm.envAddress("VAULT"));
        uint64 n = uint64(vm.envOr("AUCTION_BLOCKS", uint256(150)));
        uint64 delay = uint64(vm.envOr("AUCTION_CLAIM_DELAY_BLOCKS", uint256(0)));
        uint256 tick = Q96 / 100;
        uint256 k = (v.principal() * 100 + v.faceValue() - 1) / v.faceValue(); // ceil(principal/face * 100)
        uint64 start = uint64(block.number + 5);
        uint64 end = start + n;
        vm.startBroadcast();
        auction = v.startAuction(start, end, end + delay, tick, k * tick, steps(n));
        vm.stopBroadcast();
        console.log("auction=%s", auction);
        console.log("startBlock=%s endBlock=%s floor(cents/note)=%s", start, end, k);
    }
}
