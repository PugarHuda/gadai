# Distribution: Grok Bot, Bankr Agent Profile, Flynet access

Status as of 2026-09-19 (WIB evening). Each item says what is done and what still needs a human.

---

## 1. Grok Bot (Runtime track 6)

### What Grok Bot is, per its docs

Sources: https://docs.x.ai/grok-bot/overview.md, `/get-started.md`, `/skills-routines-and-automations.md`, `/bots.md`, `/computer-and-apps.md`, https://cursor.com/help/grok-bot/plans.md, `/routines.md`, `/secrets.md`.

- A Bot is a named teammate running on a persistent **cloud computer** with a browser, a terminal and a `/workspace` folder. That computer is where our skills run `curl`, not the user's laptop.
- A **skill** is "a reusable set of instructions" that is saved into the account's **Private skills** library and shared by all of its Bots. The documented way to create one is to *ask a Bot to save it* ("Save the process ... as a skill called ..."). Packaged skills otherwise come from **Marketplace** plugins. The Grok Bot docs define no file-upload format for skills.
- A **routine** tells one Bot when to run a workflow (every day, weekdays, an interval, a Slack listener, or a webhook). It is created by asking the owning Bot, runs in the cloud while the laptop is closed, and spends weekly usage on every run.
- The docs say a useful skill states six things: when to use it, required inputs and access, the sequence of work, how to validate the result, what to return, and what requires approval. Both of our skills use exactly those six sections.
- **Share:** Share menu → **Create template** → **Public link**. The link carries the Bot's identity, description, skills and routines. Recipients open it on x.ai and choose **Add to Grok Bot**. This is how others get the Gadai Bot.

### What we built: `grok/`

`grok/` is an **Agent Plugins 1.1.0** package, the open format Cursor supports for plugins that package skills. Grok Bot plugins come from the Cursor account's marketplace and connector policy. Each skill follows the **Agent Skills** spec (`SKILL.md` with `name` and `description` frontmatter), so the same files work both as a plugin and as text a Bot saves as a private skill.

```
grok/
├── plugin.json                         # Agent Plugins 1.1.0 manifest (closed schema)
├── check.mjs                           # zero-dep validator: node grok/check.mjs
└── skills/
    ├── gadai-credit/SKILL.md           # quote, pledge-flow explainer, Credit Line Board, paid x402 report
    └── gadai-loan-watch/SKILL.md       # one loan: status, debt, change since last run (routine-ready)
```

What the skills call (every one re-curled 2026-09-20, all 200):
- `GET $FD/api/health` → `{"ok":true,"demoFork":true,...}`. Free. Drives the DEMO-fork guard.
- `GET $FD/api/quote?token=&borrower=` returns eligibility, terms and `formula`. Free. **Both params are required** — a missing `borrower` is `400 {"error":"borrower must be a 0x address"}`, which is why the skill now states it as required rather than optional.
- `GET $FD/api/board` is the Credit Line Board (105 Base agents, 14 eligible, $856.57 total at 01:19 UTC). Free.
- `GET $FD/api/loans/:id` (404 → `{"error":"loan 999 not found"}`), `/api/loans/:id/auction`, `/api/loans?borrower=` and `/api/desk`. Free.
- `https://x402.bankr.bot/0x0455408228f460722ecbe80789bcf1628b479e98/gadai-credit?token=` costs $0.02 USDC through `npx -y @bankr/cli@latest x402 call`. It answers `402` without payment. The Bot asks the user before every call.
- `$FD` = `https://aqua-economic-moss-modes.trycloudflare.com`. **This is a quick tunnel and its hostname changes when the tunnel restarts.** If it changes, update the `FD=` line in both SKILL.md files (and in `skill/gadai/`).

Validation (all pass):
```
node grok/check.mjs                                   # manifest closed-schema + name rules, skill frontmatter, six sections, FD set
curl -sLO https://raw.githubusercontent.com/agentplugins/agent-plugins-spec/main/schemas/1.1.0/plugin.schema.json
npx -y ajv-cli@5 validate --spec=draft2020 -s plugin.schema.json -d grok/plugin.json   # official schema → valid
npx -y skills-ref validate grok/skills/gadai-credit   # → Valid skill
npx -y skills-ref validate grok/skills/gadai-loan-watch  # → Valid skill
```

