// Storage (node:sqlite, WAL). Owned by agent-core. Other modules read/write their own tables directly via ctx.db;
// loans/events/memos go through these helpers so JSON columns stay consistent.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Address, Hex, Loan, LoanEvent, LoanEventKind, LoanStatus, Memo, Quote, Signal, Terms, TxRequest } from "@feedesk/shared";
import { pledgeChatText } from "@feedesk/shared";

export const now = () => new Date().toISOString();

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  // migration: signals.mirrorable/mirror_note (older DBs predate them; NULL = legacy row, reads as not mirrorable)
  const cols = (db.prepare("PRAGMA table_info(signals)").all() as R[]).map((c) => c.name);
  if (!cols.includes("mirrorable")) db.exec("ALTER TABLE signals ADD COLUMN mirrorable INTEGER; ALTER TABLE signals ADD COLUMN mirror_note TEXT;");
  // migration: draws carry the borrower-signed addDraw args (FeeVault.addDraw(amount, deadline, sig))
  if (!(db.prepare("PRAGMA table_info(draws)").all() as R[]).some((c) => c.name === "borrower_sig"))
    db.exec("ALTER TABLE draws ADD COLUMN draw_nonce TEXT; ALTER TABLE draws ADD COLUMN deadline TEXT; ALTER TABLE draws ADD COLUMN borrower_sig TEXT;");
  return db;
}

/** Writable loan fields (camelCase). JSON fields are serialized to *_json columns. */
export type LoanRow = {
  status: LoanStatus;
  via: Loan["via"];
  borrower: Address;
  controller: Address;
  token: Address;
  symbol: string;
  poolId: Hex;
  feesManager: Address;
  onchainId: number | null;
  vault: Address | null;
  note: Address | null;
  auction: Address | null;
  terms: Terms | null;
  quote: Quote | null;
  leadMemo: Memo | null;
  pledgeTx: TxRequest | null;
};

const COL: Record<keyof LoanRow, string> = {
  status: "status", via: "via", borrower: "borrower", controller: "controller", token: "token", symbol: "symbol",
  poolId: "pool_id", feesManager: "fees_manager", onchainId: "onchain_id", vault: "vault", note: "note", auction: "auction",
  terms: "terms_json", quote: "quote_json", leadMemo: "lead_memo_json", pledgeTx: "pledge_tx_json",
};
const JSON_COLS = new Set(["terms", "quote", "leadMemo", "pledgeTx"]);
const toCol = (k: string, v: unknown) => (JSON_COLS.has(k) ? (v == null ? null : JSON.stringify(v)) : (v ?? null));
const parse = <T>(s: unknown): T | null => (s == null ? null : (JSON.parse(String(s)) as T));

