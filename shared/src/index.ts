// @feedesk/shared — types, constants, ABIs and API DTOs shared by agent + web.
// Dependency-free plain TS (erasable syntax only, so Node 26 can run it without a build step).
// ABIs are viem human-readable strings: consumers do `parseAbi(FEE_VAULT_ABI)`.
// Conventions: `*Raw` = base-unit integer as decimal string (USDC 6 dec, WETH 18 dec, FLY 18 dec);
// `*Usd` / plain `price` = JS number for display only. Addresses are checksummed or lowercase hex.

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

// ─── chain + addresses (all verified on Base 8453, see docs/integrations/*.md) ───
export const CHAIN_ID_BASE = 8453;
export const BASESCAN = "https://basescan.org";

export const ADDR = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006",
  PERMIT2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  UNI_SWAP_PROXY: "0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9", // Trading API x-permit2-disabled flow (was 0x…85E102724e…Affad until 2026-09)
  UNIVERSAL_ROUTER_2_0: "0x6fF5693b99212Da76ad316178A184AB56D299b43",
  CCA_FACTORY: "0x000000001F26a0044BaA66024e7b6599c61963F8", // v2.1.0, protocolFeeController == 0
  FLASH_SETTLEMENT: "0x5d00000873b6BF41539e6f5365B0Ff7d3c368f78", // Definitive Flash, all EVM chains
  FM_DECAY_MULTICURVE: "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178", // FeesManager (older 57% launches)
  FM_DOPPLER_HOOK_INIT: "0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544", // current 95% launches
  FM_REHYPE_HOOK: "0x9982538f41f2ae29ddb9d3d9307010052984fdbb", // quote-only hook fees manager (API `feesContract`)
} as const satisfies Record<string, Address>;

/** Real Base pool with fees, used by fork tests + DEMO_FORK. */
export const TEST_POOL = {
  token: "0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3", // GITLAWB
  poolId: "0xec33256bf1ded407a57fd3c1965e7556e42ac14db09bc4e6fef57d5e2eb0b0b9",
  beneficiary: "0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf",
  feesManager: "0xD59cE43E53D69F190E15d9822Fb4540dCcc91178",
  sharePct: 57,
} as const;

export const API = {
  BANKR: "https://api.bankr.bot",
  BANKR_LLM: "https://llm.bankr.bot",
  UNISWAP_TRADE: "https://trade-api.gateway.uniswap.org/v1",
  FLASH: "https://flash.definitive.fi/v1",
  FLYNET_STAGING: "https://api.staging.blackbird.xyz/flynet/v1",
  FLYNET_PROD: "https://api.blackbird.xyz/flynet/v1",
} as const;

// ─── Q96 price helpers (FeeNote and USDC both 6 decimals ⇒ price = USDC per note) ───
export const Q96 = 2n ** 96n;
export const usdcPerNoteToQ96 = (price: number): bigint => (BigInt(Math.round(price * 1e6)) * Q96) / 1_000_000n;
export const q96ToUsdcPerNote = (q: bigint): number => Number((q * 1_000_000n) / Q96) / 1e6;
export const fmtUsdc = (raw: string | bigint): number => Number(BigInt(raw)) / 1e6;

