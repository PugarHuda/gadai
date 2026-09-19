// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {SignatureCheckerLib} from "solady/utils/SignatureCheckerLib.sol";
import {FeeNote} from "./FeeNote.sol";
import {IFeesManager} from "./interfaces/IFeesManager.sol";
import {ICCA, ICCAFactory, AuctionParameters} from "./interfaces/ICCA.sol";

struct CreateLoanParams {
    address borrower; // current fee beneficiary; receives disbursement + lien back
    bytes32 poolId;
    address feesManager; // Bankr API feesContract ?? initializer
    address creatorToken; // non-WETH leg of the pool
    uint256 principal; // USDC raw; = CCA requiredCurrencyRaised
    uint256 faceValue; // FeeNote supply (raw) = note debt
    uint256 drawLimit; // USDC raw; Flynet dining line cap
    string noteName;
    string noteSymbol;
}

/// Definitive Flash order struct (EIP-712 type captured from a live Flash /quote, docs/integrations/flash.md).
struct FlashOrder {
    address swapper;
    address vault; // Flash integrator vault, filled in by Flash (not this contract)
    address recipient;
    address fromToken;
    address toToken;
    uint256 fromAmount;
    uint256 salt;
    uint256 deadline;
}

interface IChainlinkFeed {
    function latestRoundData() external view returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80);
}

interface IFeeDeskView {
    function keeper() external view returns (address);
    function treasury() external view returns (address);
    function onVaultClosed(bytes32 poolId) external;
}

