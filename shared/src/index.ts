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
  UNI_SWAP_PROXY: "0x0000000085E102724e78eCd2F45DC9cA239Affad", // Trading API x-permit2-disabled flow
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
  "function createLoan((address borrower, bytes32 poolId, address feesManager, address creatorToken, uint256 principal, uint256 faceValue, uint256 drawLimit, string noteName, string noteSymbol) p) returns (uint256 loanId, address vault, address note)",
  "function isVault(address) view returns (bool)",
  "function keeper() view returns (address)",
  "function loanCount() view returns (uint256)",
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
  "function MAX_ORACLE_AGE() view returns (uint256)",
  "function MAX_START_DELAY_BLOCKS() view returns (uint64)",
  "function MIN_OUT_BPS_OF_ORACLE() view returns (uint256)",
  "function PLEDGE_TIMEOUT() view returns (uint256)",
  "function UNI_SWAP_PROXY() view returns (address)",
  "function USDC() view returns (address)",
  "function WETH() view returns (address)",
  "function addDraw(uint256 usdcAmount)",
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
  "function drawn() view returns (uint256)",
  "function faceValue() view returns (uint256)",
  "function feesManager() view returns (address)",
  "function flashDomainSeparator() view returns (bytes32)",
  "function flashOrderDigest((address swapper, address vault, address recipient, address fromToken, address toToken, uint256 fromAmount, uint256 salt, uint256 deadline) o) view returns (bytes32)",
  "function isValidSignature(bytes32 hash, bytes) view returns (bytes4)",
  "function loanId() view returns (uint256)",
  "function note() view returns (address)",
  "function noteSupply() view returns (uint256)",
  "function oracleMinUsdcOut(uint256 wethIn) view returns (uint256)",
  "function payDesk() returns (uint256)",
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
  "event Pledged(address indexed borrower, uint256 shares)",
  "event Redeemed(address indexed holder, uint256 notes)",
  "event Released(address indexed borrower)",
  "event Swapped(uint256 wethIn, uint256 usdcOut)",
  "event TokenLegSent(address indexed keeper, address token, uint256 amount)",
  "error AuctionNotOver()",
  "error BadAuctionParams()",
  "error BadFlashOrder()",
  "error BadOracle()",
  "error BadStatus(uint8 status)",
  "error BadToken(address token)",
  "error CannotRelease()",
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
  | "desk_paid" | "released" | "cancelled" | "error";

// ─── DTOs ───
export type ApiError = { error: string };

export type TxRequest = { to: Address; data: Hex; value?: string; chainId: number; label?: string };

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
export type LoanDetail = Loan & { events: LoanEvent[]; signals: Signal[]; memos: Memo[] };

/** POST /api/loans body. The BORROWER (fee beneficiary) signs applyMessage via EIP-191 personal_sign (EOA, 1271 or 6492). */
export type ApplyRequest = { token: Address; borrower: Address; controller?: Address; via?: "web" | "bankr-skill"; nonce: string; signature: Hex };
/** controller defaults to borrower; pass the SAME value you POST (omitted controller ⇒ sign with controller = borrower). */
export const applyMessage = (token: Address, borrower: Address, controller: Address, nonce: string) =>
  `Gadai: apply for a loan against my creator fees\nToken: ${token.toLowerCase()}\nBorrower: ${borrower.toLowerCase()}\nController: ${controller.toLowerCase()}\nNonce: ${nonce}`;
export type PledgeRequest = { txHash?: Hex };

export type DeskInfo = {
  chainId: number;
  demoFork: boolean;
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

// ─── Flynet dine-on-credit ───
export type Recommendation = {
  locationId: string;
  restaurantId: string;
  name: string;
  address: string;
  reservationUrl: string | null;
  openNow: boolean | null;
  specials: string[];
  reason: string; // Bankr LLM one-liner
};
export type DineMember = { name: string | null; flyBalanceWei: string; flyBalanceUsdCents: number; spendingWallet: Address | null };
export type Draw = {
  id: number;
  loanId: number;
  amountRaw: string; // USDC debt added on-chain via FeeVault.addDraw
  flyWei: string; // FLY issued via Flynet issue_reward
  locationId: string | null;
  flynetRewardId: string | null;
  txHash: Hex | null;
  status: "pending" | "recorded" | "issued" | "failed"; // pending: addDraw sent; recorded: debt on-chain, FLY not yet issued
  error: string | null;
  createdAt: string;
};
export type DineState = {
  loanId: number;
  linked: boolean;
  member: DineMember | null;
  drawLimitRaw: string;
  drawnRaw: string;
  draws: Draw[];
};
/** Borrower (or controller) signs this EIP-191 message to authorize a draw. */
export const drawMessage = (loanId: number, amountUsdCents: number, nonce: string) =>
  `Gadai dining draw\nLoan: ${loanId}\nAmount (USD cents): ${amountUsdCents}\nNonce: ${nonce}`;
export const flynetLinkMessage = (loanId: number, nonce: string) =>
  `Gadai: link my Blackbird account to loan ${loanId}\nNonce: ${nonce}`;
export type DrawRequest = { amountUsdCents: number; locationId?: string; nonce: string; signature: Hex };

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