// ─── Definitive Flash EIP-712 order (captured from a live /quote on 2026-09-18) ───
export const FLASH_EIP712_DOMAIN = {
  name: "DefinitiveFlashAllowance",
  version: "1",
  chainId: CHAIN_ID_BASE,
  verifyingContract: ADDR.FLASH_SETTLEMENT,
} as const;
export const FLASH_ORDER_TYPES = {
  FlashOrder: [
    { name: "swapper", type: "address" },
    { name: "vault", type: "address" },
    { name: "recipient", type: "address" },
    { name: "fromToken", type: "address" },
    { name: "toToken", type: "address" },
    { name: "fromAmount", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const flashCancelMessage = (orderId: string) => `Definitive Flash v1 — Cancel Order\nOrder: ${orderId}`;

// ─── ABIs (human-readable) ───
/** Doppler FeesManager subset. Verified from Blockscout source of 0xD59c…1178; Rehype hook shares the same base. */
export const FEES_MANAGER_ABI = [
  "function collectFees(bytes32 poolId) returns (uint128 fees0, uint128 fees1)",
  "function updateBeneficiary(bytes32 poolId, address newBeneficiary)",
  "function getShares(bytes32 poolId, address beneficiary) view returns (uint256 shares)",
  "function getCumulatedFees0(bytes32 poolId) view returns (uint256)",
  "function getCumulatedFees1(bytes32 poolId) view returns (uint256)",
  "function getLastCumulatedFees0(bytes32 poolId, address beneficiary) view returns (uint256)",
  "function getLastCumulatedFees1(bytes32 poolId, address beneficiary) view returns (uint256)",
  // present on 0xD59c…; NOT verified on the Rehype hook — do not rely on it there
  "function getPoolKey(bytes32 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
  "event Collect(bytes32 indexed poolId, uint256 fees0, uint256 fees1)",
  "event Release(bytes32 indexed poolId, address indexed beneficiary, uint256 fees0, uint256 fees1)",
  "event UpdateBeneficiary(bytes32 poolId, address oldBeneficiary, address newBeneficiary)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
] as const;

export const PERMIT2_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
] as const;

/** Uniswap CCA v2.1.0 auction subset (docs/integrations/uniswap.md §2.2). Struct field order: contracts module verifies vs source. */
export const CCA_AUCTION_ABI = [
  "function submitBid(uint256 maxPrice, uint128 amount, address owner, uint256 prevTickPrice, bytes hookData) payable returns (uint256 bidId)",
  "function checkpoint()",
  "function exitBid(uint256 bidId)",
  "function exitPartiallyFilledBid(uint256 bidId, uint64 lastFullyFilledCheckpointBlock, uint64 outbidBlock)",
  "function claimTokens(uint256 bidId)",
  "function clearingPrice() view returns (uint256)",
  "function isGraduated() view returns (bool)",
  "function currencyRaised() view returns (uint256)",
  "function totalCleared() view returns (uint256)",
  "function floorPrice() view returns (uint256)",
  "function tickSpacing() view returns (uint256)",
  "function ticks(uint256 price) view returns (uint256 next, uint256 currencyDemandQ96)",
  "function nextBidId() view returns (uint256)",
  "function bids(uint256 bidId) view returns ((uint64 startBlock, uint24 startCumulativeMps, uint64 exitedBlock, uint256 maxPrice, address owner, uint256 amountQ96, uint256 tokensFilled))",
  "function lastCheckpointedBlock() view returns (uint64)",
  "function checkpoints(uint64 blockNumber) view returns ((uint256 clearingPrice, uint256 currencyRaisedAtClearingPriceQ96_X7, uint256 cumulativeMpsPerPrice, uint24 cumulativeMps, uint64 prev, uint64 next))",
  "function startBlock() view returns (uint64)",
  "function endBlock() view returns (uint64)",
  "function claimBlock() view returns (uint64)",
  "function totalSupply() view returns (uint128)",
  "event BidSubmitted(uint256 indexed id, address indexed owner, uint256 price, uint128 amount)",
  "event BidExited(uint256 indexed bidId, address indexed owner, uint256 tokensFilled, uint256 currencyRefunded)",
  "event TokensClaimed(uint256 indexed bidId, address indexed owner, uint256 tokensFilled)",
] as const;

// Placeholders mirroring docs/COORDINATION.md "contracts interface v1".
// The contracts module OWNS these three and replaces them if the Solidity changes (post a COORDINATION line).
export const FEE_DESK_ABI = [
  "function activeVaultByPool(bytes32) view returns (address)",
  "function createLoan((address borrower, bytes32 poolId, address feesManager, address creatorToken, uint256 principal, uint256 faceValue, uint256 drawLimit, string noteName, string noteSymbol, bool keeperTokenCustody) p) returns (uint256 loanId, address vault, address note)",
  "function isVault(address) view returns (bool)",
  "function keeper() view returns (address)",
  "function loanCount() view returns (uint256)",
  "function maxOracleAge() view returns (uint256)",
  "function onVaultClosed(bytes32 poolId)",
  "function owner() view returns (address)",
  "function setKeeper(address k)",
  "function setOwner(address o)",
  "function setTreasury(address t)",
  "function treasury() view returns (address)",
  "function vaultOf(uint256) view returns (address)",
  "event KeeperSet(address keeper)",
  "event LoanCreated(uint256 indexed loanId, address indexed vault, address indexed borrower, address note, bytes32 poolId, address feesManager, address creatorToken, uint256 principal, uint256 faceValue, uint256 drawLimit)",
  "event OwnerSet(address owner)",
  "event TreasurySet(address treasury)",
  "error BadParams()",
  "error BorrowerHasNoShares()",
  "error PoolHasOpenLoan(address vault)",
  "error Unauthorized()",
] as const;

export const FEE_VAULT_ABI = [
  "function CCA_FACTORY() view returns (address)",
  "function DISBURSE_GRACE_BLOCKS() view returns (uint64)",
  "function ETH_USD_FEED() view returns (address)",
  "function FLASH_ORDER_TYPEHASH() view returns (bytes32)",
  "function FLASH_SETTLEMENT() view returns (address)",
  "function MAX_AUCTION_BLOCKS() view returns (uint64)",
  "function MAX_CLAIM_DELAY_BLOCKS() view returns (uint64)",
  "function MAX_START_DELAY_BLOCKS() view returns (uint64)",
  "function MIN_OUT_BPS_OF_ORACLE() view returns (uint256)",
  "function PLEDGE_TIMEOUT() view returns (uint256)",
  "function UNI_SWAP_PROXY() view returns (address)",
  "function USDC() view returns (address)",
  "function WETH() view returns (address)",
  "function addDraw(uint256 usdcAmount, uint256 deadline, bytes borrowerSig)",
  "function approveFlash(address token, uint256 amount)",
  "function approvedHash(bytes32) view returns (bool)",
  "function auction() view returns (address)",
  "function authorizeFlashCancel(string orderId) returns (bytes32 digest)",
  "function authorizeFlashOrder((address swapper, address vault, address recipient, address fromToken, address toToken, uint256 fromAmount, uint256 salt, uint256 deadline) o) returns (bytes32 digest)",
  "function borrower() view returns (address)",
  "function canRelease() view returns (bool)",
  "function cancel()",
  "function collect() returns (uint128 fees0, uint128 fees1)",
  "function confirmPledge()",
  "function creatorToken() view returns (address)",
  "function debtOutstanding() view returns (uint256)",
  "function desk() view returns (address)",
  "function disburse() returns (uint256 amount)",
  "function drawDebt() view returns (uint256)",
  "function drawLimit() view returns (uint256)",
  "function drawMessage(uint256 usdcAmount, uint256 nonce, uint256 deadline) view returns (string)",
  "function drawNonce() view returns (uint256)",
  "function drawn() view returns (uint256)",
  "function faceValue() view returns (uint256)",
  "function feesManager() view returns (address)",
  "function flashDomainSeparator() view returns (bytes32)",
  "function flashOrderDigest((address swapper, address vault, address recipient, address fromToken, address toToken, uint256 fromAmount, uint256 salt, uint256 deadline) o) view returns (bytes32)",
  "function isValidSignature(bytes32 hash, bytes) view returns (bytes4)",
  "function keeperTokenCustody() view returns (bool)",
  "function loanId() view returns (uint256)",
  "function maxOracleAge() view returns (uint256)",
  "function note() view returns (address)",
  "function noteSupply() view returns (uint256)",
  "function oracleMinUsdcOut(uint256 wethIn) view returns (uint256)",
  "function payDesk() returns (uint256)",
  "function pledgeShares() view returns (uint256)",
  "function pledgedAt() view returns (uint64)",
  "function poolId() view returns (bytes32)",
  "function principal() view returns (uint256)",
  "function redeem(uint256 notes)",
  "function release()",
  "function returnStrayShares()",
  "function sendTokenLegToKeeper(address token, uint256 amount)",
  "function startAuction(uint64 startBlock, uint64 endBlock, uint64 claimBlock, uint256 tickSpacingQ96, uint256 floorPriceQ96, bytes stepsData) returns (address a)",
  "function status() view returns (uint8)",
  "function swapWethToUsdc(bytes swapData, uint256 amountIn, uint256 minUsdcOut) returns (uint256 usdcOut)",
  "event AuctionStarted(address indexed auction, uint64 startBlock, uint64 endBlock, uint256 floorPriceQ96, uint256 faceValue)",
  "event Cancelled(uint8 fromStatus)",
  "event Collected(uint256 fees0, uint256 fees1)",
  "event DeskPaid(uint256 amount)",
  "event Disbursed(address indexed borrower, uint256 amount)",
  "event Drawn(uint256 amount, uint256 drawDebt)",
  "event FlashOrderAuthorized(bytes32 indexed digest, address fromToken, uint256 fromAmount)",
  "event KeeperTokenCustodyEnabled(address indexed keeper)",
  "event Pledged(address indexed borrower, uint256 shares)",
  "event Redeemed(address indexed holder, uint256 notes)",
  "event Released(address indexed borrower)",
  "event Swapped(uint256 wethIn, uint256 usdcOut)",
  "event TokenLegSent(address indexed keeper, address token, uint256 amount)",
  "error AuctionNotOver()",
  "error BadAuctionParams()",
  "error BadDrawSignature()",
  "error BadFlashOrder()",
  "error BadOracle()",
  "error BadStatus(uint8 status)",
  "error BadToken(address token)",
  "error CannotRelease()",
  "error CustodyDisabled()",
  "error DrawExpired()",
  "error NotGraduated()",
  "error NotPledged()",
  "error OverDrawLimit()",
  "error PoolTokenMismatch()",
  "error Reentrancy()",
  "error Slippage(uint256 got, uint256 minOut)",
  "error Unauthorized()",
] as const;

export const FEE_NOTE_ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32 result)",
  "function allowance(address owner, address spender) view returns (uint256 result)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256 result)",
  "function burn(address from, uint256 amount)",
  "function decimals() pure returns (uint8)",
  "function mint(address to, uint256 amount)",
  "function name() view returns (string)",
  "function nonces(address owner) view returns (uint256 result)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256 result)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function vault() view returns (address)",
  "event Approval(address indexed owner, address indexed spender, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 amount)",
  "error AllowanceOverflow()",
  "error AllowanceUnderflow()",
  "error InsufficientAllowance()",
  "error InsufficientBalance()",
  "error InvalidPermit()",
  "error OnlyVault()",
  "error Permit2AllowanceIsFixedAtInfinity()",
  "error PermitExpired()",
  "error TotalSupplyOverflow()",
] as const;