type R = Record<string, any>;
function rowToLoan(r: R): Loan {
  return {
    id: Number(r.id), status: r.status, via: r.via, borrower: r.borrower, controller: r.controller, token: r.token,
    symbol: r.symbol, poolId: r.pool_id, feesManager: r.fees_manager, vault: r.vault, note: r.note, auction: r.auction,
    terms: parse<Terms>(r.terms_json), leadMemo: parse<Memo>(r.lead_memo_json),
    // A pledge to a vault that is not Created (APPROVED) can never be returned by FeeVault: never expose it then.
    pledgeTx: r.status === "APPROVED" ? parse<TxRequest>(r.pledge_tx_json) : null,
    pledgeChatText: r.status === "APPROVED" && r.vault ? pledgeChatText(r.token, r.vault) : null,
    debt: null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export function insertLoan(db: DatabaseSync, row: Partial<LoanRow> & Pick<LoanRow, "status" | "borrower" | "token" | "symbol" | "poolId" | "feesManager">): number {
  const full: R = { via: "web", controller: row.borrower, ...row };
  const keys = Object.keys(full) as (keyof LoanRow)[];
  const t = now();
  const r = db
    .prepare(`INSERT INTO loans (${keys.map((k) => COL[k]).join(",")},created_at,updated_at) VALUES (${keys.map(() => "?").join(",")},?,?)`)
    .run(...keys.map((k) => toCol(k, full[k]) as any), t, t);
  return Number(r.lastInsertRowid);
}

export function getLoan(db: DatabaseSync, id: number): Loan | null {
  const r = db.prepare("SELECT * FROM loans WHERE id = ?").get(id) as R | undefined;
  return r ? rowToLoan(r) : null;
}

/** Raw quote stored at apply time (not part of the Loan DTO). */
export function getLoanQuote(db: DatabaseSync, id: number): Quote | null {
  const r = db.prepare("SELECT quote_json FROM loans WHERE id = ?").get(id) as R | undefined;
  return parse<Quote>(r?.quote_json);
}

export function listLoans(db: DatabaseSync, f: { status?: LoanStatus; borrower?: Address } = {}): Loan[] {
  const where: string[] = [];
  const args: string[] = [];
  if (f.status) (where.push("status = ?"), args.push(f.status));
  if (f.borrower) (where.push("lower(borrower) = ?"), args.push(f.borrower.toLowerCase()));
  const sql = `SELECT * FROM loans ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC`;
  return (db.prepare(sql).all(...args) as R[]).map(rowToLoan);
}

export function updateLoan(db: DatabaseSync, id: number, patch: Partial<LoanRow>): void {
  const keys = Object.keys(patch) as (keyof LoanRow)[];
  if (!keys.length) return;
  for (const k of keys) if (!COL[k]) throw new Error(`updateLoan: unknown field ${k}`);
  db.prepare(`UPDATE loans SET ${keys.map((k) => `${COL[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => toCol(k, patch[k]) as any), now(), id);
}

export function addEvent(db: DatabaseSync, loanId: number, kind: LoanEventKind, txHash: Hex | null, data?: unknown): void {
  db.prepare("INSERT INTO loan_events (loan_id,kind,tx_hash,data_json,created_at) VALUES (?,?,?,?,?)")
    .run(loanId, kind, txHash, data === undefined ? null : JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), now());
}

export function listEvents(db: DatabaseSync, loanId: number): LoanEvent[] {
  return (db.prepare("SELECT * FROM loan_events WHERE loan_id = ? ORDER BY id").all(loanId) as R[]).map((r) => ({
    id: Number(r.id), loanId: Number(r.loan_id), kind: r.kind, txHash: r.tx_hash, data: parse(r.data_json), createdAt: r.created_at,
  }));
}

export function insertMemo(db: DatabaseSync, loanId: number, m: Memo, rawText: string | null): void {
  db.prepare(`INSERT INTO memos (loan_id,persona_id,model,decision,principal_raw,max_note_price,confidence,rationale,risks_json,raw_text,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(loanId, m.personaId, m.model, m.decision, m.principalRaw, m.maxNotePrice, m.confidence, m.rationale, JSON.stringify(m.risks), rawText, now());
}

export function listMemos(db: DatabaseSync, loanId: number): Memo[] {
  return (db.prepare("SELECT * FROM memos WHERE loan_id = ? ORDER BY id").all(loanId) as R[]).map((r) => ({
    personaId: r.persona_id, model: r.model, decision: r.decision, principalRaw: r.principal_raw, maxNotePrice: r.max_note_price,
    confidence: r.confidence, rationale: r.rationale, risks: JSON.parse(r.risks_json),
  }));
}

/** Signal DTO + whether followers' mirror orders were queued for it (and why not). */
export type SignalRow = Signal & { mirrorable: boolean; mirrorNote: string | null };
export const toSignal = (r: R): SignalRow => ({
  id: Number(r.id), loanId: Number(r.loan_id), personaId: r.persona_id, token: r.token, symbol: r.symbol, decision: r.decision,
  score: r.score, principalRaw: r.principal_raw, maxNotePrice: r.max_note_price, rationale: r.rationale, createdAt: r.created_at,
  mirrorable: r.mirrorable === 1, mirrorNote: r.mirror_note ?? null,
});

/** Signals are written by the social module; read here for LoanDetail. */
export function listLoanSignals(db: DatabaseSync, loanId: number): SignalRow[] {
  return (db.prepare("SELECT * FROM signals WHERE loan_id = ? ORDER BY id").all(loanId) as R[]).map(toSignal);
}

/** Single-use nonce. Returns false if already used. */
export function useNonce(db: DatabaseSync, nonce: string): boolean {
  return Number(db.prepare("INSERT OR IGNORE INTO nonces (nonce, used_at) VALUES (?, ?)").run(nonce, now()).changes) === 1;
}