### What the user must have (plan requirements)

Grok Bot is **not free-standing**. It needs one of the following:
- a paid individual **Cursor Pro, Pro+ or Ultra** plan, or a self-serve **Cursor Teams** seat (Enterprise must ask their account team), **or**
- an individual **SuperGrok, SuperGrok Plus, SuperGrok Heavy or X Premium+** subscription linked to a Cursor account (desktop: Settings → Usage & Billing → Link SuperGrok). **SuperGrok Lite, SuperGrok Team and SuperGrok Enterprise do not work.**
- New accounts get a **free trial usage credit** (a 7-day window, drawn down by agent steps and tokens). It is enough to install the skills and do a test run, but a daily routine eats into it.
- The Grok Bot desktop app (macOS, Windows or Linux from https://x.ai/bot) or the mobile app. Routines can only be edited and test-run from desktop.
- The Cursor account must not use Legacy Privacy Mode, because Grok Bot needs cloud data storage.

`grok/` is on `github.com/PugarHuda/gadai` (main); the raw SKILL.md URLs below return 200 (checked 2026-09-19).

### Can the Bot and its template link be created without a human? **No.** (checked 2026-09-20)

Every xAI surface was enumerated. There is no REST or CLI path to (a) create a Bot, (c) create a routine or (d) publish a public template link. Only (b), hosting a skill, has an API — and it is a different skill store from Grok Bot's.

| Surface | Checked | Bots? | Routines? | Templates? |
|---|---|---|---|---|
| Inference API `https://api.x.ai` | `https://docs.x.ai/openapi.json` — **38 paths**, full list read | no (`GET /v1/bots` → 404) | no | no |
| Management API `https://management-api.x.ai` | `https://docs.x.ai/developers/management-api-guide.md` + `/developers/rest-api-reference/management/auth.md` | no (`/bots` → 404) | no | no |
| Docs index | `https://docs.x.ai/llms.txt` — every Grok Bot page listed | all UI-only | UI-only | UI-only |
| CLI | npm `@xai/cli`, `@xai/grok-bot`, `@x-ai/cli`, `@xai/sdk` → **404**; `xai-cli` → npm *security holding package*, empty | none exists | | |

The Management API's whole surface is API keys, team models/endpoints and audit logs: `POST|GET /auth/teams/{teamId}/api-keys`, `GET|PATCH|DELETE /auth/api-keys/{id}`, `.../rotate`, `.../propagation`, `GET /auth/teams/{teamId}/models`, `.../endpoints`, `GET /auth/management-keys/validation`, `GET /audit/teams/{teamId}/events`. No bot, skill, routine or template resource.

`https://docs.x.ai/grok-bot/bots.md` states the template flow in the UI only, verbatim: *"Open the **Share menu** and choose **Create template**. The Bot builds the template; when it is ready, **Copy link**, **View template details**, and **Update template** appear."* … *"Choose who can open the link: **Public link** or **Team-only**."* There is no API counterpart anywhere in the docs.

**So `grok/create-bot.mjs` was not written** — there is nothing for it to call. The click-path below is the only path, and it is ~4 minutes.

**The one thing that *is* automatable** (optional, not needed for the deliverable): xAI hosts skills for the *inference* API at `POST /v1/skills` (multipart zip, `name`/`description` read from `SKILL.md` frontmatter; then `GET /v1/skills`, `GET|DELETE /v1/skills/{id}`, `GET /v1/skills/{id}/content`). Needs an `XAI_API_KEY` from https://console.x.ai → API Keys. These are skills for `/v1/responses` agents, **not** Grok Bot's Private skills library, so this does not shortcut any step below:

```bash
cd grok/skills && zip -r gadai-credit.zip gadai-credit
curl -s https://api.x.ai/v1/skills -H "Authorization: Bearer $XAI_API_KEY" -F files=@gadai-credit.zip
```

### Install: the click-path (the only path)

Needs the Grok Bot desktop app and a qualifying plan (see above). ~4 minutes.

0. **Push `grok/` first — step 2 downloads from `raw.githubusercontent.com`, not from disk.** As of 2026-09-20 the pushed `gadai-credit/SKILL.md` still says `BORROWER (optional)`, which makes the Bot's first quote fail with a 400. The local file is fixed; commit and push it, then confirm the fix is live:
   ```bash
   curl -s https://raw.githubusercontent.com/PugarHuda/gadai/main/grok/skills/gadai-credit/SKILL.md | grep -c 'BORROWER`: \*\*required\*\*'   # must print 1
   ```
   Also re-check the `FD=` line in both raw files still matches the running tunnel (it did at 2026-09-20 01:19 UTC). The tunnel hostname changes on restart; if it moved, edit `FD=` in both SKILL.md files, push again, and re-run step 0.
1. **New** in the sidebar (`Cmd/Ctrl+N`) → **Create new Bot** → open the Bot menu → **Edit Profile**. Paste:
   - **Name:** `Gadai`
   - **Label / job:** `Creator-fee credit desk`
   - **Description:** `Quote Gadai USDC credit lines for Bankr (Doppler) tokens on Base, explain the pledge flow, read the Credit Line Board and watch loans. Read-only: never sign, send, transfer or pledge. Ask before any paid x402 call.`
2. Send the Bot this message (both raw URLs return 200, checked 2026-09-20):
   > Download https://raw.githubusercontent.com/PugarHuda/gadai/main/grok/skills/gadai-credit/SKILL.md and https://raw.githubusercontent.com/PugarHuda/gadai/main/grok/skills/gadai-loan-watch/SKILL.md. Save each one as a skill named after its `name` field (gadai-credit, gadai-loan-watch), keeping the instructions word for word. Then show me both in the / menu.
3. If a skill does not appear under `/`, open **Marketplace → Your plugins → Manage plugins and skills** → **Private skills**. (The two files can also be dragged into the chat as attachments instead.)
4. **Test it** — paste this, and the answer should be `eligible: true`, about **$235 USDC**:
   > /gadai-credit quote token 0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3 borrower 0xfdb6430011f6E4796Ca380CB39e47975b1f876Bf
   
   Then: `/gadai-credit show the Credit Line Board` (105 agents, 14 eligible, $856.57 total).
5. **Routine** — send this, then **Test run** (desktop only):
   > Every day at 9:00 AM, run the gadai-loan-watch skill for Gadai loan 1 and post the summary in this conversation. Read-only: never repay, release, sign or contact anyone. If the Gadai desk is unreachable, report the failure instead of using old data. Pause the routine once the loan is RELEASED or CANCELLED.

   Loan `1` (GITLAWB) exists and is `RELEASED`, so a test run returns a real summary; a live routine would pause immediately, which is the correct behaviour. For an open loan, create one first (docs/RUNBOOK.md).
6. **Publish the template** — **Share menu** → **Create template** → wait for it to build → set **Public link** (not Team-only; Enterprise accounts default to Team-only) → **Copy link**. **That link is the Grok Bot track deliverable.**
7. Before sending it: **View template details** and confirm no secrets. The template carries identity, description, skills and routines — the skills contain no keys, and `BANKR_API_KEY` lives in Bot Secrets, which are not shared. Check anyway.

**Optional, paid report only** (step 3c of `gadai-credit`): Bot → **Secrets** → **Add secret** → name `BANKR_API_KEY`, value a Bankr API key whose wallet holds ≥ $0.02 USDC on Base. The Bankr CLI reads that env var. Never paste it in chat. Skip this and everything else still works.

### Alternative: Cursor team marketplace (Cursor Teams plan only, untested for Grok Bot)

Cursor documents team marketplaces that distribute Agent Plugins: Dashboard → Plugins & MCPs → Add Marketplace → Import from Repo. A repo with several plugins needs `.cursor-plugin/marketplace.json` at the **repo root**, which is outside the folders this agent may edit. If the lead wants this path, add:
```json
{ "name": "gadai", "owner": { "name": "Gadai" }, "metadata": { "description": "Gadai plugins" },
  "plugins": [ { "name": "gadai", "source": "grok", "description": "Gadai credit skills for Grok Bot" } ] }
```
The Grok Bot docs say "Use Marketplace to discover and install ... packaged skills", but they never state that a team-marketplace skill plugin shows up in Grok Bot. **UNVERIFIED.** The ask-the-Bot path above is the documented one.

---

## 2. Bankr Agent Profile

Done through the documented REST API (`POST https://api.bankr.bot/agent/profile`, `X-API-Key` from the logged-in CLI) and CLI (`bankr agent profile add-update`) on the account wallet `0x0455408228f460722ecbe80789bcf1628b479e98`.

| | |
|---|---|
| id | `6aaea6368ff44a9e89792e32` |
| slug | `gadai` |
| projectName | Gadai |
| website | https://gadai-six.vercel.app |
| profileImageUrl | https://raw.githubusercontent.com/PugarHuda/gadai/main/docs/brand/gadai-logo.png |
| products | Gadai credit desk (site), Credit Line Board (/board), Gadai skill (source) → https://github.com/PugarHuda/gadai, Gadai credit report (x402) |
| revenueSources | x402 credit reports ($0.02), loan fee (FeeNote spread) |
| token | none (this account has not deployed a Bankr token and is not a fee beneficiary) |
| project update | "Gadai is live: USDC credit against creator fees", posted 2026-09-19T15:12:26Z |
| **state** | `approved: false`, `isPublished: false`, `reviewStatus: "draft"` |

What this means: the profile is **not public yet**. `GET https://api.bankr.bot/agent-profiles/gadai` returns 404 until a Bankr admin approves it ("Profiles start unapproved and become publicly visible after admin review"). The docs, the CLI (`create/update/delete/add-update`) and the REST API have **no submit-for-review call**, so nothing more can be done from here.

Still needs the user:
- Wait for approval, or ask Bankr for review (Runtime Discord / @bankrbot). Give them the slug `gadai`.
- Optional: link X/Twitter to the Bankr account (at bankr.bot) so `twitterUsername` fills in. Link GitHub so the GitHub card marks `PugarHuda/gadai` as **verified**. The GitHub card comes from the first `github.com/{owner}/{repo}` URL, which here is the "Gadai skill (source)" product.
- The docs list eligibility as "deployed a token through Bankr or a fee beneficiary on the token". That applies to *claiming a token*. We set no token, and whether approval needs one is **UNVERIFIED**.

Re-check: `npx -y @bankr/cli@latest agent profile --json`.

---

## 3. Flynet (Blackbird)

**Status:** the Maker app **"hackathon 2" is approved on production**. The production key works with header `x-api-key`. Scopes: `read:profile read:wallets read:user_checkins read:checkins read:app read:balance read:restaurant_specials read:restaurant_challenges write:save_to_list read:memberships read:tags`. **Payments and rewards are pending Blackbird review.** The integration was rebuilt on 2026-09-19 as a dining concierge (live venues, hours, specials, challenges) plus a member passport; the FLY dining draws were removed.

### Endpoints usable without a Maker key (checked today)

- **None on the data API.** `GET https://api.staging.blackbird.xyz/flynet/v1/restaurants`, `/locations`, and prod `https://api.blackbird.xyz/flynet/v1/restaurants` all return `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`, and that well-known URL returns 404. The OpenAPI (`https://docs.flynet.org/api-reference/openapi.yaml`, 25 paths) has no unauthenticated route.
- **Docs MCP only:** `https://docs.flynet.org/mcp` (streamable HTTP, no auth). Tools: `search_flynet_docs` and `query_docs_filesystem_flynet_docs`. It returns documentation, not restaurant data.
- The API MCP `npx -y @flynetdev/mcp` needs `FLYNET_API_KEY` (and `FLYNET_ACCESS_TOKEN` for member tools), and all its tools are read-only.
- Access is self-serve per https://docs.flynet.org/resources/request-access (make.flynet.org → create app). That is moot now that the app is approved.

### Discord message for Runtime #blackbird

> Hi Blackbird team! We're building **Gadai** for Runtime (USDC credit for Bankr agents against their token's creator fees, with a dining concierge on Flynet). Thanks for approving our production app **"hackathon 2"** (Maker account hudapugar@gmail.com): live discovery and member OAuth are in use. One ask: the **payments and rewards** review (Payment Intents and `write:rewards` / `POST /issue_reward`) for that app. With those, a member could spend part of their loan's dining budget in FLY instead of paying separately in the Blackbird app. Is there anything you need from us for the review? Thanks!