// ─── statuses ───
/** FeeVault.status() uint8 → name. */
export const VAULT_STATUS = ["Created", "Pledged", "Auction", "Active", "Released", "Cancelled"] as const;
export type VaultStatus = (typeof VAULT_STATUS)[number];

/** Off-chain loan status (agent db). DECLINED loans never touch the chain. */
export type LoanStatus = "DECLINED" | "APPROVED" | "PLEDGED" | "AUCTION" | "ACTIVE" | "RELEASED" | "CANCELLED";

export type LoanEventKind =
  | "applied" | "memo" | "declined" | "loan_created" | "pledged" | "auction_started" | "bid"
  | "disbursed" | "collected" | "swapped" | "flash_twap" | "token_leg_sent" | "repaid" | "draw"
  | "desk_paid" | "released" | "cancelled" | "error" | "erc8004_registered" | "erc8004_feedback" | "erc8004_metadata"
  | "risk_check" | "dine_payment";

/** Third-party token risk verdict the desk BUYS over x402 (Bankr x402 Cloud honeypot-check, paid by the Dynamic agent wallet
 *  in real USDC on Base mainnet, even in DEMO_FORK). verdict null = not purchased; `note` says why. Never synthesized. */
export type RiskVerdict = "SAFE" | "SUSPICIOUS" | "HONEYPOT";
export type RiskPayment = {
  service: string; amountRaw: string; amountUsd: number; asset: Address; network: "eip155:8453"; payTo: Address;
  payer: Address; txHash: Hex | null; settlement: unknown;
};
export type RiskCheck = { token: Address; verdict: RiskVerdict | null; note: string; raw: unknown; paid: RiskPayment | null; checkedAt: string; cached: boolean };

