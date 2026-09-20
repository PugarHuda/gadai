// Builds deck/Gadai.pptx — the Gadai judge/sponsor deck.
// Visual world mirrors web/DESIGN.md: grey desk ground, white form sheets,
// hairline rules, one violet stamp ink. Run: npm i pptxgenjs && node build.mjs
import pptxgen from "pptxgenjs";

const OUT = process.argv[2] || "Gadai.pptx";

// --- tokens (web/app/globals.css) ---------------------------------------
const GROUND = "E5E8E3";
const SHEET = "FCFCFA";
const INK = "16181D";
const MUTE = "545A64";
const RULE = "C4C9CF";
const VIOLET = "5A2BB3";
const GREEN = "16683B";
const AMBER_INK = "7A4B00";
const RED = "B42318";

const SANS = "Arial"; // stands in for Archivo (not installable in PowerPoint)
const MONO = "Courier New"; // stands in for Chivo Mono

const W = 13.333, H = 7.5;
const M = 0.62; // slide margin
const CW = W - M * 2; // content width
const Y0 = 1.5; // where content starts on a titled slide

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "Gadai";
pres.title = "Gadai — credit for Bankr agents against creator-fee rights";

const sheetShadow = () => ({ type: "outer", color: "16181D", blur: 10, offset: 1, angle: 90, opacity: 0.16 });

function newSlide(notes) {
  const s = pres.addSlide();
  s.background = { color: GROUND };
  if (notes) s.addNotes(notes);
  return s;
}

/** A white form sheet: the only element that carries depth. */
function sheet(s, x, y, w, h, opts = {}) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h,
    fill: { color: opts.fill || SHEET },
    line: { color: opts.line || RULE, width: 0.75 },
    shadow: opts.flat ? undefined : sheetShadow(),
  });
}

/** A flat hairline box inside a sheet. */
function box(s, x, y, w, h, fill) {
  s.addShape(pres.ShapeType.rect, { x, y, w, h, fill: { color: fill || SHEET }, line: { color: RULE, width: 0.75 } });
}

/** Small uppercase field caption. */
function label(s, x, y, w, text, color = MUTE) {
  s.addText(text, {
    x, y, w, h: 0.2, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 8.5, bold: true, color, charSpacing: 1.1, valign: "top",
  });
}

function body(s, x, y, w, h, runs, opts = {}) {
  s.addText(runs, {
    x, y, w, h, isTextBox: true, margin: 0, valign: opts.valign || "top",
    fontFace: SANS, fontSize: opts.fontSize || 11.5, color: opts.color || INK,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1.18, align: opts.align || "left",
    paraSpaceAfter: opts.paraSpaceAfter,
  });
}

function mono(s, x, y, w, h, text, opts = {}) {
  s.addText(text, {
    x, y, w, h, isTextBox: true, margin: 0, valign: opts.valign || "top",
    fontFace: MONO, fontSize: opts.fontSize || 9.5, color: opts.color || INK,
    lineSpacingMultiple: opts.lineSpacingMultiple || 1.25, align: opts.align || "left", bold: opts.bold,
  });
}

/** Page head: kicker caption + title. */
function head(s, kicker, title, titleSize = 27) {
  label(s, M, 0.44, CW, kicker);
  s.addText(title, {
    x: M, y: 0.68, w: CW, h: 0.62, isTextBox: true, margin: 0, valign: "top",
    fontFace: SANS, fontSize: titleSize, bold: true, color: INK, charSpacing: -0.3,
  });
  return Y0;
}

/** Source line + slide number, bottom of a content slide. */
function foot(s, source, n) {
  s.addText(source, {
    x: M, y: H - 0.55, w: CW - 1.0, h: 0.3, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 8.5, color: MUTE, valign: "top",
  });
  s.addText(String(n).padStart(2, "0"), {
    x: W - M - 0.6, y: H - 0.55, w: 0.6, h: 0.3, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9, color: MUTE, align: "right", valign: "top",
  });
}

/** The filing stamp: double-ruled violet box, rotated -2°. */
function stamp(s, x, y, w, text, color = VIOLET) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h: 0.42, fill: { color: SHEET }, line: { color, width: 2 }, rotate: -2,
  });
  s.addText(text, {
    x, y, w, h: 0.42, isTextBox: true, margin: 0, rotate: -2,
    fontFace: SANS, fontSize: 12, bold: true, color, align: "center", valign: "middle", charSpacing: 1.8,
  });
}

/** Big number + caption inside a hairline box. */
function stat(s, x, y, w, h, value, cap, sub, valueColor = INK, valueSize = 30) {
  box(s, x, y, w, h);
  const pad = 0.2;
  label(s, x + pad, y + pad, w - pad * 2, cap);
  s.addText(value, {
    x: x + pad, y: y + pad + 0.28, w: w - pad * 2, h: 0.72, isTextBox: true, margin: 0, valign: "top",
    fontFace: SANS, fontSize: valueSize, bold: true, color: valueColor, charSpacing: -0.5,
  });
  // the description sits on the floor of the box, like a form's note line
  if (sub) body(s, x + pad, y + h - pad - 0.78, w - pad * 2, 0.78, sub, { fontSize: 10.5, color: MUTE, lineSpacingMultiple: 1.15 });
}

