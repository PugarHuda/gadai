# Blackbird Flynet integration notes (verified 2026-09-18)

Sources I read directly (no web search):
- Live docs index: https://flynet-dev-portal.mintlify.app/llms.txt (the same pages are served at https://docs.flynet.org/*.md)
- Full docs dump: https://flynet-dev-portal.mintlify.app/llms-full.txt (211 KB). Every "Source:" URL below comes from this file.
- npm `@flynetdev/core@0.8.1`: I read the dist `.d.ts` files (`client.d.ts`, `core/environments.js`, `auth/flynet-oauth.d.ts`, generated models).
- npm `@flynetdev/mcp@0.2.0`: ships `dist/resources/assets/openapi.yaml`, the OpenAPI 3.0.3 spec "Flynet API v1.0".
- npm `@flynetdev/skills@0.1.0`: `files/claude-skill/SKILL.md`, Blackbird's official agent rules.
- Dead hosts (no DNS): `docs.blackbird.xyz`, `developers.blackbird.xyz`, `flynet.blackbird.xyz`, `docs.flynet.xyz`. `www.blackbird.xyz/llms.txt` returns the SPA HTML, not an llms file.

## 1. Access (self-serve, no approval for staging)

- Sign up at https://make.flynet.org/ (HTTP 200) and create an app. You get a **staging** credential set immediately. Source: https://docs.flynet.org/resources/request-access
- Sign-up asks for: company/workspace name, one or two sentences on what you are building, and the exact OAuth redirect URI(s).
- The Make dashboard shows `client_secret` and the API key **once**. Copy them into `.env` right away.
- **Production** credentials require partner approval ("issued at production sign-off"). The docs say not to hard-code production URLs in public demos before approval. Source: https://docs.flynet.org/concepts/environments. **For the hackathon, use staging only.**
- Support: support@blackbird.xyz. Put "urgent" in the subject line if you are blocked.
- Sandbox: staging is the sandbox. There is no separate mock server.

## 2. Environments / base URLs (verified in docs and in the SDK `environments.js`)

| | Staging | Production |
|---|---|---|
| API | `https://api.staging.blackbird.xyz/flynet/v1` | `https://api.blackbird.xyz/flynet/v1` |
| OAuth | `https://api.staging.blackbird.xyz/oauth` (`/authorize`, `/token`) | `https://api.blackbird.xyz/oauth` |
| Consent UI | `https://passport.staging.flynet.org` | `https://passport.flynet.org` |
| JWT `iss` | `https://api-staging.blackbird.xyz` (hyphen) | `https://api.blackbird.xyz` |

Live probe: every staging route without credentials returns `401` plus `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`. The well-known URLs themselves return 404. **Unknown paths also return 401**, so a probe cannot tell you whether a route exists.

## 3. Credentials (two schemes, not interchangeable)

| Credential | Header | Routes |
|---|---|---|
| API key (`fly_test_…` staging / `fly_live_…` prod; the OpenAPI text says `bb_test_`/`bb_live_`, so the docs and spec disagree) | `X-API-Key` | `/restaurants*`, `/locations*`, `/check_ins` (venue feed, scope `read:checkins`), `/app` (`read:app`), `/balance` (`read:balance`), `/issue_reward` (`write:rewards`), `/challenges` (`read:restaurant_challenges`), `/specials` (`read:restaurant_specials`) |
| OAuth 2.0 + PKCE access token (JWT, 60 min; refresh token single-use, rotated, max 30 days) | `Authorization: Bearer` | `/users/me`, `/users/me/status` (`read:profile`), `/users/me/wallets` (`read:wallets`), `/users/me/check_ins` (`read:user_checkins`), `/users/me/tags` (`read:tags`), `/users/me/memberships` (`read:memberships`), all `/payment_intents*` |

Source: https://docs.flynet.org/concepts/api-keys and https://docs.flynet.org/concepts/authentication

- The Make dashboard sets API-key scopes per app ("pick your scopes"). Whether `write:rewards` is self-serve or needs a request is **UNVERIFIED**; check the dashboard.
- OAuth scope names differ by source. The live docs use `read:user_checkins`; SKILL.md and older SDK comments say `read:checkins`. **Follow the live docs.**
- There is **no documented OAuth scope for payment intents**. Any valid member token is accepted. **UNVERIFIED** whether staging enforces a hidden scope.
- `audience` is **required** by `FlynetOAuth`, but no doc gives its value. Recipes read it from `process.env.AUDIENCE`. Expect to find it in the Make dashboard or get it from support. **UNVERIFIED value.**
- The redirect URI must match exactly and be public, which rules out localhost. The docs recommend a reserved ngrok domain. `@flynetdev/tunnel` also exists (`flynet make` → `{bird}.local.make.flynet...`); I did not test it.