// ─── DTOs ───
export type ApiError = { error: string };

export type TxRequest = { to: Address; data: Hex; value?: string; chainId: number; label?: string };
/** POST /api/loans (approved) also returns claimFirst: an optional FeesManager.collectFees tx to sign BEFORE pledgeTx
 *  (accrued fees go to the borrower instead of the vault). null when nothing is accrued or the builder failed. */
export type ClaimFirst = { tx: TxRequest; claimableWethRaw: string; claimableTokenRaw: string; note: string };
export type ApplyResponse = LoanDetail & { claimFirst?: ClaimFirst | null };

export type Persona = {
  id: string; // "prudent" | "momentum" | ...
  name: string;
  model: string; // Bankr LLM Gateway model id
  advanceRatePct: number;
  style: string; // one line shown on leaderboard
  wallet?: Address; // Dynamic agent wallet that signs for this persona (lead persona = desk wallet)
};

export type FeeInputs = {
  token: Address;
  symbol: string;
  name: string;
  poolId: Hex;
  feesManager: Address; // feesContract ?? initializer
  sharePct: number; // API `share` field, e.g. 57
  numeraire: Address;
  tokenIsToken0: boolean;
  claimableWethRaw: string; // borrower's current claimable (goes to the vault if not claimed first)
  claimableTokenRaw: string;
  weth30d: number;
  wethLifetime: number;
  wethOwn?: number; // this beneficiary's own claimed + claimable WETH (Bankr totals); invariant to when they claim
  lifetimeDays: number;
  dailyWeth: { date: string; weth: number }[];
  ethUsd: number; // from Uniswap Trading API quote 1 WETH → USDC
};

