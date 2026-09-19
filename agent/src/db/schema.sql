-- Gadai agent storage (node:sqlite). Owned by agent-core; request changes via docs/COORDINATION.md.
-- Timestamps are ISO text. *_raw = decimal base-unit strings.
CREATE TABLE IF NOT EXISTS loans (id INTEGER PRIMARY KEY, status TEXT NOT NULL, via TEXT NOT NULL,
  borrower TEXT NOT NULL, controller TEXT NOT NULL, token TEXT NOT NULL, symbol TEXT NOT NULL,
  pool_id TEXT NOT NULL, fees_manager TEXT NOT NULL, onchain_id INTEGER, vault TEXT, note TEXT, auction TEXT,
  terms_json TEXT, quote_json TEXT, lead_memo_json TEXT, pledge_tx_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS loans_borrower ON loans(borrower);
CREATE TABLE IF NOT EXISTS loan_events (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, kind TEXT NOT NULL,
  tx_hash TEXT, data_json TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS loan_events_loan ON loan_events(loan_id);
CREATE TABLE IF NOT EXISTS memos (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  model TEXT NOT NULL, decision TEXT NOT NULL, principal_raw TEXT NOT NULL, max_note_price REAL NOT NULL,
  confidence REAL NOT NULL, rationale TEXT NOT NULL, risks_json TEXT NOT NULL, raw_text TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signals (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, persona_id TEXT NOT NULL,
  token TEXT NOT NULL, symbol TEXT NOT NULL, decision TEXT NOT NULL, score REAL NOT NULL, principal_raw TEXT NOT NULL,
  max_note_price REAL NOT NULL, rationale TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS follows (id INTEGER PRIMARY KEY, follower TEXT NOT NULL, persona_id TEXT NOT NULL,
  mode TEXT NOT NULL, size_usdc REAL NOT NULL, tp_pct REAL NOT NULL, sl_pct REAL NOT NULL, dca_days INTEGER NOT NULL,
  auto INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mirror_orders (id INTEGER PRIMARY KEY, follow_id INTEGER NOT NULL, signal_id INTEGER NOT NULL,
  follower TEXT NOT NULL, token TEXT NOT NULL, symbol TEXT NOT NULL, mode TEXT NOT NULL, size_usdc REAL NOT NULL,
  status TEXT NOT NULL, flash_order_id TEXT, bracket_status TEXT, quote_json TEXT, filled_token_raw TEXT,
  avg_price_usd REAL, pnl_usd REAL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delegations (address TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, user_id TEXT NOT NULL,
  encrypted_json TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS flash_orders (id TEXT PRIMARY KEY, loan_id INTEGER NOT NULL, mode TEXT NOT NULL,
  funder TEXT NOT NULL, token TEXT NOT NULL, amount_raw TEXT NOT NULL, status TEXT NOT NULL, usdc_out_raw TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS flynet_links (loan_id INTEGER PRIMARY KEY, member_id TEXT NOT NULL, access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, loan_id INTEGER NOT NULL, code_verifier TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS draws (id INTEGER PRIMARY KEY, loan_id INTEGER NOT NULL, amount_raw TEXT NOT NULL,
  fly_wei TEXT NOT NULL, location_id TEXT, flynet_reward_id TEXT, tx_hash TEXT, status TEXT NOT NULL, error TEXT,
  draw_nonce TEXT, deadline TEXT, borrower_sig TEXT, -- the signed FeeVault.addDraw args (resendable verbatim)
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, used_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