function arrow(s, x, y, w) {
  s.addShape(pres.ShapeType.line, { x, y, w, h: 0, line: { color: MUTE, width: 1, endArrowType: "triangle" } });
}

function numberDot(s, x, y, n, color = VIOLET) {
  s.addShape(pres.ShapeType.ellipse, { x, y, w: 0.3, h: 0.3, fill: { color }, line: { color, width: 0 } });
  s.addText(String(n), {
    x, y, w: 0.3, h: 0.3, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 10, bold: true, color: SHEET, align: "center", valign: "middle",
  });
}

// =======================================================================
// 01 — Title
// =======================================================================
{
  const s = newSlide("Gadai lends USDC to Bankr agents against their token's creator-fee stream, and holds that stream as an on-chain lien the desk cannot keep. Built for Runtime Agent Week, on Base.");
  sheet(s, M, 0.9, CW, 5.05);
  label(s, M + 0.5, 1.3, 8, "RUNTIME AGENT WEEK  ·  BANKR × PROPAGANDA  ·  BASE 8453");
  s.addText("Gadai", {
    x: M + 0.5, y: 1.58, w: 8.2, h: 1.25, isTextBox: true, margin: 0, valign: "top",
    fontFace: SANS, fontSize: 68, bold: true, color: INK, charSpacing: -1.6,
  });
  body(s, M + 0.5, 2.88, 7.6, 1.1,
    "USDC credit for Bankr agents and creators, secured by a lien on their token's creator-fee rights.",
    { fontSize: 17, lineSpacingMultiple: 1.2 });
  body(s, M + 0.5, 3.98, 7.6, 0.8,
    "Pledge the Doppler fee share to a per-loan vault. Sell the loan as a FeeNote in a Uniswap auction. The fees repay it. Anyone can hand the rights back.",
    { fontSize: 11.5, color: MUTE });
  s.addShape(pres.ShapeType.line, { x: M + 0.5, y: 4.88, w: 7.6, h: 0, line: { color: RULE, width: 0.75 } });
  label(s, M + 0.5, 5.04, 7.6, "TRACKS");
  mono(s, M + 0.5, 5.26, 7.6, 0.3, "Bankr · Dynamic · Uniswap · Definitive Flash · Blackbird · Grok Bot", { fontSize: 10.5 });

  box(s, 9.55, 1.3, 3.0, 4.25);
  label(s, 9.73, 1.5, 2.7, "FILING");
  stamp(s, 9.78, 1.82, 2.5, "LIEN FILED");
  const facts = [
    ["Instrument", "FeeNote ERC-20"],
    ["Collateral", "Doppler fee share"],
    ["Registry", "FeeVault, Base"],
    ["Release", "permissionless"],
  ];
  facts.forEach(([k, v], i) => {
    const y = 2.55 + i * 0.7;
    label(s, 9.73, y, 2.7, k.toUpperCase());
    mono(s, 9.73, y + 0.2, 2.7, 0.26, v, { fontSize: 10 });
    if (i < facts.length - 1) s.addShape(pres.ShapeType.line, { x: 9.73, y: y + 0.55, w: 2.64, h: 0, line: { color: RULE, width: 0.75 } });
  });

  body(s, M, 6.25, CW, 0.5,
    "gadai-six.vercel.app   ·   /demo (3:49, narrated)   ·   /evidence   ·   /board   ·   github.com/PugarHuda/gadai",
    { fontSize: 11, color: MUTE });
}

// =======================================================================
// 02 — The problem, with live numbers
// =======================================================================
{
  const s = newSlide("Bankr agents earn creator fees on every trade of their token, but the fees arrive later while LLM and API bills are due now. Today the only options are to top up by hand, sell the token, or stop working.");
  const y0 = head(s, "THE PROBLEM", "The fees arrive later. The compute bill is due now.");
  sheet(s, M, y0, CW, 4.75);
  const iw = (CW - 0.6) / 4;
  const sy = y0 + 0.35;
  stat(s, M + 0.3, sy, iw - 0.06, 2.95, "105", "BANKR AGENTS ON BASE", "every profile with a Base token, priced by the same engine");
  stat(s, M + 0.3 + iw, sy, iw - 0.06, 2.95, "593 WETH", "LIFETIME CREATOR FEES", "beneficiary share across those agents");
  stat(s, M + 0.3 + iw * 2, sy, iw - 0.06, 2.95, "9.68 WETH", "CLAIMABLE, IDLE", "already earned, unclaimed, doing nothing", AMBER_INK);
  stat(s, M + 0.3 + iw * 3, sy, iw - 0.06, 2.95, "18.6B", "LLM TOKENS / 30 DAYS", "what those same agents burn on compute");
  body(s, M + 0.3, sy + 3.25, CW - 0.6, 0.8,
    "An agent that runs out of credits can top up by hand, sell its own token, or stop working. Nothing let it borrow against fees it has already earned.",
    { fontSize: 14 });
  foot(s, "Bankr /api/board — 105 agents, 593 WETH, 18.6B tokens: snapshot 2026-09-19 15:44 UTC (README). Claimable read live 2026-09-20.", 2);
}