export type Terms = {
  principalRaw: string; // USDC the borrower receives at minimum (CCA requiredCurrencyRaised)
  faceValueRaw: string; // FeeNote supply = total note debt
  feeRatePct: number;
  floorPrice: number; // USDC per note = principal / face
  floorPriceQ96: string;
  tickSpacingQ96: string;
  termDays: number; // expected repayment horizon at current run-rate
  drawLimitRaw: string; // Flynet dining credit line, USDC
  advanceRatePct: number;
  maxPrincipalRaw: string; // deterministic engine cap; LLM may only go lower
};

export type Quote = {
  eligible: boolean;
  reasons: string[]; // hard-reject reasons when !eligible
  inputs: FeeInputs | null;
  terms: Terms | null;
  formula: string; // human-readable formula with the numbers plugged in
};

export type Memo = {
  personaId: string;
  model: string;
  decision: "approve" | "decline";
  principalRaw: string; // ≤ terms.maxPrincipalRaw
  maxNotePrice: number; // USDC per note this persona would bid
  confidence: number; // 0..1
  rationale: string;
  risks: string[];
};

export type Signal = {
  id: number;
  loanId: number;
  personaId: string;
  token: Address;
  symbol: string;
  decision: "approve" | "decline";
  score: number; // 0..100
  principalRaw: string;
  maxNotePrice: number;
  rationale: string;
  createdAt: string;
  /** Were followers' mirror buys queued for this signal? mirrorNote says why not (e.g. rules memo, no LLM review). */
  mirrorable: boolean;
  mirrorNote: string | null;
};

export type DebtState = {
  noteSupplyRaw: string;
  usdcInVaultRaw: string;
  drawDebtRaw: string;
  outstandingRaw: string;
  wethInVaultRaw: string;
  tokenInVaultRaw: string;
  canRelease: boolean;
};

export type Loan = {
  id: number;
  status: LoanStatus;
  via: "web" | "bankr-skill";
  borrower: Address; // current fee beneficiary (Bankr wallet or EOA)
  controller: Address; // address allowed to sign borrower-only actions (dine draws); defaults to borrower
  token: Address;
  symbol: string;
  poolId: Hex;
  feesManager: Address;
  vault: Address | null;
  note: Address | null;
  auction: Address | null;
  terms: Terms | null;
  leadMemo: Memo | null;
  pledgeTx: TxRequest | null; // from Bankr build-transfer-beneficiary (newBeneficiary = vault)
  pledgeChatText: string | null; // documented Bankr chat phrase
  debt: DebtState | null;
  createdAt: string;
  updatedAt: string;
};

export type LoanEvent = { id: number; loanId: number; kind: LoanEventKind; txHash: Hex | null; data: unknown; createdAt: string };
/** DEMO_FORK only: set on every payload carrying a pledge tx (loans, loan detail, pledge-tx); pledgeChatText is then null. */
export type ForkNotice = { fork?: true; warning?: string };
export type LoanDetail = Loan & ForkNotice & { events: LoanEvent[]; signals: Signal[]; memos: Memo[] };

/** POST /api/loans body. The BORROWER (fee beneficiary) signs applyMessage via EIP-191 personal_sign (EOA, 1271 or 6492). */
export type ApplyRequest = {
  token: Address; borrower: Address; controller?: Address; via?: "web" | "bankr-skill"; nonce: string; signature: Hex;
  /** Optional ERC-8004 agentId (decimal string) owned by the borrower or controller. Its Gadai repayment reputation can only
   *  lower the line; on release the desk gives it feedback. */
  erc8004AgentId?: string;
};
/** controller defaults to borrower; pass the SAME value you POST (omitted controller ⇒ sign with controller = borrower). */
export const applyMessage = (token: Address, borrower: Address, controller: Address, nonce: string) =>
  `Gadai: apply for a loan against my creator fees\nToken: ${token.toLowerCase()}\nBorrower: ${borrower.toLowerCase()}\nController: ${controller.toLowerCase()}\nNonce: ${nonce}`;
export type PledgeRequest = { txHash?: Hex };