/// @title FeeVault
/// @notice One per loan. Holds the borrower's Doppler fee rights (it is the FeesManager beneficiary) as a lien,
///         funds the loan through a Uniswap CCA of its FeeNote, collects + converts fees, repays noteholders
///         and the desk, then hands the fee rights back. Every token balance in this contract belongs to this loan.
contract FeeVault is ReentrancyGuard {
    using SafeTransferLib for address;

    enum Status {
        Created,
        Pledged,
        Auction,
        Active,
        Released,
        Cancelled
    }

    // ─── Base mainnet addresses (verified, docs/integrations/uniswap.md §0 + flash.md) ───
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant UNI_SWAP_PROXY = 0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9; // Trading API x-permit2-disabled (SwapProxy the API returned on 2026-09-19)
    address public constant CCA_FACTORY = 0x000000001F26a0044BaA66024e7b6599c61963F8; // CCA v2.1.0
    address public constant FLASH_SETTLEMENT = 0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78;
    /// @dev Chainlink ETH/USD on Base (8 decimals; verified on-chain by agent-wallet-keeper, COORDINATION 03:30).
    address public constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    /// @dev swapWethToUsdc must demand >= 95% of the oracle value. The keeper already rejects quotes >3% under the
    ///      oracle and sets minOut = quote - 0.5%, so honest swaps pass; a leaked keeper key cannot dump fees at ~0.
    uint256 public constant MIN_OUT_BPS_OF_ORACLE = 9_500;
    /// @dev ponytail: 1 day, not the 20-min heartbeat, so a DEMO_FORK (feed frozen at the fork block) still swaps.
    ///      A stale price can only make honest swaps revert or loosen the floor a little; tighten for production.
    uint256 public constant MAX_ORACLE_AGE = 1 days;
    /// @dev startAuction bounds so the keeper cannot lock the lien / lender USDC indefinitely (~2s blocks on Base).
    uint64 public constant MAX_START_DELAY_BLOCKS = 300; // ~10 min
    uint64 public constant MAX_AUCTION_BLOCKS = 43_200; // ~1 day
    uint64 public constant MAX_CLAIM_DELAY_BLOCKS = 1_800; // ~1 h
    uint256 internal constant Q96 = 2 ** 96;

    bytes32 public constant FLASH_ORDER_TYPEHASH = keccak256(
        "FlashOrder(address swapper,address vault,address recipient,address fromToken,address toToken,uint256 fromAmount,uint256 salt,uint256 deadline)"
    );
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    /// @dev A pledge that never reaches an auction can be cancelled by anyone after this.
    uint256 public constant PLEDGE_TIMEOUT = 1 days;
    /// @dev If the keeper does not disburse a graduated auction, anyone can after endBlock + this (~1h on Base).
    uint64 public constant DISBURSE_GRACE_BLOCKS = 1800;

    address public immutable desk;
    uint256 public immutable loanId;
    address public immutable borrower;
    bytes32 public immutable poolId;
    address public immutable feesManager;
    address public immutable creatorToken;
    FeeNote public immutable note;
    uint256 public immutable principal;
    uint256 public immutable faceValue;
    uint256 public immutable drawLimit;
    bool internal immutable wethIsToken0;

    Status public status;
    uint64 public pledgedAt;
    address public auction;
    uint256 public drawn; // cumulative dining draws
    uint256 public drawDebt; // unpaid dining draws (junior to notes)
    mapping(bytes32 => bool) public approvedHash; // EIP-1271 hashes the keeper authorized (Flash orders/cancels)

    event Pledged(address indexed borrower, uint256 shares);
    event AuctionStarted(address indexed auction, uint64 startBlock, uint64 endBlock, uint256 floorPriceQ96, uint256 faceValue);
    event Disbursed(address indexed borrower, uint256 amount);
    event Collected(uint256 fees0, uint256 fees1);
    event Swapped(uint256 wethIn, uint256 usdcOut);
    event FlashOrderAuthorized(bytes32 indexed digest, address fromToken, uint256 fromAmount);
    event TokenLegSent(address indexed keeper, address token, uint256 amount);
    event Drawn(uint256 amount, uint256 drawDebt);
    event DeskPaid(uint256 amount);
    event Redeemed(address indexed holder, uint256 notes);
    event Released(address indexed borrower);
    event Cancelled(uint8 fromStatus);

    error Unauthorized();
    error BadStatus(Status status);
    error NotPledged();
    error PoolTokenMismatch();
    error NotGraduated();
    error AuctionNotOver();
    error Slippage(uint256 got, uint256 minOut);
    error BadToken(address token);
    error BadFlashOrder();
    error OverDrawLimit();
    error CannotRelease();
    error BadAuctionParams();
    error BadOracle();

    modifier onlyKeeper() {
        if (msg.sender != IFeeDeskView(desk).keeper()) revert Unauthorized();
        _;
    }

    /// @dev Servicing is allowed while the lien is held: Pledged, Auction, Active.
    modifier whileOpen() {
        Status s = status;
        if (s != Status.Pledged && s != Status.Auction && s != Status.Active) revert BadStatus(s);
        _;
    }

    constructor(uint256 loanId_, CreateLoanParams memory p) {
        desk = msg.sender;
        loanId = loanId_;
        borrower = p.borrower;
        poolId = p.poolId;
        feesManager = p.feesManager;
        creatorToken = p.creatorToken;
        principal = p.principal;
        faceValue = p.faceValue;
        drawLimit = p.drawLimit;
        wethIsToken0 = WETH < p.creatorToken; // v4 orders currency0 < currency1
        // The pool must be creatorToken/WETH, otherwise fees would land in a token this vault never forwards.
        // getPoolKey is verified on the Doppler initializer; managers without it are accepted as-is.
        try IFeesManager(p.feesManager).getPoolKey(p.poolId) returns (address c0, address c1, uint24, int24, address) {
            (address w, address t) = wethIsToken0 ? (c0, c1) : (c1, c0);
            if (w != WETH || t != p.creatorToken) revert PoolTokenMismatch();
        } catch {}
        note = new FeeNote(p.noteName, p.noteSymbol);
    }

    // ───────────────────────────── views ─────────────────────────────

    function noteSupply() public view returns (uint256) {
        return note.totalSupply();
    }

    /// @notice USDC still owed to noteholders and the desk, net of USDC already sitting in the vault.
    function debtOutstanding() public view returns (uint256) {
        uint256 owed = noteSupply() + drawDebt;
        uint256 bal = USDC.balanceOf(address(this));
        return bal >= owed ? 0 : owed - bal;
    }

    function canRelease() public view returns (bool) {
        return status == Status.Active && USDC.balanceOf(address(this)) >= noteSupply() + drawDebt;
    }

    function isValidSignature(bytes32 hash, bytes calldata) external view returns (bytes4) {
        return approvedHash[hash] ? ERC1271_MAGIC : bytes4(0xffffffff);
    }

    function flashDomainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("DefinitiveFlashAllowance"),
                keccak256("1"),
                block.chainid,
                FLASH_SETTLEMENT
            )
        );
    }

    function flashOrderDigest(FlashOrder calldata o) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                FLASH_ORDER_TYPEHASH, o.swapper, o.vault, o.recipient, o.fromToken, o.toToken, o.fromAmount, o.salt, o.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", flashDomainSeparator(), structHash));
    }

    // ───────────────────────────── lifecycle ─────────────────────────────

    /// @notice Anyone. After the borrower called FeesManager.updateBeneficiary(poolId, vault) for ALL its shares.
    function confirmPledge() external {
        if (status != Status.Created) revert BadStatus(status);
        IFeesManager fm = IFeesManager(feesManager);
        uint256 shares = fm.getShares(poolId, address(this));
        if (shares == 0 || fm.getShares(poolId, borrower) != 0) revert NotPledged();
        status = Status.Pledged;
        pledgedAt = uint64(block.timestamp);
        emit Pledged(borrower, shares);
    }

    /// @notice Keeper. Creates the FeeNote CCA (USDC currency, graduation = principal) and funds it with faceValue notes.
    function startAuction(
        uint64 startBlock,
        uint64 endBlock,
        uint64 claimBlock,
        uint256 tickSpacingQ96,
        uint256 floorPriceQ96,
        bytes calldata stepsData
    ) external onlyKeeper nonReentrant returns (address a) {
        if (status != Status.Pledged) revert BadStatus(status);
        // Bounded timing, and selling every note at the floor must raise >= principal (else it can never graduate).
        if (
            startBlock < block.number || startBlock > block.number + MAX_START_DELAY_BLOCKS || endBlock <= startBlock
                || endBlock - startBlock > MAX_AUCTION_BLOCKS || claimBlock < endBlock
                || claimBlock - endBlock > MAX_CLAIM_DELAY_BLOCKS || floorPriceQ96 * faceValue < principal * Q96
        ) revert BadAuctionParams();
        AuctionParameters memory params = AuctionParameters({
            currency: USDC,
            tokensRecipient: address(this),
            fundsRecipient: address(this),
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: claimBlock,
            tickSpacing: tickSpacingQ96,
            validationHook: address(0),
            floorPrice: floorPriceQ96,
            requiredCurrencyRaised: uint128(principal),
            auctionStepsData: stepsData
        });
        a = ICCAFactory(CCA_FACTORY).create(address(note), faceValue, abi.encode(params), bytes32(loanId));
        auction = a;
        status = Status.Auction;
        note.mint(a, faceValue);
        ICCA(a).onTokensReceived();
        emit AuctionStarted(a, startBlock, endBlock, floorPriceQ96, faceValue);
    }

    /// @notice Keeper (Dynamic agent wallet) after the auction graduated; anyone after DISBURSE_GRACE_BLOCKS.
    ///         Sweeps the raised USDC to the borrower and burns unsold notes.
    function disburse() external nonReentrant returns (uint256 amount) {
        if (status != Status.Auction) revert BadStatus(status);
        ICCA a = ICCA(auction);
        if (msg.sender != IFeeDeskView(desk).keeper() && block.number < a.endBlock() + DISBURSE_GRACE_BLOCKS) {
            revert Unauthorized();
        }
        uint256 before = USDC.balanceOf(address(this));
        a.sweepCurrency(); // reverts before endBlock; checkpoints the end block
        if (!a.isGraduated()) revert NotGraduated();
        amount = USDC.balanceOf(address(this)) - before;
        a.sweepUnsoldTokens();
        _burnHeldNotes();
        status = Status.Active;
        USDC.safeTransfer(borrower, amount);
        emit Disbursed(borrower, amount);
    }

    /// @notice Created: keeper. Pledged: keeper, or anyone after PLEDGE_TIMEOUT.
    ///         Auction: anyone once endBlock passed and it did not graduate. Returns the lien and all balances.
    function cancel() external nonReentrant {
        Status s = status;
        if (s == Status.Created) {
            if (msg.sender != IFeeDeskView(desk).keeper()) revert Unauthorized();
        } else if (s == Status.Pledged) {
            if (msg.sender != IFeeDeskView(desk).keeper() && block.timestamp < pledgedAt + PLEDGE_TIMEOUT) {
                revert Unauthorized();
            }
        } else if (s == Status.Auction) {
            ICCA a = ICCA(auction);
            if (block.number < a.endBlock()) revert AuctionNotOver();
            a.sweepUnsoldTokens(); // checkpoints the end block
            if (a.isGraduated()) revert BadStatus(s);
            _burnHeldNotes();
        } else {
            revert BadStatus(s);
        }
        status = Status.Cancelled;
        _returnLien();
        _sendAll(USDC, borrower, USDC.balanceOf(address(this)));
        IFeeDeskView(desk).onVaultClosed(poolId);
        emit Cancelled(uint8(s));
    }

    // ───────────────────────────── servicing ─────────────────────────────

    /// @notice Anyone. Pulls the vault's share of pool fees (claim-first: fees uncollected at pledge time land here).
    /// @return fees0 fees1 amounts THIS VAULT received in currency0/currency1 (not the pool totals).
    function collect() external whileOpen nonReentrant returns (uint128 fees0, uint128 fees1) {
        uint256 w0 = WETH.balanceOf(address(this));
        uint256 t0 = creatorToken.balanceOf(address(this));
        IFeesManager(feesManager).collectFees(poolId);
        uint256 w = WETH.balanceOf(address(this)) - w0;
        uint256 t = creatorToken.balanceOf(address(this)) - t0;
        (fees0, fees1) = wethIsToken0 ? (uint128(w), uint128(t)) : (uint128(t), uint128(w));
        emit Collected(fees0, fees1);
    }

    /// @notice Keeper relays Uniswap Trading API /swap calldata (x-permit2-disabled => target is SwapProxy).
    ///         The vault approves exactly amountIn and enforces minUsdcOut on-chain, and minUsdcOut itself must be
    ///         >= MIN_OUT_BPS_OF_ORACLE of amountIn at the Chainlink ETH/USD price.
    function swapWethToUsdc(bytes calldata swapData, uint256 amountIn, uint256 minUsdcOut)
        external
        onlyKeeper
        whileOpen
        nonReentrant
        returns (uint256 usdcOut)
    {
        uint256 floor = oracleMinUsdcOut(amountIn);
        if (minUsdcOut < floor) revert Slippage(minUsdcOut, floor);
        uint256 before = USDC.balanceOf(address(this));
        WETH.safeApprove(UNI_SWAP_PROXY, amountIn);
        (bool ok, bytes memory ret) = UNI_SWAP_PROXY.call(swapData);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        WETH.safeApprove(UNI_SWAP_PROXY, 0);
        usdcOut = USDC.balanceOf(address(this)) - before;
        if (usdcOut < minUsdcOut) revert Slippage(usdcOut, minUsdcOut);
        emit Swapped(amountIn, usdcOut);
    }

    /// @notice Sets (does not add to) the settlement allowance: one open Flash order per vault at a time.
    ///         The agent enforces that (flash.hasOpenFlashOrder); a second order would replace the first's allowance.
    function approveFlash(address token, uint256 amount) external onlyKeeper whileOpen {
        _checkLegToken(token);
        token.safeApprove(FLASH_SETTLEMENT, amount);
    }

    /// @notice Keeper authorizes one Flash order where this vault is funder and recipient and USDC is the output.
    function authorizeFlashOrder(FlashOrder calldata o) external onlyKeeper whileOpen returns (bytes32 digest) {
        if (o.swapper != address(this) || o.recipient != address(this) || o.toToken != USDC || o.deadline <= block.timestamp)
        {
            revert BadFlashOrder();
        }
        _checkLegToken(o.fromToken);
        digest = flashOrderDigest(o);
        approvedHash[digest] = true;
        emit FlashOrderAuthorized(digest, o.fromToken, o.fromAmount);
    }

    /// @notice Keeper authorizes the EIP-191 hash of Flash's cancel message for `orderId`.
    function authorizeFlashCancel(string calldata orderId) external onlyKeeper returns (bytes32 digest) {
        digest = SignatureCheckerLib.toEthSignedMessageHash(
            abi.encodePacked(unicode"Definitive Flash v1 — Cancel Order\nOrder: ", orderId)
        );
        approvedHash[digest] = true;
    }

    /// @notice Fallback when Flash rejects 1271 funders: keeper runs the TWAP and transfers the USDC back.
    ///         Creator token only (WETH goes through swapWethToUsdc with its oracle floor). This path is custodial:
    ///         a leaked keeper key can take the token leg, which is why it is never used for WETH.
    function sendTokenLegToKeeper(address token, uint256 amount) external onlyKeeper whileOpen nonReentrant {
        _checkLegToken(token);
        token.safeTransfer(msg.sender, amount);
        emit TokenLegSent(msg.sender, token, amount);
    }

    /// @notice Keeper books a Flynet dining draw (FLY issued off-chain) as junior USDC debt.
    function addDraw(uint256 usdcAmount) external onlyKeeper {
        if (status != Status.Active) revert BadStatus(status);
        if (drawn + usdcAmount > drawLimit) revert OverDrawLimit();
        drawn += usdcAmount;
        drawDebt += usdcAmount;
        emit Drawn(usdcAmount, drawDebt);
    }

    /// @notice Anyone. Pays the desk treasury from USDC in excess of outstanding notes (notes are senior).
    function payDesk() external nonReentrant returns (uint256) {
        return _payDesk();
    }

    /// @notice Noteholders burn notes for USDC 1:1 while repayment USDC is available.
    function redeem(uint256 notes) external nonReentrant {
        if (status != Status.Active && status != Status.Released) revert BadStatus(status);
        note.burn(msg.sender, notes);
        USDC.safeTransfer(msg.sender, notes);
        emit Redeemed(msg.sender, notes);
    }

    /// @notice Anyone, once notes + draws are covered. Fee rights and all surplus go back to the borrower.
    ///         USDC backing unredeemed notes stays here for redeem().
    function release() external nonReentrant {
        if (!canRelease()) revert CannotRelease();
        _burnHeldNotes(); // notes sent to the vault by mistake: their backing goes to the borrower, not stuck here
        _payDesk();
        status = Status.Released;
        _returnLien();
        _sendAll(USDC, borrower, USDC.balanceOf(address(this)) - noteSupply());
        IFeeDeskView(desk).onVaultClosed(poolId);
        emit Released(borrower);
    }

    /// @notice Anyone, once the vault is closed (Cancelled|Released). Backstop for late pledges (a stale pledge tx
    ///         or chat phrase executed after close) and late proceeds (e.g. a Flash fill after release): returns
    ///         any fee shares, WETH, creator token and USDC above what backs unredeemed notes to the borrower.
    function returnStrayShares() external nonReentrant {
        Status s = status;
        if (s != Status.Cancelled && s != Status.Released) revert BadStatus(s);
        _returnLien();
        _burnHeldNotes();
        uint256 bal = USDC.balanceOf(address(this));
        uint256 ns = noteSupply();
        if (bal > ns) _sendAll(USDC, borrower, bal - ns);
    }

    // ───────────────────────────── internal ─────────────────────────────

    function _payDesk() internal returns (uint256 paid) {
        uint256 bal = USDC.balanceOf(address(this));
        uint256 ns = noteSupply();
        if (drawDebt == 0 || bal <= ns) return 0;
        paid = bal - ns < drawDebt ? bal - ns : drawDebt;
        drawDebt -= paid;
        USDC.safeTransfer(IFeeDeskView(desk).treasury(), paid);
        emit DeskPaid(paid);
    }

    /// @dev Moves the fee shares back to the borrower (FeesManager releases the vault's accrued fees to it first),
    ///      revokes Flash allowances and forwards all WETH and creator tokens.
    function _returnLien() internal {
        if (IFeesManager(feesManager).getShares(poolId, address(this)) > 0) {
            IFeesManager(feesManager).updateBeneficiary(poolId, borrower);
        }
        WETH.safeApprove(FLASH_SETTLEMENT, 0);
        creatorToken.safeApprove(FLASH_SETTLEMENT, 0);
        _sendAll(WETH, borrower, WETH.balanceOf(address(this)));
        _sendAll(creatorToken, borrower, creatorToken.balanceOf(address(this)));
    }

    function _burnHeldNotes() internal {
        uint256 held = note.balanceOf(address(this));
        if (held > 0) note.burn(address(this), held);
    }

    function _sendAll(address token, address to, uint256 amount) internal {
        if (amount > 0) token.safeTransfer(to, amount);
    }

    /// @notice Lowest minUsdcOut swapWethToUsdc accepts for `wethIn` (USDC raw).
    function oracleMinUsdcOut(uint256 wethIn) public view returns (uint256) {
        (, int256 px8,, uint256 updatedAt,) = IChainlinkFeed(ETH_USD_FEED).latestRoundData();
        if (px8 <= 0 || updatedAt + MAX_ORACLE_AGE < block.timestamp) revert BadOracle();
        // WETH 18 dec * price 8 dec -> USDC 6 dec: / 1e20
        return wethIn * uint256(px8) * MIN_OUT_BPS_OF_ORACLE / 10_000 / 1e20;
    }

    /// @dev Only the creator-token leg leaves via Flash / the keeper; WETH only via the oracle-floored Uniswap swap.
    function _checkLegToken(address token) internal view {
        if (token != creatorToken) revert BadToken(token);
    }
}