// =======================================================================
// 03 — What Gadai is: the lien
// =======================================================================
{
  const s = newSlide("The collateral is itself an on-chain right. Only a contract can hold a fee share so the desk cannot keep it and the borrower does not have to trust the desk to get it back.");
  const y0 = head(s, "WHAT GADAI IS", "A lien the desk cannot keep");

  sheet(s, M, y0, 7.1, 4.75);
  body(s, M + 0.35, y0 + 0.38, 6.4, 0.7,
    "A Bankr token launched through Doppler pays its creator a share of every trade. Gadai turns that share into collateral.",
    { fontSize: 13 });
  const rows = [
    ["The borrower points its fee share at a per-loan FeeVault.", "updateBeneficiary(poolId, vault)"],
    ["Only two functions can move it back, and both return it to the borrower.", "release()  ·  cancel()"],
    ["release() is permissionless — anyone can call it once the notes are covered.", "no desk signature needed"],
  ];
  rows.forEach(([t, code], i) => {
    const y = y0 + 1.35 + i * 1.12;
    numberDot(s, M + 0.35, y + 0.02, i + 1);
    body(s, M + 0.82, y, 5.9, 0.34, t, { fontSize: 11.5 });
    mono(s, M + 0.82, y + 0.36, 5.9, 0.26, code, { fontSize: 9.5, color: VIOLET });
  });

  sheet(s, M + 7.4, y0, CW - 7.4, 4.75);
  label(s, M + 7.75, y0 + 0.35, 4.0, "ON THE REGISTRY");
  stamp(s, M + 7.75, y0 + 0.68, 2.3, "ENFORCED");
  const facts = [
    ["FeeDesk, Base mainnet", "0xa4f21ace…80476b4f"],
    ["Per-loan vault", "FeeVault.sol"],
    ["Lien returned by", "_returnLien → borrower"],
    ["Desk may never", "keep or redirect fees"],
  ];
  facts.forEach(([k, v], i) => {
    const y = y0 + 1.62 + i * 0.78;
    label(s, M + 7.75, y, 4.0, k.toUpperCase());
    mono(s, M + 7.75, y + 0.21, 4.0, 0.26, v, { fontSize: 9.5 });
  });
  foot(s, "contracts/src/FeeVault.sol — confirmPledge L248, release L445, _returnLien L483. Deploy tx in docs/EVIDENCE.md #2.", 3);
}

// =======================================================================
// 04 — How a loan moves
// =======================================================================
{
  const s = newSlide("Five steps: pledge, auction, disburse, service, release. The same five-step track runs across every loan page on the site.");
  const y0 = head(s, "THE LIFECYCLE", "How a loan moves");
  const steps = [
    ["PLEDGE", "Fee share moves to the vault", "Bankr build-transfer-beneficiary", "Borrower"],
    ["AUCTION", "FeeNote ERC-20 sold for USDC", "Uniswap CCA v2.1.0", "Lenders"],
    ["DISBURSE", "USDC sent to the borrower", "disburse() after the lead memo", "Dynamic agent wallet"],
    ["SERVICE", "Fees collected and sold", "Uniswap Trading API · Flash TWAP", "Keeper"],
    ["RELEASE", "Fee rights handed back", "release(), callable by anyone", "Anyone"],
  ];
  const bw = 2.21, gap = 0.26;
  steps.forEach(([name, what, how, who], i) => {
    const x = M + i * (bw + gap);
    sheet(s, x, y0 + 0.1, bw, 3.7);
    numberDot(s, x + 0.2, y0 + 0.32, i + 1);
    s.addText(name, {
      x: x + 0.58, y: y0 + 0.34, w: bw - 0.75, h: 0.28, isTextBox: true, margin: 0,
      fontFace: SANS, fontSize: 12.5, bold: true, color: INK, charSpacing: 0.6, valign: "middle",
    });
    s.addShape(pres.ShapeType.line, { x: x + 0.2, y: y0 + 0.82, w: bw - 0.4, h: 0, line: { color: RULE, width: 0.75 } });
    body(s, x + 0.2, y0 + 1.0, bw - 0.4, 0.9, what, { fontSize: 12 });
    mono(s, x + 0.2, y0 + 2.15, bw - 0.4, 0.7, how, { fontSize: 8.5, color: MUTE });
    label(s, x + 0.2, y0 + 3.28, bw - 0.4, who.toUpperCase(), VIOLET);
    if (i < 4) arrow(s, x + bw + 0.045, y0 + 1.95, gap - 0.09);
  });
  box(s, M, y0 + 3.95, CW, 1.05);
  label(s, M + 0.3, y0 + 4.2, 5.0, "LOAN #1, GITLAWB — RAN END TO END", GREEN);
  body(s, M + 0.3, y0 + 4.48, CW - 0.6, 0.4,
    "237.38 USDC approved → 239.75 USDC disbursed → 0.166 WETH collected → swapped to 289.71 USDC → repaid → release() → ERC-8004 feedback.",
    { fontSize: 11.5 });
  foot(s, "Loan #1 ran on an Anvil fork of Base against the real GITLAWB pool: gadai-six.vercel.app/loans/1. Every step has a tx in the timeline.", 4);
}