export type DeskInfo = {
  chainId: number;
  demoFork: boolean;
  /** Human-readable chain label; in DEMO_FORK it says the chain is a fork and real fee rights must not be pledged. */
  chainNote: string;
  desk: Address;
  agentWallet: Address;
  treasury: Address;
  personas: Persona[];
  publicUrl: string;
};

export type BidRow = { bidId: string; owner: Address; maxPrice: number; amountRaw: string; exited: boolean; tokensFilledRaw: string };
export type AuctionState = {
  loanId: number;
  auction: Address;
  startBlock: number;
  endBlock: number;
  claimBlock: number;
  currentBlock: number;
  floorPrice: number;
  tickSpacingQ96: string;
  clearingPrice: number;
  currencyRaisedRaw: string;
  requiredRaw: string;
  graduated: boolean;
  totalSupplyRaw: string;
  bids: BidRow[];
};
export type BidPlanRequest = { bidder: Address; amountRaw: string; maxPrice: number };
export type BidPlan = { maxPriceQ96: string; prevTickPriceQ96: string; txs: TxRequest[] };
export type ExitPlanRequest = { bidId: string };
export type ExitPlan = { txs: TxRequest[] };

export type LeaderboardRow = {
  personaId: string;
  name: string;
  model: string;
  approvals: number;
  declines: number;
  fundedLoans: number;
  repaidPct: number; // Σ repaid / Σ face over loans it approved that were funded (on-chain)
  avgDaysToRepay: number | null;
  followerPnlUsd: number; // realized+marked from Flash fills of mirror orders
  followers: number;
  score: number | null; // ranking key, formula in SPEC §7; null = "no realized data yet" (rank last)
};

export type FollowMode = "bracket" | "dca";
export type Follow = {
  id: number;
  follower: Address;
  personaId: string;
  mode: FollowMode;
  sizeUsdc: number; // per signal
  tpPct: number; // bracket only, e.g. 50 → TP at +50%
  slPct: number; // bracket only, e.g. 20 → SL at −20%
  dcaDays: number; // dca only (Flash TWAP, 1 bucket/day)
  auto: boolean; // true ⇒ Dynamic delegated signing (needs delegation), else one-click
  createdAt: string;
};
export type FollowRequest = Omit<Follow, "id" | "createdAt">;

export type MirrorStatus = "pending_signature" | "submitted" | "filled" | "partially_filled" | "cancelled" | "failed";
export type MirrorOrder = {
  id: number;
  followId: number;
  signalId: number;
  follower: Address;
  token: Address;
  symbol: string;
  mode: FollowMode;
  sizeUsdc: number;
  status: MirrorStatus;
  flashOrderId: string | null;
  bracketStatus: string | null;
  /** Active protective (TP/SL) order id once the entry filled; cancel it via POST /api/mirrors/:id/cancel {leg:"bracket"}. */
  bracketOrderId: string | null;
  filledTokenRaw: string | null;
  avgPriceUsd: number | null;
  pnlUsd: number | null;
  error: string | null;
  createdAt: string;
};
/** Everything the browser must sign for a mirror order. Typed-data fields are Flash's JSON strings verbatim. */
export type MirrorQuote = {
  mirrorId: number;
  quoteId: string;
  approveTxs: TxRequest[];
  permitTypedData: string | null;
  orderTypedData: string;
  bracket: { orderTypedData: string; permitTypedData: string | null; approveTxs: TxRequest[] } | null;
  preview: { spendUsdc: number; estTokenOut: string; priceImpact: number; tpPriceUsd?: number; slPriceUsd?: number };
};
export type MirrorSubmit = {
  /** MirrorQuote.quoteId the signatures were made over (409 → re-quote). */
  quoteId: string;
  userSignature: Hex;
  evmPermitSignature?: Hex;
  bracketUserSignature?: Hex;
  bracketPermitSignature?: Hex;
};

