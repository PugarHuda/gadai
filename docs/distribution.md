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

What the skills call (all live, checked today):
- `GET $FD/api/quote?token=&borrower=` returns eligibility, terms and `formula`. It is free.
- `GET $FD/api/board` is the Credit Line Board (104 agents, 14 eligible, $755.62 total at 15:10 UTC). It is free.
- `GET $FD/api/loans/:id`, `/api/loans/:id/auction` and `/api/desk` are free.
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

Prerequisite on our side: **push `grok/` to `github.com/PugarHuda/gadai` (main)** so the raw URLs below resolve. This agent does not commit.

### Install (the documented path: ask the Bot)

1. In Grok Bot, go to **New → Create new Bot**, then **Edit Profile**:
   - **Name:** Gadai
   - **Job:** Creator-fee credit desk
   - **Description:** Quote Gadai USDC credit lines for Bankr tokens on Base, explain the pledge flow, read the Credit Line Board and watch loans. Read-only: never sign, send, transfer or pledge. Ask before any paid x402 call.
2. Send it this message:
   > Download https://raw.githubusercontent.com/PugarHuda/gadai/main/grok/skills/gadai-credit/SKILL.md and https://raw.githubusercontent.com/PugarHuda/gadai/main/grok/skills/gadai-loan-watch/SKILL.md. Save each one as a skill named after its `name` field (gadai-credit, gadai-loan-watch), keeping the instructions word for word. Then show me both in the / menu.
3. If a skill does not appear under `/`, open **Marketplace → Your plugins → Manage plugins and skills** and check **Private skills**. (The Bot can also be given the files as chat attachments instead of URLs.)
4. Optional, for the paid report only: in the Bot's **Secrets**, choose **Add secret**, name it `BANKR_API_KEY`, and paste a Bankr API key whose wallet holds at least $0.02 USDC on Base. The Bankr CLI reads that env var. Never paste the key in chat.
5. Test: `/gadai-credit quote 0x5f980dcfc4c0fa3911554cf5ab288ed0eb13dba3` (GITLAWB) and `/gadai-credit show the Credit Line Board`.
6. Routine: send the Bot this message, then use **Test run**:
   > Every day at 9:00 AM, run the gadai-loan-watch skill for Gadai loan <ID> and post the summary in this conversation. Read-only: never repay, release, sign or contact anyone. If the Gadai desk is unreachable, report the failure instead of using old data. Pause the routine once the loan is RELEASED or CANCELLED.

   There are no loans yet on the current demo desk (`GET /api/loans` returns `[]`). Create one first (fork demo, docs/RUNBOOK.md), or the routine will report `404 loan N not found`.
7. Share: go to **Share → Create template → Public link → Copy link**. That link is the submission artifact for the Grok Bot track. Check the template has no secrets in it first. Secrets are not part of the Bot description, but check anyway.

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

**Update from the lead:** the Maker app is **approved**. The production key works with header `x-api-key`. The app scopes are read-only: `read:profile read:wallets read:user_checkins read:checkins read:app read:balance read:restaurant_specials read:restaurant_challenges`. There are **no payment or rewards scopes**. A separate agent is rebuilding the integration.

### Endpoints usable without a Maker key (checked today)

- **None on the data API.** `GET https://api.staging.blackbird.xyz/flynet/v1/restaurants`, `/locations`, and prod `https://api.blackbird.xyz/flynet/v1/restaurants` all return `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`, and that well-known URL returns 404. The OpenAPI (`https://docs.flynet.org/api-reference/openapi.yaml`, 25 paths) has no unauthenticated route.
- **Docs MCP only:** `https://docs.flynet.org/mcp` (streamable HTTP, no auth). Tools: `search_flynet_docs` and `query_docs_filesystem_flynet_docs`. It returns documentation, not restaurant data.
- The API MCP `npx -y @flynetdev/mcp` needs `FLYNET_API_KEY` (and `FLYNET_ACCESS_TOKEN` for member tools), and all its tools are read-only.
- Access is self-serve per https://docs.flynet.org/resources/request-access (make.flynet.org → create app). That is moot now that the app is approved.

### Discord message for Runtime #blackbird

> Hi Blackbird team! We're building **Gadai** for Runtime (USDC credit for Bankr agents against their token's creator fees, with a "dine on your fees" line through Flynet). Our Flynet Make app **"hackathon"** (client_id `f6b4e775-dc14-4eff-a8cf-44e2fdb2cba4`, Maker account hudapugar@gmail.com) is approved, and read-only discovery + member OAuth work. Two asks:
> 1. Could we get **partner access for Payment Intents and `write:rewards` (`POST /issue_reward`)** on that app, staging or production, whichever you allow for hackathon projects? Our current scopes are read-only, so the draw (issue FLY to the borrower) and settle (payment intent back to our merchant) steps can't run.
> 2. What is the correct **OAuth `audience` value** for `/oauth/authorize` + `/oauth/token`? `FlynetOAuth` requires it, but the docs don't state it.
>
> Also, is there a way to fund the app wallet with FLY for testing? Thanks!