// =======================================================================
// 05 — Underwriting
// =======================================================================
{
  const s = newSlide("A deterministic engine sets the cap. Three underwriter personas write memos and the lead is binding, but a model can only decline or lower — never raise. Before approving, the agent buys a honeypot verdict over x402.");
  const y0 = head(s, "UNDERWRITING", "The math decides. Models may only lower it.");

  sheet(s, M, y0, 6.3, 4.75);
  label(s, M + 0.3, y0 + 0.32, 5.7, "DETERMINISTIC ENGINE");
  box(s, M + 0.3, y0 + 0.62, 5.7, 2.05, "F4F5F2");
  mono(s, M + 0.5, y0 + 0.85, 5.3, 1.7,
    "rate  = min(r7, r30, rOwn) · slope haircut\nusd/d = rate × ethUsd × beneficiary share\nprinc = min(usd/d × term, DESK_MAX = $250)\nfloor = tick-aligned note price",
    { fontSize: 10, lineSpacingMultiple: 1.45 });
  body(s, M + 0.3, y0 + 2.95, 5.7, 1.3,
    "rOwn is (claimed + claimable) ÷ history age, so a borrower cannot inflate its rate by choosing when to click claim. A memo that breaks the cap is a parse failure: 502, and no loan is created.",
    { fontSize: 12 });
  s.addShape(pres.ShapeType.line, { x: M + 0.3, y: y0 + 4.18, w: 5.7, h: 0, line: { color: RULE, width: 0.75 } });
  mono(s, M + 0.3, y0 + 4.32, 5.7, 0.3, "every quote publishes the formula it was priced with", { fontSize: 8.5, color: MUTE });

  const rx = M + 6.6;
  const rw = CW - 6.6;
  sheet(s, rx, y0, rw, 2.25);
  label(s, rx + 0.3, y0 + 0.3, rw - 0.6, "THREE UNDERWRITER PERSONAS");
  const personas = [["LEAD", "binding", VIOLET], ["SECOND", "advisory", MUTE], ["THIRD", "advisory", MUTE]];
  personas.forEach(([n, role, c], i) => {
    const x = rx + 0.3 + i * ((rw - 0.6) / 3);
    const w = (rw - 0.6) / 3 - 0.14;
    box(s, x, y0 + 0.62, w, 0.85);
    s.addText(n, { x: x + 0.14, y: y0 + 0.74, w: w - 0.28, h: 0.26, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 11.5, bold: true, color: c });
    mono(s, x + 0.14, y0 + 1.04, w - 0.28, 0.24, role, { fontSize: 8.5, color: MUTE });
  });
  body(s, rx + 0.3, y0 + 1.62, rw - 0.6, 0.5,
    "Each on its own Bankr LLM Gateway model. An LLM can decline or lower — never raise.",
    { fontSize: 10.5, color: MUTE });

  sheet(s, rx, y0 + 2.45, rw, 2.3);
  label(s, rx + 0.3, y0 + 2.75, rw - 0.6, "PAID RISK CHECK, BEFORE APPROVAL");
  mono(s, rx + 0.3, y0 + 3.06, rw - 0.6, 0.3, "$0.05 USDC over x402 · EIP-3009 · Base mainnet", { fontSize: 9.5, color: VIOLET });
  const verdicts = [["HONEYPOT", "declines the loan", RED], ["SUSPICIOUS", "halves the principal", AMBER_INK], ["SAFE", "changes nothing", GREEN]];
  verdicts.forEach(([v, eff, c], i) => {
    const y = y0 + 3.5 + i * 0.4;
    s.addText(v, { x: rx + 0.3, y, w: 1.4, h: 0.28, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 10, bold: true, color: c, charSpacing: 0.6 });
    body(s, rx + 1.8, y, rw - 2.1, 0.28, eff, { fontSize: 11 });
  });
  foot(s, "agent/src/underwriter/engine.ts · agent/src/risk/index.ts. Repaid loans write ERC-8004 reputation from desk agent #94699 on Base. Bankr LLM credits are $0, so memos run the deterministic persona rules and say so.", 5);
}