// ─── Flynet dining concierge (read-only Flynet: the app has no write:rewards / payment scopes, so nothing is paid or drawn) ───
/** One Blackbird venue (a Flynet `location`; the brand is its `restaurant`). Trimmed from live `GET /locations`. */
export type DinePlace = {
  id: string; // Flynet location id
  restaurantId: string;
  name: string; // restaurant (brand) name
  branch: string; // location name (often the street address)
  slug: string;
  cuisine: string[];
  cohort: string; // fsr (full service) | qsr (quick service) | bar
  price: number | null; // Flynet price level 1..4
  neighborhood: string | null;
  region: string | null; // e.g. "New York, NY"
  address: string;
  lat: number | null;
  lng: number | null;
  timeZone: string;
  image: string | null;
  website: string | null;
  mapsUrl: string | null; // Google Maps link from Flynet's google_place_id
  reservationUrl: string | null;
  reservationsEnabled: boolean;
  paymentsEnabled: boolean; // Blackbird Pay accepted at the venue (member pays in the Blackbird app)
  isClub: boolean;
};
export type DineHour = { day: string; open: string; close: string };
export type DineSpecial = { label: string; description: string; emoji: string; flyRewardBips: number | null; checkInThreshold: number | null };
export type DineChallenge = { title: string; description: string; flyReward: string | null; endTime: string | null };
/** Where a Flynet list came from: live now, or the agent's cache (and how old). */
export type DineSource = { fetchedAt: string; stale: boolean };
export type DinePlaceList = { places: DinePlace[]; total: number; page: number; pageSize: number; regions: string[]; cuisines: string[]; source: DineSource };
export type DinePlaceDetail = { place: DinePlace; hours: DineHour[] | null; openNow: boolean | null; specials: DineSpecial[]; challenges: DineChallenge[]; siblings: DinePlace[]; source: DineSource; errors: string[] };

/** Whether this Flynet app may move FLY. `state` comes from the app's own `allowed_scopes` (GET /flynet/v1/app), never a guess:
 *  no payment scope = Blackbird has not approved payments for the app yet, so /payment_intents answers 403. */
export type DinePayments = { state: "enabled" | "pending-review" | "unknown"; enabled: boolean; maxFly: number; reason: string };
/** A Flynet FLY payment intent the agent created for a loan, mirrored in the agent db. */
export type DinePayment = {
  intentId: string;
  loanId: number;
  status: string; // Flynet PaymentIntent.status: pending | paid | canceled | refunded | expired
  amountWei: string; // Money.value — FLY base units, 18 decimals
  memberId: string; // customer_user_id (the member's `sub`)
  restaurantId: string | null;
  description: string;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
};
/** App-merchant FLY balance (GET /flynet/v1/balance, read:balance). null = the read failed; the reason is in `notes`. */
export type DineFlyBalance = { flyWei: string; usdCents: number } | null;
/** Result of POST /api/loans/:id/dine/pay (and the refund/cancel routes): the real intent plus the merchant balance either side. */
export type DinePayResult = {
  payment: DinePayment;
  intent: unknown; // Flynet's PaymentIntent, verbatim
  balanceBefore: DineFlyBalance;
  balanceAfter: DineFlyBalance;
  notes: string[];
};
export type DineMemberLogin = { available: boolean; reason: string | null };
export type FlynetStatus = { env: string; appName: string | null; allowedScopes: string[]; catalog: { count: number; fetchedAt: string | null }; memberLogin: DineMemberLogin; payments: DinePayments };
/** GET /api/loans/:id/dine */
export type DineState = {
  loanId: number;
  symbol: string;
  loanStatus: LoanStatus;
  budgetRaw: string; // the loan's drawLimit (USDC raw): a planning budget, nothing is disbursed
  linked: boolean; // a Blackbird member is linked to this loan (OAuth)
  memberLogin: DineMemberLogin;
  payments: DinePayments;
  saveToList: DineMemberLogin; // write:save_to_list is granted, but Blackbird has not published the endpoint yet
};
/** A member's Blackbird membership card at one restaurant (GET /users/me/memberships, read:memberships). */
export type DineMembership = { restaurantId: string; tier: string; checkIns: number; lastCheckIn: string | null; art: string | null };
/** GET /api/flynet/trending: venues busiest on the Blackbird network (anonymized GET /check_ins, read:checkins). */
export type DineTrending = {
  places: { place: DinePlace; weekCheckIns: number | null; recentCheckIns: number }[];
  sample: { size: number; from: string | null; to: string | null }; // the latest network check-ins the list was picked from
  source: DineSource;
  errors: string[];
};
/** POST /api/loans/:id/dine/plan */
export type DinePlanRequest = { request: string; partySize: number; time?: string; near?: { lat: number; lng: number } };
export type DinePick = {
  place: DinePlace;
  reasons: string[];
  openAtTime: boolean | null; // null = Flynet publishes no hours for this venue
  hoursToday: string | null; // "17:00–23:00"
  estCostUsd: number | null; // party × per-head estimate from the price level (Flynet has no menu prices)
  fitsBudget: boolean | null;
  distanceKm: number | null;
  specials: DineSpecial[];
  challenges: DineChallenge[];
  visits: number | null; // the linked member's check-ins here (only with the member session)
  membership: DineMembership | null; // the member's card at this brand (member session + read:memberships)
  weekCheckIns: number | null; // network check-ins at this venue in the last 7 days (null = Flynet read failed)
};
export type DinePlan = {
  loanId: number;
  request: string;
  partySize: number;
  at: string; // what "time" was resolved to
  budgetRaw: string;
  understood: string[]; // the cues the concierge read from the request
  ranker: "bankr-llm" | "deterministic";
  rankerNote: string;
  considered: number;
  picks: DinePick[];
  notes: string[];
  personalized: boolean;
  source: DineSource;
};
/** GET /api/loans/:id/dine/passport (member session token). */
export type DinePassport = {
  firstName: string;
  tier: string | null;
  flyBalanceWei: string;
  flyBalanceUsdCents: number;
  wallets: { type: string; address: string }[];
  checkIns: { placeId: string; name: string; neighborhood: string | null; region: string | null; at: string }[];
  placesVisited: number;
  gapsNearby: DinePlace[]; // Blackbird venues in the member's neighborhoods they have not checked in at
  memberships: (DineMembership & { name: string })[] | null; // null = token lacks read:memberships or the read failed (see notes)
  tags: { type: string; metadata: { key: string; value: string[] }[] }[] | null; // null = token lacks read:tags or the read failed
  scopes: string[] | null; // scopes on the member's access token (JWT `scope` claim)
  notes: string[];
};
export const flynetLinkMessage = (loanId: number, nonce: string) =>
  `Gadai: link my Blackbird account to loan ${loanId}\nNonce: ${nonce}`;
