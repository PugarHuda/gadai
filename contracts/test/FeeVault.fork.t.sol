// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeDesk} from "../src/FeeDesk.sol";
import {FeeVault, CreateLoanParams, FlashOrder} from "../src/FeeVault.sol";
import {FeeNote} from "../src/FeeNote.sol";
import {IFeesManager} from "../src/interfaces/IFeesManager.sol";
import {ICCA} from "../src/interfaces/ICCA.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

interface IERC20Full is IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function allowance(address, address) external view returns (uint256);
}

/// Etched at the Uniswap SwapProxy address: pulls `wethIn` WETH from the caller, pays `usdcOut` of its own USDC to `to`.
contract MockSwapProxy {
    function swap(uint256 wethIn, address to, uint256 usdcOut) external {
        IERC20Full(0x4200000000000000000000000000000000000006).transferFrom(msg.sender, address(this), wethIn);
        IERC20Full(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).transfer(to, usdcOut);
    }
}

interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

/// Runs against a Base mainnet fork with the real GITLAWB Doppler pool (shared TEST_POOL):
///   forge test --fork-url $BASE_RPC_URL   (or just `forge test`, which forks BASE_RPC_URL / publicnode itself)
contract FeeVaultForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant FM = 0xD59cE43E53D69F190E15d9822Fb4540dCcc91178;
    address constant GITLAWB = 0x5F980Dcfc4c0fa3911554cf5ab288ed0eb13DBa3;
    bytes32 constant POOL = 0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9;
    address constant BORROWER = 0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf;
    uint256 constant Q96 = 2 ** 96;
    uint256 constant TICK = Q96 / 100; // 0.01 USDC per note

    uint256 constant PRINCIPAL = 100e6;
    uint256 constant FACE = 110e6;
    uint256 constant DRAW_LIMIT = 10e6;
    uint64 constant AUCTION_BLOCKS = 20;

    address keeper = makeAddr("feedesk.keeper");
    address treasury = makeAddr("feedesk.treasury");
    address lender = makeAddr("feedesk.lender");
    FeeDesk desk;
    IFeesManager fm = IFeesManager(FM);
    uint256 borrowerShares;

    function setUp() public {
        if (block.chainid != 8453) vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://base-rpc.publicnode.com")));
        // On the Base (OP-stack) fork a pranked caller with 0 ETH fails with an empty revert; fund every actor.
        vm.deal(keeper, 1 ether);
        vm.deal(lender, 1 ether);
        vm.deal(BORROWER, 1 ether);
        vm.deal(makeAddr("feedesk.anyone"), 1 ether);
        desk = new FeeDesk(keeper, treasury);
        borrowerShares = fm.getShares(POOL, BORROWER);
        assertGt(borrowerShares, 0, "test pool beneficiary lost its shares");
    }

    // ───────────── helpers ─────────────

    function _createLoan() internal returns (FeeVault v) {
        CreateLoanParams memory p = CreateLoanParams({
            borrower: BORROWER,
            poolId: POOL,
            feesManager: FM,
            creatorToken: GITLAWB,
            principal: PRINCIPAL,
            faceValue: FACE,
            drawLimit: DRAW_LIMIT,
            noteName: "FeeNote GITLAWB #1",
            noteSymbol: "fnGITLAWB1"
        });
        vm.prank(keeper);
        (, address vault,) = desk.createLoan(p);
        v = FeeVault(vault);
    }

    function _pledge(FeeVault v) internal {
        vm.prank(BORROWER);
        fm.updateBeneficiary(POOL, address(v));
        v.confirmPledge();
    }

    /// Same step math as agent/src/cca: N-1 blocks at floor(6e6/(N-1)) mps, last block takes the rest.
    function _steps(uint64 n) internal pure returns (bytes memory) {
        uint24 a = uint24(6_000_000 / (n - 1));
        uint24 last = uint24(10_000_000 - uint256(a) * (n - 1));
        return abi.encodePacked(a, uint40(n - 1), last, uint40(1));
    }

    function _startAuction(FeeVault v) internal returns (ICCA a) {
        uint64 start = uint64(block.number + 1);
        uint64 end = start + AUCTION_BLOCKS;
        // floor = ceil(principal/face) on the 0.01 grid (0.91 >= 100/110), so a full sale at floor graduates.
        vm.prank(keeper);
        a = ICCA(v.startAuction(start, end, end, TICK, 91 * TICK, _steps(AUCTION_BLOCKS)));
        vm.roll(start);
    }

    function _bid(ICCA a, address who, uint128 amount, uint256 maxPrice) internal returns (uint256 id) {
        deal(USDC, who, IERC20(USDC).balanceOf(who) + amount);
        vm.startPrank(who);
        IERC20(USDC).approve(PERMIT2, amount);
        IPermit2(PERMIT2).approve(USDC, address(a), uint160(amount), uint48(block.timestamp + 1 days));
        id = a.submitBid(maxPrice, amount, who, a.floorPrice(), "");
        vm.stopPrank();
    }

    function _fundedLoan() internal returns (FeeVault v, ICCA a, uint256 bidId) {
        v = _createLoan();
        _pledge(v);
        a = _startAuction(v);
        bidId = _bid(a, lender, uint128(PRINCIPAL + 5e6), 100 * TICK); // lender pays up to 1.00 / note
        vm.roll(block.number + AUCTION_BLOCKS);
        uint256 before = IERC20(USDC).balanceOf(BORROWER);
        vm.prank(keeper);
        uint256 amt = v.disburse();
        assertGe(amt, PRINCIPAL, "raised < principal");
        emit log_named_uint("disbursed USDC raw", amt);
        assertEq(IERC20(USDC).balanceOf(BORROWER) - before, amt, "borrower not paid");
        assertEq(uint8(v.status()), uint8(FeeVault.Status.Active));
        // lender exits the bid (refund of unspent USDC) and claims its notes
        a.exitBid(bidId);
        a.claimTokens(bidId);
    }

    // ───────────── tests ─────────────

    function test_fullLifecycle_pledgeAuctionCollectRepayRelease() public {
        (FeeVault v,,) = _fundedLoan();
        FeeNote note = v.note();
        uint256 notes = note.balanceOf(lender);
        assertGt(notes, 0, "lender got no notes");
        // CCA rounding can leave a few raw notes of dust inside the auction (still part of supply, still backed at release)
        assertApproxEqAbs(note.totalSupply(), notes, 10, "unsold notes not burned");
        assertEq(v.debtOutstanding(), note.totalSupply());
        assertFalse(v.canRelease());

        // collect: claim-first, the vault receives the pledged share of fees still in the pool
        uint256 w0 = IERC20(WETH).balanceOf(address(v));
        (uint128 f0,) = v.collect();
        uint256 wethGot = IERC20(WETH).balanceOf(address(v)) - w0;
        assertEq(uint256(f0), wethGot, "fees0 != WETH received (WETH is currency0)");
        emit log_named_uint("WETH collected by vault", wethGot);
        assertGt(wethGot, 0, "vault collected no WETH (pool had no pending fees at fork block)");

        // dining draw is junior: payDesk pays nothing while notes are uncovered
        vm.prank(keeper);
        v.addDraw(4e6);
        deal(USDC, address(v), notes / 2); // test fixture: stands in for WETH->USDC swap proceeds
        assertEq(v.payDesk(), 0, "desk paid before notes covered");

        // lender redeems part while Active
        vm.prank(lender);
        v.redeem(notes / 4);
        assertEq(IERC20(USDC).balanceOf(lender) > 0, true);

        // full repayment + surplus
        uint256 ns = note.totalSupply();
        deal(USDC, address(v), ns + 4e6 + 7e6);
        assertTrue(v.canRelease());
        uint256 bUsdc = IERC20(USDC).balanceOf(BORROWER);
        uint256 bWeth = IERC20(WETH).balanceOf(BORROWER);
        vm.prank(makeAddr("feedesk.anyone"));
        v.release();

        assertEq(uint8(v.status()), uint8(FeeVault.Status.Released));
        assertEq(fm.getShares(POOL, address(v)), 0, "vault kept shares");
        assertEq(fm.getShares(POOL, BORROWER), borrowerShares, "shares not restored");
        assertEq(IERC20(USDC).balanceOf(treasury), 4e6, "desk draw not repaid");
        assertEq(IERC20(USDC).balanceOf(BORROWER) - bUsdc, 7e6, "surplus not returned");
        assertGe(IERC20(WETH).balanceOf(BORROWER) - bWeth, wethGot, "WETH not returned");
        assertEq(desk.activeVaultByPool(POOL), address(0));

        // remaining notes stay redeemable after release
        uint256 rest = note.balanceOf(lender);
        vm.prank(lender);
        v.redeem(rest);
        assertEq(IERC20(USDC).balanceOf(address(v)), note.totalSupply(), "dust notes stay fully backed");
    }

    function test_createLoan_guards() public {
        CreateLoanParams memory p = CreateLoanParams(BORROWER, POOL, FM, GITLAWB, PRINCIPAL, FACE, DRAW_LIMIT, "n", "s");
        vm.expectRevert(FeeDesk.Unauthorized.selector);
        desk.createLoan(p);
        FeeVault v = _createLoan();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeDesk.PoolHasOpenLoan.selector, address(v)));
        desk.createLoan(p);
        vm.prank(keeper);
        v.cancel(); // frees the pool
        p.creatorToken = USDC; // the real pool is GITLAWB/WETH
        vm.prank(keeper);
        vm.expectRevert(FeeVault.PoolTokenMismatch.selector);
        desk.createLoan(p);
        p.creatorToken = GITLAWB;
        p.borrower = makeAddr("nobody");
        vm.prank(keeper);
        vm.expectRevert(FeeDesk.BorrowerHasNoShares.selector);
        desk.createLoan(p);
    }

    function test_confirmPledge_requiresAllShares() public {
        FeeVault v = _createLoan();
        vm.expectRevert(FeeVault.NotPledged.selector);
        v.confirmPledge();
    }

    function test_cancel_created_keeperOnly() public {
        FeeVault v = _createLoan();
        vm.expectRevert(FeeVault.Unauthorized.selector);
        v.cancel();
        vm.prank(keeper);
        v.cancel();
        assertEq(uint8(v.status()), uint8(FeeVault.Status.Cancelled));
        assertEq(desk.activeVaultByPool(POOL), address(0));
    }

    function test_cancel_pledged_timeoutReturnsLien() public {
        FeeVault v = _createLoan();
        _pledge(v);
        assertEq(fm.getShares(POOL, BORROWER), 0);
        vm.expectRevert(FeeVault.Unauthorized.selector);
        v.cancel();
        vm.warp(block.timestamp + 1 days);
        v.cancel();
        assertEq(fm.getShares(POOL, BORROWER), borrowerShares);
        assertEq(fm.getShares(POOL, address(v)), 0);
    }

    function test_returnStrayShares_afterLatePledge() public {
        FeeVault v = _createLoan();
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadStatus.selector, FeeVault.Status.Created));
        v.returnStrayShares();
        vm.prank(keeper);
        v.cancel();
        // borrower signs the stale pledge tx after the vault closed
        vm.prank(BORROWER);
        fm.updateBeneficiary(POOL, address(v));
        deal(USDC, address(v), 3e6);
        assertEq(fm.getShares(POOL, BORROWER), 0);
        uint256 b = IERC20(USDC).balanceOf(BORROWER);
        v.returnStrayShares(); // anyone
        assertEq(fm.getShares(POOL, BORROWER), borrowerShares, "shares not returned");
        assertEq(IERC20(USDC).balanceOf(BORROWER) - b, 3e6, "stray USDC not returned");
    }

    function test_cancel_auctionNotGraduated() public {
        FeeVault v = _createLoan();
        _pledge(v);
        ICCA a = _startAuction(v);
        uint256 id = _bid(a, lender, 10e6, 95 * TICK); // far below principal
        vm.expectRevert(FeeVault.AuctionNotOver.selector);
        v.cancel();
        vm.roll(block.number + AUCTION_BLOCKS);
        vm.prank(keeper);
        vm.expectRevert(FeeVault.NotGraduated.selector);
        v.disburse();
        v.cancel(); // anyone
        assertEq(uint8(v.status()), uint8(FeeVault.Status.Cancelled));
        assertEq(fm.getShares(POOL, BORROWER), borrowerShares);
        assertEq(v.note().totalSupply(), 0, "notes not burned");
        uint256 before = IERC20(USDC).balanceOf(lender);
        a.exitBid(id);
        assertEq(IERC20(USDC).balanceOf(lender) - before, 10e6, "bidder not refunded");
    }

    /// DESK_ANCHOR_BID_PCT=100: a single bid of exactly `principal` must graduate when floor = ceil(principal/face).
    function test_anchorBidOfExactlyPrincipalGraduates() public {
        FeeVault v = _createLoan();
        _pledge(v);
        ICCA a = _startAuction(v);
        _bid(a, lender, uint128(PRINCIPAL), 95 * TICK);
        vm.roll(block.number + AUCTION_BLOCKS);
        vm.prank(keeper);
        uint256 amt = v.disburse();
        emit log_named_uint("disbursed USDC raw", amt);
        assertGe(amt, PRINCIPAL);
    }

    function test_disburse_keeperThenAnyoneAfterGrace() public {
        FeeVault v = _createLoan();
        _pledge(v);
        ICCA a = _startAuction(v);
        _bid(a, lender, uint128(PRINCIPAL + 5e6), 100 * TICK);
        vm.roll(block.number + AUCTION_BLOCKS);
        vm.expectRevert(FeeVault.Unauthorized.selector);
        v.disburse();
        vm.roll(block.number + v.DISBURSE_GRACE_BLOCKS());
        v.disburse();
        assertEq(uint8(v.status()), uint8(FeeVault.Status.Active));
    }

    function test_flash1271_digestMatchesEip712() public {
        FeeVault v = _createLoan();
        _pledge(v);
        FlashOrder memory o = FlashOrder({
            swapper: address(v),
            vault: 0x1111111111111111111111111111111111111111,
            recipient: address(v),
            fromToken: GITLAWB,
            toToken: USDC,
            fromAmount: 1e18,
            salt: 42,
            deadline: block.timestamp + 3600
        });
        string memory json = string.concat(
            '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],',
            '"FlashOrder":[{"name":"swapper","type":"address"},{"name":"vault","type":"address"},{"name":"recipient","type":"address"},{"name":"fromToken","type":"address"},{"name":"toToken","type":"address"},{"name":"fromAmount","type":"uint256"},{"name":"salt","type":"uint256"},{"name":"deadline","type":"uint256"}]},',
            '"primaryType":"FlashOrder","domain":{"name":"DefinitiveFlashAllowance","version":"1","chainId":8453,"verifyingContract":"0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78"},',
            '"message":{"swapper":"',
            vm.toString(address(v)),
            '","vault":"0x1111111111111111111111111111111111111111","recipient":"',
            vm.toString(address(v)),
            '","fromToken":"',
            vm.toString(GITLAWB),
            '","toToken":"',
            vm.toString(USDC),
            '","fromAmount":"1000000000000000000","salt":"42","deadline":"',
            vm.toString(o.deadline),
            '"}}'
        );
        bytes32 expected = vm.eip712HashTypedData(json);

        assertEq(v.isValidSignature(expected, ""), bytes4(0xffffffff));
        vm.prank(keeper);
        bytes32 d = v.authorizeFlashOrder(o);
        assertEq(d, expected, "digest != EIP-712 typed-data hash");
        assertEq(v.isValidSignature(expected, hex"1234"), bytes4(0x1626ba7e));

        // cancel message: EIP-191 hash (matches `cast hash-message` / viem hashMessage)
        vm.prank(keeper);
        bytes32 c = v.authorizeFlashCancel("ord_123");
        assertEq(c, 0x76da94f47dffc7c9cc49fd5ad39e4a550a774207c2a313067217b41dc741ecdc);
        assertEq(v.isValidSignature(c, ""), bytes4(0x1626ba7e));

        // guards: output must come back to the vault in USDC
        o.recipient = keeper;
        vm.prank(keeper);
        vm.expectRevert(FeeVault.BadFlashOrder.selector);
        v.authorizeFlashOrder(o);
        o.recipient = address(v);
        o.fromToken = USDC;
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadToken.selector, USDC));
        v.authorizeFlashOrder(o);
        vm.expectRevert(FeeVault.Unauthorized.selector);
        v.approveFlash(GITLAWB, 1);
    }

    function test_drawLimitAndKeeperOnly() public {
        (FeeVault v,,) = _fundedLoan();
        vm.expectRevert(FeeVault.Unauthorized.selector);
        v.addDraw(1e6);
        vm.prank(keeper);
        vm.expectRevert(FeeVault.OverDrawLimit.selector);
        v.addDraw(DRAW_LIMIT + 1);
        vm.prank(keeper);
        v.addDraw(DRAW_LIMIT);
        assertEq(v.drawDebt(), DRAW_LIMIT);
        assertEq(v.debtOutstanding(), v.note().totalSupply() + DRAW_LIMIT);
    }

    function test_tokenLegFallbackToKeeper() public {
        (FeeVault v,,) = _fundedLoan();
        v.collect();
        uint256 t = IERC20(GITLAWB).balanceOf(address(v));
        if (t == 0) deal(GITLAWB, address(v), 1e18); // pool had no token-leg fees pending at this block
        t = IERC20(GITLAWB).balanceOf(address(v));
        vm.prank(keeper);
        v.sendTokenLegToKeeper(GITLAWB, t);
        assertEq(IERC20(GITLAWB).balanceOf(keeper), t);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadToken.selector, USDC));
        v.sendTokenLegToKeeper(USDC, 1);
    }

    // ───────────── review follow-ups ─────────────

    function _mockSwap(FeeVault v, uint256 wethIn) internal {
        vm.etch(v.UNI_SWAP_PROXY(), address(new MockSwapProxy()).code);
        deal(USDC, v.UNI_SWAP_PROXY(), 1_000_000e6);
        deal(WETH, address(v), wethIn);
    }

    function test_swapWethToUsdc_oracleFloorSlippageAndAllowanceReset() public {
        (FeeVault v,,) = _fundedLoan();
        uint256 wethIn = 0.1 ether;
        _mockSwap(v, wethIn);
        uint256 floor = v.oracleMinUsdcOut(wethIn);
        emit log_named_uint("oracle floor USDC raw for 0.1 WETH", floor);
        assertGt(floor, 100e6, "0.1 ETH should be worth > 100 USDC");
        uint256 fair = floor * 10_000 / 9_500;

        // leaked keeper key: minOut 0 is rejected before any call
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.Slippage.selector, 0, floor));
        v.swapWethToUsdc(abi.encodeCall(MockSwapProxy.swap, (wethIn, address(v), 1)), wethIn, 0);

        // output redirected to the keeper: the vault sees 0 USDC
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.Slippage.selector, 0, floor));
        v.swapWethToUsdc(abi.encodeCall(MockSwapProxy.swap, (wethIn, keeper, fair)), wethIn, floor);

        // output below the keeper's own minOut
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.Slippage.selector, floor, fair));
        v.swapWethToUsdc(abi.encodeCall(MockSwapProxy.swap, (wethIn, address(v), floor)), wethIn, fair);

        // honest swap
        uint256 u0 = IERC20(USDC).balanceOf(address(v));
        vm.prank(keeper);
        uint256 out = v.swapWethToUsdc(abi.encodeCall(MockSwapProxy.swap, (wethIn, address(v), fair)), wethIn, fair);
        assertEq(out, fair);
        assertEq(IERC20(USDC).balanceOf(address(v)) - u0, fair);
        assertEq(IERC20Full(WETH).allowance(address(v), v.UNI_SWAP_PROXY()), 0, "approval not reset");
        assertEq(IERC20(WETH).balanceOf(address(v)), 0);
    }

    function test_wethNeverLeavesExceptViaSwap() public {
        (FeeVault v,,) = _fundedLoan();
        deal(WETH, address(v), 1 ether);
        vm.startPrank(keeper);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadToken.selector, WETH));
        v.sendTokenLegToKeeper(WETH, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadToken.selector, WETH));
        v.approveFlash(WETH, 1 ether);
        vm.stopPrank();
    }

    function test_startAuction_bounds() public {
        FeeVault v = _createLoan();
        _pledge(v);
        uint64 s = uint64(block.number + 1);
        uint64 maxLen = v.MAX_AUCTION_BLOCKS();
        uint64 maxClaim = v.MAX_CLAIM_DELAY_BLOCKS();
        bytes memory st = _steps(AUCTION_BLOCKS);
        vm.startPrank(keeper);
        vm.expectRevert(FeeVault.BadAuctionParams.selector); // floor 0.90 * 110 < 100
        v.startAuction(s, s + AUCTION_BLOCKS, s + AUCTION_BLOCKS, TICK, 90 * TICK, st);
        vm.expectRevert(FeeVault.BadAuctionParams.selector); // too long
        v.startAuction(s, s + maxLen + 1, s + maxLen + 1, TICK, 91 * TICK, st);
        vm.expectRevert(FeeVault.BadAuctionParams.selector); // claim too late
        v.startAuction(s, s + AUCTION_BLOCKS, s + AUCTION_BLOCKS + maxClaim + 1, TICK, 91 * TICK, st);
        vm.expectRevert(FeeVault.BadAuctionParams.selector); // starts too far ahead
        v.startAuction(s + 300, s + 300 + AUCTION_BLOCKS, s + 300 + AUCTION_BLOCKS, TICK, 91 * TICK, st);
        vm.stopPrank();
    }

    function test_cancel_graduatedAuctionRevertsThenKeeperDisburses() public {
        FeeVault v = _createLoan();
        _pledge(v);
        ICCA a = _startAuction(v);
        _bid(a, lender, uint128(PRINCIPAL + 5e6), 100 * TICK);
        vm.roll(block.number + AUCTION_BLOCKS);
        vm.prank(makeAddr("feedesk.anyone"));
        vm.expectRevert(abi.encodeWithSelector(FeeVault.BadStatus.selector, FeeVault.Status.Auction));
        v.cancel(); // no checkpoint yet: cancel checkpoints the end block, then sees graduation
        vm.prank(keeper);
        assertGe(v.disburse(), PRINCIPAL);
    }

    function test_partialPayDesk_redeemAboveBalance_releaseBurnsHeldNotes() public {
        (FeeVault v,,) = _fundedLoan();
        FeeNote note = v.note();
        vm.prank(keeper);
        v.addDraw(4e6);
        uint256 ns = note.totalSupply();

        vm.prank(lender);
        vm.expectRevert(SafeTransferLib.TransferFailed.selector); // vault holds no USDC yet
        v.redeem(1);

        deal(USDC, address(v), ns + 1e6);
        assertEq(v.payDesk(), 1e6, "partial desk payment");
        assertEq(v.drawDebt(), 3e6);
        assertEq(IERC20(USDC).balanceOf(treasury), 1e6);

        // lender sends notes to the vault by mistake; at release their backing goes to the borrower
        uint256 stray = 5e6;
        vm.prank(lender);
        note.transfer(address(v), stray);
        deal(USDC, address(v), ns + 3e6);
        uint256 b = IERC20(USDC).balanceOf(BORROWER);
        v.release();
        assertEq(IERC20(USDC).balanceOf(treasury), 4e6, "draw fully repaid");
        assertEq(IERC20(USDC).balanceOf(BORROWER) - b, stray, "stray-note backing not returned");
        assertEq(note.balanceOf(address(v)), 0);
        assertEq(IERC20(USDC).balanceOf(address(v)), note.totalSupply());
    }

    function test_flashOrder_expiredDeadline() public {
        FeeVault v = _createLoan();
        _pledge(v);
        FlashOrder memory o = FlashOrder(address(v), address(1), address(v), GITLAWB, USDC, 1e18, 1, block.timestamp);
        vm.prank(keeper);
        vm.expectRevert(FeeVault.BadFlashOrder.selector);
        v.authorizeFlashOrder(o);
    }
}