// =======================================================================
// 06 — FeeNote + Uniswap CCA
// =======================================================================
{
  const s = newSlide("The loan itself becomes a new on-chain asset: a FeeNote ERC-20 whose face value is the debt, sold for USDC in a Uniswap Continuous Clearing Auction. The desk's agent wallet places the anchor bid at its lead persona's price.");
  const y0 = head(s, "UNISWAP — NEW ASSET, NEW AGENTS", "The loan becomes something you can buy");

  const bw = 2.72, gap = 0.4;
  const flow = [
    ["FEEVAULT", "mints the note", "face value = debt"],
    ["FEENOTE", "ERC-20, one loan", "a claim on repayment"],
    ["CCA v2.1.0", "sold for USDC", "requiredCurrencyRaised = principal"],
    ["BORROWER", "USDC on graduation", "disburse() by the agent wallet"],
  ];
  flow.forEach(([n, a, b], i) => {
    const x = M + i * (bw + gap);
    sheet(s, x, y0 + 0.2, bw, 2.15);
    s.addText(n, { x: x + 0.22, y: y0 + 0.45, w: bw - 0.44, h: 0.32, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 13.5, bold: true, color: INK, charSpacing: 0.4 });
    body(s, x + 0.22, y0 + 0.9, bw - 0.44, 0.32, a, { fontSize: 11.5 });
    mono(s, x + 0.22, y0 + 1.45, bw - 0.44, 0.6, b, { fontSize: 8.5, color: MUTE });
    if (i < 3) arrow(s, x + bw + 0.07, y0 + 1.28, gap - 0.14);
  });

  const cy = y0 + 2.6;
  sheet(s, M, cy, 5.9, 2.15);
  label(s, M + 0.3, cy + 0.3, 5.3, "AGENTS PRICE THE NOTES");
  body(s, M + 0.3, cy + 0.66, 5.3, 1.3,
    "Every persona publishes a maxNotePrice. The desk's Dynamic agent wallet bids at the lead's price, lenders bid alongside, and the auction panel has a “copy this agent's bid” button.",
    { fontSize: 12 });

  sheet(s, M + 6.2, cy, CW - 6.2, 2.15);
  label(s, M + 6.5, cy + 0.3, CW - 6.8, "THEN IT REPAYS ITSELF");
  body(s, M + 6.5, cy + 0.66, CW - 6.8, 1.3,
    "The keeper swaps collected WETH to USDC through the Uniswap Trading API, with the vault itself as the swapper and minUsdcOut enforced on-chain. Holders redeem notes 1:1.",
    { fontSize: 12 });
  foot(s, "contracts/src/FeeVault.sol startAuction L259 · agent/src/cca/index.ts · agent/src/uniswap/index.ts. Mainnet Trading API swap: EVIDENCE #1. Feedback: FEEDBACK.md.", 6);
}

// =======================================================================
// 07 — Credit Line Board
// =======================================================================
{
  const s = newSlide("The Credit Line Board prices every Bankr agent profile with the same engine a real quote uses. It also prices 17 Robinhood Chain agents as indicative lines, four of which earn fees in tokenized stocks.");
  const y0 = head(s, "CREDIT LINE BOARD", "Every Bankr agent, already priced");

  sheet(s, M, y0, 7.1, 3.6);
  const iw = (7.1 - 0.6) / 2;
  stat(s, M + 0.3, y0 + 0.32, iw - 0.1, 1.35, "$756.69", "PRE-APPROVED CREDIT", null, GREEN, 28);
  stat(s, M + 0.3 + iw, y0 + 0.32, iw - 0.1, 1.35, "14 of 105", "AGENTS ELIGIBLE TODAY", null, INK, 28);
  body(s, M + 0.3, y0 + 2.1, 6.5, 1.3,
    "Every row runs the same computeTerms, the lead persona's advance rate and a live ETH/USD quote. A rejected agent keeps its row and states the reason. Each row's Apply button opens the real flow.",
    { fontSize: 12.5 });

  sheet(s, M + 7.4, y0, CW - 7.4, 3.6);
  label(s, M + 7.7, y0 + 0.32, CW - 8.0, "ONCHAIN EQUITIES — ROBINHOOD CHAIN");
  const eq = [["17", "agents priced as indicative lines"], ["4", "earn fees in tokenized stocks"]];
  eq.forEach(([n, t], i) => {
    const y = y0 + 0.72 + i * 0.72;
    s.addText(n, { x: M + 7.7, y, w: 0.85, h: 0.45, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 22, bold: true, color: INK });
    body(s, M + 8.6, y + 0.08, CW - 8.95, 0.5, t, { fontSize: 11 });
  });
  mono(s, M + 7.7, y0 + 2.3, CW - 8.0, 0.3, "SPY · TSLA · MSTR · AMZN", { fontSize: 11.5, color: VIOLET, bold: true });
  body(s, M + 7.7, y0 + 2.68, CW - 8.0, 0.7,
    "Fees arrive as shares. Marked indicative: the desk contracts are deployed on Base only.",
    { fontSize: 10.5, color: MUTE });

  box(s, M, y0 + 3.85, CW, 1.0);
  label(s, M + 0.3, y0 + 4.08, 5.0, "NOT THEORETICAL", GREEN);
  body(s, M + 0.3, y0 + 4.36, CW - 0.6, 0.4,
    "The desk bridged 0.0002 ETH to Robinhood Chain and bought 0.00079 TSLA through the Uniswap Trading API on chain 4663 — proof the liquidation leg trades.",
    { fontSize: 11.5 });
  foot(s, "Bankr /api/board, snapshot 2026-09-19 15:44 UTC (README). TSLA buy: docs/EVIDENCE.md #6. Live board: gadai-six.vercel.app/board.", 7);
}

