// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {FeeDesk} from "../src/FeeDesk.sol";

/// Deploys the FeeDesk singleton. keeper = the Dynamic agent wallet. treasury (dining-draw repayments) defaults to
/// the DEPLOYER address and must differ from the keeper, so a leaked keeper key cannot book draws payable to itself.
/// ORACLE_MAX_AGE_SEC is the Chainlink staleness bound every vault enforces: 3600 (default) on mainnet, 86400 on the
/// DEMO_FORK, whose feed is frozen at the fork block.
///   env: DEPLOYER_PRIVATE_KEY, AGENT_WALLET_ADDRESS, DESK_TREASURY (optional), ORACLE_MAX_AGE_SEC (optional)
///   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast                              (mainnet)
///   ORACLE_MAX_AGE_SEC=86400 forge script script/Deploy.s.sol --rpc-url $FORK_RPC_URL --broadcast     (DEMO_FORK)
contract Deploy is Script {
    function run() external returns (FeeDesk desk) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_WALLET_ADDRESS");
        string memory t = vm.envOr("DESK_TREASURY", string(""));
        address treasury = bytes(t).length == 0 ? vm.addr(pk) : vm.parseAddress(t);
        uint256 maxOracleAge = vm.envOr("ORACLE_MAX_AGE_SEC", uint256(3600));
        require(treasury != agent, "DESK_TREASURY must not be AGENT_WALLET_ADDRESS (keeper)");
        vm.startBroadcast(pk);
        desk = new FeeDesk(agent, treasury, maxOracleAge);
        vm.stopBroadcast();
        console.log("FEE_DESK_ADDRESS=%s", address(desk));
        console.log("keeper=%s treasury=%s chainId=%s", agent, treasury, block.chainid);
        console.log("maxOracleAge=%s", maxOracleAge);
    }
}