## 4. Packages (exact versions on npm today)

- `@flynetdev/core@0.8.1`: ESM, node>=20, deps `lossless-json`, `zod`. Exports `FlynetDiscoveryClient`, `FlynetMemberClient`, `FlynetOAuth`, `createPkcePair`, `formatFly`, `formatUsdCents`, `paginate`, `collectPages`, `FlynetError`, `SERVER_BY_ENV`, `AUTH_BASE_BY_ENV`.
- `@flynetdev/react@0.7.2`: `FlynetProvider`, `RestaurantList`, `RestaurantCard`, `LocationCard`, `OpenHoursBadge`, `NearbyLocations`, `UserPassport`, `RecentVisits`, `WalletBadge`, `CheckInFeed`, `ConnectWithBlackbird`, and hooks `useWallet`, `useCheckIns`, `usePassport`, `useVenueCheckIns`. The skill file says **"Pay-with-FLY" and "Payment Receipt" components are NOT built.**
- `@flynetdev/mcp@0.2.0`: local MCP server (`npx -y @flynetdev/mcp`). Env: `FLYNET_API_KEY` (or `API_KEY`), `FLYNET_ACCESS_TOKEN`, `FLYNET_ENV`, `FLYNET_SERVER_URL`. Tools are read-only: list/get restaurants, locations, check-ins, profile, wallets, memberships.
- `@flynetdev/skills@0.1.0`: agent skill plus Cursor rules. Docs MCP: `https://flynet-dev-portal.mintlify.app/mcp`.

## 5. Verified SDK surface (from `@flynetdev/core@0.8.1` `client.d.ts`)

```ts
import { FlynetDiscoveryClient, FlynetMemberClient, FlynetOAuth, formatFly } from "@flynetdev/core";

// Server-only, X-API-Key
const d = new FlynetDiscoveryClient({ apiKey: process.env.FLYNET_API_KEY! /* environment: "staging" default */ });
await d.restaurants.listRestaurants({ page: 0, pageSize: 50 }); // { restaurants, pagination }
await d.restaurants.getRestaurant({ id });
await d.restaurants.listRestaurantLocations({ id });
await d.locations.listLocations();                  // Location has paymentsEnabled, reservationsEnabled, reservationUrl, coordinate, address, timeZone
await d.locations.listLocationOpenHours({ id });
await d.checkIns.listVenueCheckIns({ location });   // anonymized venue feed (read:checkins)
await d.app.getApp();                               // { flynetMerchantId, allowedScopes, ... } (read:app)
await d.rewards.getBalance();                       // app wallet FLY balance (read:balance)
await d.rewards.issueReward({ userId, amount: { value: "1000000000000000000", currency: "FLY" }, description, idempotencyKey }); // write:rewards, IRREVERSIBLE
await d.challenges.listChallenges({ restaurant });  // required restaurant UUID
await d.specials.listSpecials({ restaurant });

// Member OAuth JWT (acts as that member)
const m = new FlynetMemberClient({ accessToken: async () => currentToken });
await m.getProfile();      // id == JWT sub == customer_user_id
await m.listWallets();     // { wallets:[MEMBERSHIP, SPENDING (with 0x address)], balance:{ balance:{value wei,currency:"fly"}, balanceUsd:{value cents} } }
await m.listCheckIns(); await m.listMemberships(); await m.getStatus();
const pi = await m.createPaymentIntent({ customerUserId, amount: { value, currency: "FLY" }, description, idempotencyKey }); // flynetMerchantId optional -> credits YOUR app's merchant
await m.confirmPaymentIntent({ id: pi.id, body: { userId: customerUserId } }); // verified in operations/confirm-payment-intent.d.ts
await m.getPaymentIntent({ id: pi.id });  // poll; no webhooks in v1

// OAuth (server): PKCE mandatory, 422 without it
const oauth = new FlynetOAuth({ clientId, clientSecret, redirectUri, audience, scopes: ["read:profile", "read:wallets"] });
const { url, state, codeVerifier } = await oauth.getAuthorizeUrl();
const tokens = await oauth.exchangeCode({ code, codeVerifier });
```

Raw REST equivalents (from the OpenAPI and doc pages): `POST /payment_intents` with body `{flynet_merchant_id, customer_user_id, amount:{value,currency:"FLY"}, description, idempotency_key, expires_at?, metadata?}` returns 201 (new) or 200 (idempotent replay). `POST /payment_intents/{id}/confirm` takes body `{user_id}`. `POST /issue_reward` takes body `{user_id, amount, description, idempotency_key, metadata?}` with `X-API-Key`.