// =======================================================================
// 08 — Follow the Desk
// =======================================================================
{
  const s = newSlide("Every credit decision is published as a scored public signal. Followers mirror approved borrowers with Definitive Flash orders. On mainnet the desk mirrored its own signal with a real TWAP, and the first slice filled.");
  const y0 = head(s, "DEFINITIVE FLASH — SOCIAL TRADING", "Follow the desk, or don't");

  sheet(s, M, y0, 6.6, 4.75);
  label(s, M + 0.3, y0 + 0.32, 6.0, "EVERY MEMO IS A PUBLIC SIGNAL");
  const bits = [
    ["Leaderboard", "personas ranked on realized on-chain repayment and follower PnL — no realized data, no score"],
    ["Bracket mirror", "a Flash market entry with take-profit and stop-loss attached"],
    ["DCA mirror", "a long Flash TWAP that buys one slice a day"],
  ];
  bits.forEach(([k, v], i) => {
    const y = y0 + 0.78 + i * 1.25;
    s.addText(k, { x: M + 0.3, y, w: 6.0, h: 0.3, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 12.5, bold: true, color: INK });
    body(s, M + 0.3, y + 0.34, 6.0, 0.65, v, { fontSize: 11.5, color: MUTE });
    if (i < 2) s.addShape(pres.ShapeType.line, { x: M + 0.3, y: y + 1.1, w: 6.0, h: 0, line: { color: RULE, width: 0.75 } });
  });
  mono(s, M + 0.3, y0 + 4.22, 6.0, 0.3, "Definitive charges 10 bps · optional integrator fee, identical on quote and order", { fontSize: 8.5, color: MUTE });

  const rx = M + 6.9;
  const rw = CW - 6.9;
  sheet(s, rx, y0, rw, 4.75);
  label(s, rx + 0.3, y0 + 0.32, rw - 0.6, "FILLED ON BASE MAINNET");
  stamp(s, rx + 0.3, y0 + 0.64, 2.1, "FILLED", GREEN);
  const order = [
    ["ORDER", "fb3b2572-48c6-4ce5…"],
    ["TYPE", "Flash TWAP, 2 slices / 10 min"],
    ["SIZE", "0.25 USDC → GITLAWB"],
    ["FIRST FILL", "0.125 USDC → 2,158 GITLAWB"],
    ["FILL TX", "0x261a1355…0f3bcab4"],
    ["SIGNER", "Dynamic 2-of-2 MPC wallet"],
  ];
  order.forEach(([k, v], i) => {
    const y = y0 + 1.35 + i * 0.58;
    label(s, rx + 0.3, y, rw - 0.6, k);
    mono(s, rx + 0.3, y + 0.19, rw - 0.6, 0.26, v, { fontSize: 9 });
  });
  foot(s, "docs/EVIDENCE.md #5 · agent/src/social/index.ts · agent/src/flash/index.ts. The vault-funded keeper TWAP and follower mirrors are built and quote-tested, not filled.", 8);
}