/** Borrower personal_signs this to consent to one draw; FeeVault.addDraw re-derives it on-chain (FeeVault.drawMessage).
 *  Unused by the agent since dining draws are disabled (no Flynet payout scope); kept byte-identical to the Solidity string. */
export const drawMessage = (vault: Address, chainId: number, usdcRaw: bigint | string, nonce: bigint | string, deadline: bigint | string) =>
  `Gadai dining draw\nVault: ${vault.toLowerCase()}\nChain: ${chainId}\nAmount (USDC raw): ${usdcRaw}\nNonce: ${nonce}\nDeadline: ${deadline}`;

/** Documented Bankr chat phrase for pledging (docs.bankr.bot fee-splitting.md). */
export const pledgeChatText = (token: Address, vault: Address) =>
  `transfer my beneficiary share on token ${token} to ${vault}`;

// ─── Follow the Desk auth (agent-social-flash; see COORDINATION) ───
/** Follower signs this EIP-191 message; POST /api/follows body = FollowRequest & {nonce, signature}. */
export const followMessage = (f: FollowRequest, nonce: string) =>
  `Gadai: follow persona ${f.personaId}\nFollower: ${f.follower.toLowerCase()}\nMode: ${f.mode}\nSize (USDC): ${f.sizeUsdc}\nTP %: ${f.tpPct}\nSL %: ${f.slPct}\nDCA days: ${f.dcaDays}\nAuto: ${f.auto ? "yes" : "no"}\nNonce: ${nonce}`;
/** DELETE /api/follows/:id body = {nonce, signature} over this message, signed by the follower. */
export const unfollowMessage = (followId: number, nonce: string) => `Gadai: unfollow ${followId}\nNonce: ${nonce}`;
export type FollowSigned = FollowRequest & { nonce: string; signature: Hex };

/** Flash sends EIP-712 JSON with string numbers; viem/wallets need numeric chainId + bigint uints. Use before signTypedData/hashTypedData. */
export function flashTypedData(json: string): { domain: Record<string, any>; types: Record<string, { name: string; type: string }[]>; primaryType: string; message: Record<string, any> } {
  const t = JSON.parse(json);
  const conv = (typeName: string, v: Record<string, any>): Record<string, any> =>
    Object.fromEntries((t.types[typeName] as { name: string; type: string }[]).map(({ name, type }) => [
      name, /^u?int\d*$/.test(type) ? BigInt(v[name]) : t.types[type] ? conv(type, v[name]) : v[name],
    ]));
  const domain = { ...t.domain, ...(t.domain.chainId !== undefined ? { chainId: Number(t.domain.chainId) } : {}) };
  return { domain, types: t.types, primaryType: t.primaryType, message: conv(t.primaryType, t.message) };
}