## 6. Payment tools: what the docs actually allow

**Question:** can a third party initiate or settle a payment for a member at a restaurant?
**Answer: NO, not at an arbitrary restaurant.**
- A PaymentIntent moves FLY from the member's SPENDING wallet to the **payee merchant**. That merchant is `flynet_merchant_id`, issued **per partner (your app), per environment**, and "scoped to your client_id". The SDK says "omit it and the payment credits your own merchant." A merchant ID that belongs to anyone else returns 404 `resource_not_found "Flynet merchant not found"`. The API has no field for a restaurant or location payee. Sources: https://docs.flynet.org/concepts/payments and https://docs.flynet.org/recipes/mains/first-payment
- So the API lets **our app collect FLY from a member** (with the member's OAuth token) and lets **our app send FLY to a member** (`issue_reward`, from our app wallet). Paying the restaurant is something the member does inside the Blackbird app ("Blackbird Pay"). No partner API exists for that.
- v1 is FLY-only. There is no card funding and no auto-load. Confirm fails with 400 `payment0030` if the member lacks FLY. Refunds are full-only. There are no webhooks (poll instead) and no hosted checkout.
- The docs contradict themselves on rewards. The recipe page https://docs.flynet.org/recipes/specials/reward-fly says "Coming soon", but the API reference https://docs.flynet.org/api-reference/rewards/issue and SDK 0.8.1 (`rewards.issueReward`) document `POST /issue_reward` as live. IDEAS.md already flagged `write:rewards` access as unclear. **Treat it as live but gated by scope. Verify on day 1 with `getApp().allowedScopes`.**
- Confirm uses the member's bearer token and `user_id`, and needs no extra member click. A backend holding the member's refresh token (up to 30 days, rotating) can therefore create and confirm intents from the member's wallet to our merchant. This is how Gadai would collect repayment in FLY. Whether Blackbird considers this acceptable UX or policy is **UNVERIFIED**. Every confirm sends the member a receipt email.

## 7. Recommended real design for "Dine on your fees" (only documented calls)

1. Borrower connects Blackbird via OAuth (`read:profile read:wallets read:user_checkins`). We store `sub` and the refresh token server-side.
2. The dining agent recommends venues with `listLocations`, filtered **client-side** to `paymentsEnabled && reservationsEnabled`, dropping `coordinate {0,0}`. It adds `listLocationOpenHours`, `listSpecials` / `listChallenges` for the chosen restaurant, and the member's `listCheckIns` / `listMemberships` for personalization. The Bankr LLM writes the pick.
3. **Draw:** after the underwriter approves a dining line against pledged fees, the backend calls `rewards.issueReward({ userId: sub, amount, idempotencyKey: "draw-<loanId>-<n>" })`. FLY lands in the member's SPENDING wallet, and the member pays at the restaurant in the Blackbird app. We record the draw as added debt on the loan, and the FeeVault fee stream repays it (in USDC, on-chain on Base, through our own accounting).
4. **Optional FLY-side settlement:** if the member has leftover FLY at loan close, `createPaymentIntent` + `confirmPaymentIntent` (to our own merchant) pulls it back to the app wallet and reduces debt.
5. Show `UserPassport`, `WalletBadge`, and `RecentVisits` from `@flynetdev/react` in the borrower view.

Env vars (server-only unless noted):
```
FLYNET_ENV=staging
FLYNET_API_KEY=fly_test_...            # Discovery + rewards (scopes: read:app read:balance write:rewards read:checkins read:restaurant_specials read:restaurant_challenges)
FLYNET_CLIENT_ID=...                   # public
FLYNET_CLIENT_SECRET=...
FLYNET_REDIRECT_URI=https://<reserved>.ngrok-free.app/api/flynet/callback
FLYNET_AUDIENCE=...                    # value from Make dashboard/support (undocumented)
FLYNET_MERCHANT_ID=...                 # optional; GET /app returns it
```
Fail loudly if any value is missing. Never mock. Do not send the API key, `client_secret`, or merchant ID to the browser.

## 8. Gotchas

- Unknown query params are silently ignored. Server-side filters on `/restaurants` (`cuisine`, `cohort`) and `/locations` (`restaurant`, `neighborhood`, `payments_enabled`, `is_club`) are **not implemented**, so filter client-side. `/restaurants/{id}/locations` works for per-brand lists.
- Pagination: `page` is 0-indexed, `page_size` defaults to 50, and `next_page` is null on the last page. `open_hours` has no pagination wrapper.
- Some brands have no locations (`locations: []`), so guard before indexing.
- 401 bodies are empty and the reason is in `WWW-Authenticate`. Only an *invalid* API key returns a JSON body (`invalid_api_key`). A wrong scope returns 403, not 404.
- Money comes as wei strings (18 decimals). Use `formatFly` / BigInt and never floats. `balance_usd` is integer cents. Currency casing varies (`fly` vs `FLY`).
- `/users/me/status` returns 404 when the member has no status.
- `/users/{id}/*` paths are gone. Use `/users/me/*` only.
- `created_after` / `created_before` take ISO-8601, not epoch.
- The FLY on-chain network is **UNVERIFIED**. Wallets have 0x addresses, and https://explorer.flynet.org ("Flynet | Explorer") exists, but I found no chain ID, and I found no way to fund an app wallet with FLY (e.g. from USDC). The docs only say "top up before issuing." **Ask support@blackbird.xyz how to fund the staging app wallet with FLY.** This blocks step 3 until it is answered.

## 9. NOT possible (per docs)

- Paying a restaurant or location directly from our app or agent, or choosing an arbitrary merchant as payee.
- Card-funded payments, auto-loading FLY, USDC-denominated intents, partial refunds, webhooks, hosted checkout.
- Reading another member's data. Enumerating members (the `/check_ins` feed is anonymized).
- Server-side cuisine or geo filtering.
- Production traffic without partner approval.
- React "Pay with FLY" / receipt components (not built).

## 10. [flynet2] Production app "hackathon 2" (verified live 2026-09-19)

- `GET /app` (production, `x-api-key`) returns:
  - name: `hackathon 2`
  - client id: `ba3ca201-5d5c-4a51-bbdb-f905df5ca146`
  - `allowed_scopes`: `read:profile read:wallets read:user_checkins read:checkins read:app read:balance read:restaurant_specials read:restaurant_challenges write:save_to_list read:memberships read:tags`

  The response is captured in `agent/src/flynet/fixtures/app.json`.
- **OAuth scopes requested** (`SCOPES` in `agent/src/flynet/index.ts`): `read:profile read:wallets read:user_checkins read:memberships read:tags write:save_to_list`.
- **Blackbird accepts the authorize request.** This request returns **302 → `https://passport.flynet.org/authorize?flow_id=<uuid>`**, which is the member login:
  `GET https://api.blackbird.xyz/oauth/authorize?response_type=code&client_id=…&redirect_uri=https%3A%2F%2Faqua-economic-moss-modes.trycloudflare.com%2Fapi%2Fflynet%2Fcallback&scope=<the 6 scopes>&state=…&code_challenge=<S256>&code_challenge_method=S256`
  Leave `audience` out. The SDK adds an empty one, and the agent removes it.
- **A scope the app lacks makes the whole request fail. It is not silently dropped.** With `scope=write:rewards`, Blackbird redirects (302) to our callback with `?error=invalid_request&state=…`. So `SCOPES` must stay a subset of `allowed_scopes`. A test checks this against the fixture.
- **The token endpoint gives a proper error for a bogus code:** `POST https://api.blackbird.xyz/oauth/token` (form fields `grant_type=authorization_code`, code, redirect_uri, client_id, client_secret, code_verifier) returns `400 {"error":"invalid_grant","error_description":"Invalid or expired authorization code."}`. The lead also verified that `client_secret` is required, so the exchange stays server-side.
- **Granted scopes are in the access token's JWT `scope` claim.** `tokenScopes()` reads it. If a member logged in before a scope was added, the agent shows a note ("log out and log in again") rather than getting a 403.

### Member routes used (shapes come from the OpenAPI; no response has been captured with a member token yet)
- `GET /users/me/memberships?page=&page_size=100` (`read:memberships`) returns one card per restaurant: `restaurant_id`, `check_in_count`, `last_check_in_date` and `membership_tier{name, asset}`. The filter parameter is `restaurant`, not `restaurant_id`.
  - Ranking: a brand where the member holds a card gets +2, and the reason names the card: `you hold a Blackbird "VIP" membership at X (7 check-ins on the card)`.
  - With "somewhere new", a card lowers the score instead.
  - The tier name is the only perk information Flynet exposes.
- `GET /users/me/tags` (`read:tags`): the only tag type is `industry`, with metadata such as `Employer: ["FLYBAR"]` for restaurant staff. **Tags describe employers, not tastes.** They only add the reason "your Blackbird industry tag lists X as your employer" and do not change the score.
- `member_openapi_examples.json` holds the OpenAPI examples word for word, with `captured_on: null`. Replace it with real captures after the first member login.

### Network activity without a member (`read:checkins`, API key)
- `GET /check_ins` is the anonymized feed for all of Blackbird: about 7.17M rows in total, about 142k per 7 days. Each item embeds the full `location` and has no `user`. `page_size` works up to at least 1000.
- **A venue's 7-day count** is the `pagination.total_count` of `GET /check_ins?location=<id>&created_after=<ISO, now-7d>&page_size=1`, which takes about 2 s. Example: Bareburger UES has 179.
  - These counts feed the concierge ranking: +2 × count / the busiest venue on the shortlist, with the reason "N Blackbird check-ins here in the last 7 days".
  - They are cached for 1 hour.
- **Trending** (`GET /api/flynet/trending?region=`) takes the latest 500 check-ins from the last 2 hours and groups them by venue. It keeps the top 8 and orders them by their 7-day count. The result is cached for 10 minutes.
  - The unfiltered feed takes 4 to 11 s. With `created_after` it takes 4 to 5 s. The call has a 30 s timeout.
- **Rate limits:** a cold plan loads about 34 catalog pages, then 12 opening-hours reads, 12 weekly counts, 6 specials and 6 challenges. That burst triggers 429 `Rate limit exceeded. Retry after 1 seconds.` `flyGet` now retries up to 3 times, waiting 1, 2 and 3 s. After that it reports the failure in `notes`.
- **Test data check (2026-09-19):** none of the 1,675 live locations has test, demo, sandbox, fake, sample or staging in its name. 30 locations have the `{0,0}` "unknown" coordinate, which the agent already maps to null.

### write:save_to_list: the scope is granted but the endpoint is not published
The app holds the scope, but **no endpoint for it is documented anywhere**. Checked on 2026-09-19:
- the Flynet OpenAPI 1.0 (docs.flynet.org/api-reference/openapi.yaml)
- `@flynetdev/core@0.8.1` (the latest version)
- `@flynetdev/mcp@0.2.0`
- `@flynetdev/skills@0.1.0`
- `@flynetdev/react@0.7.2`
- the docs MCP (`grep -ri save` across every page)
- llms-full.txt

Probing guessed paths tells you nothing: every unknown `/flynet/v1/*` path returns 403 `forbidden` with an API key and 401 without one. The official SKILL.md says "never invent endpoints".

What the code does now:
- `POST /api/loans/:id/dine/save {session, restaurantId}` checks the input, the member session and the token's `write:save_to_list` scope, then returns **501** with the reason.
- The "Save to my Blackbird list" button on the web is disabled and shows that reason.
- Once support@blackbird.xyz names the route, flip `SAVE_TO_LIST` and add the call.

### Human steps to finish the member login demo
Before you start, check all of these:
- The agent runs this code behind the tunnel `https://aqua-economic-moss-modes.trycloudflare.com`. That is the host in `FLYNET_REDIRECT_URI`, so `/api/flynet/callback` must reach this agent.
- The agent has `WEB_URL=https://gadai-six.vercel.app`.
- The Vercel web app's `NEXT_PUBLIC_AGENT_URL` points at the same agent.
- Loan N exists in that agent's database.

Then:
1. Open `https://gadai-six.vercel.app/dine/N`.
2. In the "Blackbird passport" card, click **Log in with Dynamic first** and log in with the **borrower** wallet of loan N.
3. Click **Log in with Blackbird**. The wallet asks you to sign `Gadai: link my Blackbird account to loan N\nNonce: <uuid>`. Click **Sign**.
4. The browser goes through the agent's `/api/flynet/connect`, then `api.blackbird.xyz/oauth/authorize`, and lands on `passport.flynet.org/authorize?flow_id=…`.
5. On passport.flynet.org, log in with a real Blackbird member account, using whatever the page asks for (phone or email code). Review the consent for the 6 scopes and approve it. I have not seen this page's exact labels, because reaching it needs a real account. Finish within **10 minutes**, because the OAuth state expires after that.
6. Blackbird redirects to the callback. The agent exchanges the code server-side and redirects to `https://gadai-six.vercel.app/dine/N#member=<session>`.
7. Check the result:
   - The passport shows the member's name, FLY balance, check-ins, **membership cards** and **tags**.
   - Asking the concierge gives a plan whose header says "personalized with your check-ins and membership cards".
   - Cards show "your card: <tier>" where the member holds a card.
   - Each card has a disabled "Save to my Blackbird list" button with the reason.