// =======================================================================
// 09 — Dine on your fees
// =======================================================================
{
  const s = newSlide("Every loan carries a dining budget. A concierge plans a meal inside it from live Blackbird Flynet data. The FLY checkout is built but the app has no payment scope yet, so a real charge answers 403 and the deck says so.");
  const y0 = head(s, "BLACKBIRD FLYNET", "Dine on your fees");

  sheet(s, M, y0, CW, 2.6);
  const cw = (CW - 0.6) / 4;
  const cards = [
    ["1,675", "VENUES, LIVE", "every Blackbird location, cached 6 h with hours, specials and challenges"],
    ["PASSPORT", "MEMBER LOGIN", "OAuth 2.0 + PKCE: places visited, tiers, and gaps in their own neighborhoods"],
    ["TRENDING", "NETWORK SIGNAL", "ranked by 7-day check-ins across the Blackbird network"],
    ["drawLimit", "THE BUDGET", "the plan is costed against the loan's own dining budget"],
  ];
  cards.forEach(([big, cap, sub], i) => {
    const x = M + 0.3 + i * cw;
    box(s, x, y0 + 0.32, cw - 0.12, 2.0);
    label(s, x + 0.2, y0 + 0.52, cw - 0.52, cap);
    s.addText(big, { x: x + 0.2, y: y0 + 0.78, w: cw - 0.52, h: 0.45, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 20, bold: true, color: INK });
    body(s, x + 0.2, y0 + 1.3, cw - 0.52, 0.95, sub, { fontSize: 10.5, color: MUTE, lineSpacingMultiple: 1.12 });
  });

  sheet(s, M, y0 + 2.85, 7.4, 1.9);
  label(s, M + 0.3, y0 + 3.15, 6.8, "WHAT A JUDGE SEES");
  body(s, M + 0.3, y0 + 3.5, 6.8, 1.1,
    "Ask “somewhere in NYC for four, open late, burgers” on /dine/1 and get real venues with reasons, today's hours, specials, challenges and a cost estimate.",
    { fontSize: 12 });

  sheet(s, M + 7.7, y0 + 2.85, CW - 7.7, 1.9);
  label(s, M + 8.0, y0 + 3.15, CW - 8.3, "PAYMENTS: PENDING BLACKBIRD REVIEW", AMBER_INK);
  body(s, M + 8.0, y0 + 3.5, CW - 8.3, 1.1,
    "The FLY checkout is built, but the app holds no payment scope yet: a charge answers 403 and no FLY moves. The state flips itself on approval.",
    { fontSize: 12 });
  foot(s, "agent/src/flynet/index.ts, on live Flynet production data. App “hackathon 2” approved with read scopes plus write:save_to_list.", 9);
}

// =======================================================================
// 10 — Agent-to-agent economy
// =======================================================================
{
  const s = newSlide("Gadai is sold to agents as well as humans: a paid credit report on Bankr x402 Cloud, a Bankr Skill so any agent can borrow by chat, Grok Bot skills, and the desk itself paying another agent's API.");
  const y0 = head(s, "AGENT-TO-AGENT", "Agents buy from agents");

  const cw = (CW - 0.6) / 4;
  const items = [
    ["$0.02", "SOLD: CREDIT REPORT", "gadai-credit on Bankr x402 Cloud. No desk server needed; an unpaid call answers HTTP 402.", "x402.bankr.bot/…/gadai-credit", VIOLET],
    ["$0.05", "BOUGHT: RISK VERDICT", "The desk's own wallet pays a third-party honeypot check and uses the answer.", "EIP-3009 · Bankr facilitator", VIOLET],
    ["CHAT", "BANKR SKILL", "Any Bankr agent can quote, pledge, check status and repay by chat.", "skill/gadai/SKILL.md", INK],
    ["GROK", "TWO AGENT SKILLS", "gadai-credit quotes a line; gadai-loan-watch runs a daily loan summary.", "node grok/check.mjs", INK],
  ];
  items.forEach(([big, cap, sub, detail, c], i) => {
    const x = M + i * cw;
    sheet(s, x, y0, cw - 0.2, 3.4);
    label(s, x + 0.25, y0 + 0.32, cw - 0.7, cap);
    s.addText(big, { x: x + 0.25, y: y0 + 0.64, w: cw - 0.7, h: 0.6, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 30, bold: true, color: c, charSpacing: -0.4 });
    body(s, x + 0.25, y0 + 1.4, cw - 0.7, 1.4, sub, { fontSize: 11 });
    s.addShape(pres.ShapeType.line, { x: x + 0.25, y: y0 + 2.82, w: cw - 0.7, h: 0, line: { color: RULE, width: 0.75 } });
    mono(s, x + 0.25, y0 + 2.96, cw - 0.7, 0.35, detail, { fontSize: 8, color: MUTE });
  });

  sheet(s, M, y0 + 3.65, CW, 1.1);
  label(s, M + 0.3, y0 + 3.9, 6.0, "TRY IT WITHOUT US");
  mono(s, M + 0.3, y0 + 4.2, CW - 0.6, 0.35,
    "curl -i \"https://x402.bankr.bot/0x0455…e98/gadai-credit?token=0x5F98…DBa3\"  →  402 Payment Required",
    { fontSize: 10 });
  foot(s, "x402/gadai-credit/index.ts (engine copied verbatim, source commit in the header) · skill/gadai/SKILL.md · grok/. Bankr agent profile “gadai” is pending Bankr review.", 10);
}

// =======================================================================
// 11 — Mainnet evidence
// =======================================================================
{
  const s = newSlide("Six Base mainnet transactions, all signed by the desk's Dynamic MPC agent wallet. The loan lifecycle itself ran on an Anvil fork against a real Bankr pool.");
  const y0 = head(s, "EVIDENCE", "Six transactions on Base mainnet");
  sheet(s, M, y0, CW, 4.75);
  const evid = [
    ["Uniswap Trading API swap", "0.00015 ETH → 0.395941 USDC, routing CLASSIC", "0x6dd51e0c…026cc072"],
    ["FeeDesk deployed", "the lending desk, live on Base", "0x21cce932…c233ee858"],
    ["ERC-8004 register()", "desk agent #94699, builder code bc_32d4pc8g", "0xde4b3490…966229cb"],
    ["x402 payment by the agent", "$0.05 USDC for a honeypot verdict, EIP-3009", "0x9c22339b…3f98ad00"],
    ["Definitive Flash TWAP fill", "0.125 USDC → 2,158 GITLAWB", "0x261a1355…0f3bcab4"],
    ["0.00079 TSLA bought", "Uniswap Trading API on Robinhood Chain 4663", "0xbfbe9702…366dd708"],
  ];
  evid.forEach(([what, why, tx], i) => {
    const y = y0 + 0.4 + i * 0.68;
    numberDot(s, M + 0.3, y + 0.04, i + 1);
    s.addText(what, { x: M + 0.78, y, w: 3.5, h: 0.28, isTextBox: true, margin: 0, fontFace: SANS, fontSize: 11.5, bold: true, color: INK, valign: "top" });
    body(s, M + 4.4, y + 0.02, 5.0, 0.28, why, { fontSize: 10.5, color: MUTE });
    mono(s, M + 9.55, y + 0.02, 2.5, 0.28, tx, { fontSize: 9.5, color: VIOLET, align: "right" });
    if (i < 5) s.addShape(pres.ShapeType.line, { x: M + 0.3, y: y + 0.5, w: CW - 0.6, h: 0, line: { color: RULE, width: 0.75 } });
  });
  mono(s, M + 0.3, y0 + 4.32, CW - 0.6, 0.28, "signer: 0x81b73786BF2dE819e66BB57d08effADe0085305D — Dynamic 2-of-2 MPC agent wallet", { fontSize: 9, color: MUTE });
  foot(s, "docs/EVIDENCE.md, verified 2026-09-19. Full hashes and Basescan links: gadai-six.vercel.app/evidence.", 11);
}

// =======================================================================
// 12 — Live vs simulated
// =======================================================================
{
  const s = newSlide("What ran where, stated plainly, plus the four links a judge needs.");
  const y0 = head(s, "HONEST SCOPE", "Live vs simulated");

  const bullet = { indent: 14 };
  sheet(s, M, y0, 6.1, 3.55);
  label(s, M + 0.3, y0 + 0.32, 5.5, "MAINNET, OR LIVE PRODUCTION DATA", GREEN);
  body(s, M + 0.3, y0 + 0.72, 5.5, 2.6, [
    { text: "FeeDesk deploy, ERC-8004 #94699, the x402 payment, the Flash TWAP fill, the Uniswap swap, the TSLA buy", options: { bullet, breakLine: true } },
    { text: "Bankr fee APIs, agent profiles and LLM-usage reads behind every quote", options: { bullet, breakLine: true } },
    { text: "Blackbird Flynet venues, hours, specials and member login", options: { bullet, breakLine: true } },
    { text: "The paid credit report on Bankr x402 Cloud", options: { bullet } },
  ], { fontSize: 12, paraSpaceAfter: 18 });

  sheet(s, M + 6.4, y0, CW - 6.4, 3.55);
  label(s, M + 6.7, y0 + 0.32, CW - 7.0, "FORK, OR PENDING REVIEW", AMBER_INK);
  body(s, M + 6.7, y0 + 0.72, CW - 7.0, 2.6, [
    { text: "The loan lifecycle ran on an Anvil fork of Base against the real GITLAWB pool — fork txs are not on Basescan", options: { bullet, breakLine: true } },
    { text: "Bankr LLM credits are $0, so memos run deterministic persona rules and say so; the LLM path fails closed", options: { bullet, breakLine: true } },
    { text: "FLY payments pending Blackbird review; the Bankr agent profile is pending Bankr review", options: { bullet } },
  ], { fontSize: 12, paraSpaceAfter: 18 });

  box(s, M, y0 + 3.8, CW, 1.05);
  label(s, M + 0.3, y0 + 4.05, 5.0, "VERIFY IN FIVE MINUTES");
  mono(s, M + 0.3, y0 + 4.33, CW - 0.6, 0.35,
    "gadai-six.vercel.app   ·   /demo   ·   /evidence   ·   /board   ·   github.com/PugarHuda/gadai",
    { fontSize: 11, color: VIOLET });
  foot(s, "README.md “Live vs simulated” and docs/EVIDENCE.md. Nothing in the repo is mocked; the one demo mode, DEMO_FORK=1, is labelled on every page.", 12);
}

await pres.writeFile({ fileName: OUT });
console.log("wrote", OUT);
