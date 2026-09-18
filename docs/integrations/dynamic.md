# Dynamic integration notes (Fee Desk)

Researched 2026-09-18. Every item below is taken from the official docs or from the published npm `.d.ts` typings, and the source is linked. Anything not verified that way is marked **UNVERIFIED**.

Docs index: https://www.dynamic.xyz/docs/llms.txt · Node section: https://www.dynamic.xyz/docs/node/llms.txt · React section: https://www.dynamic.xyz/docs/react/llms.txt
Docs MCP (optional): `claude mcp add --transport http dynamic https://www.dynamic.xyz/docs/mcp`

## Where Dynamic fits in Fee Desk

| Role | Dynamic product | Why |
|---|---|---|
| Underwriter agent: decides, then disburses USDC and runs keeper txs (collectFees, swaps, release) | **Agent wallet** (Node SDK + **agent signing token**, fully autonomous) | This is the documented "agent makes a decision, then acts with its wallet" pattern: the agent signs in with its own secp256k1 key, mints its own user JWT, and signs with an MPC wallet it owns as a Dynamic user |
| Borrowers, lenders and followers in the web app | **Embedded wallets** (React SDK `@dynamic-labs/sdk-react-core` + `@dynamic-labs/ethereum`) | Log in with email/social or an external wallet, then sign the pledge `updateBeneficiary(poolId, FeeVault)`, CCA bids, and so on |
| Optional: follower auto-mirror ("Follow the Desk") | **Delegated access** | A user approves, the server receives that user's key share by webhook, and the server signs mirror trades for the user |

## Packages and versions (npm registry, checked 2026-09-18)

| Package | Latest | Peer deps |
|---|---|---|
| `@dynamic-labs-wallet/node-evm` | 1.1.13 | `viem ^2.45.3` (a required peer, so install it yourself) |
| `@dynamic-labs-wallet/node` | 1.1.13 | none (auth client, session keys, delegated helpers) |
| `@dynamic-labs-wallet/core` | 1.1.13 | none (`ThresholdSignatureScheme`, also re-exported from `@dynamic-labs-wallet/node`) |
| `@dynamic-labs/sdk-react-core` | 5.9.0 | `react >=18 <20`, `react-dom >=18 <20` |
| `@dynamic-labs/ethereum` | 5.9.0 | `viem ^2.45.3` |
| `@dynamic-labs/wagmi-connector` (optional) | 5.9.0 | wagmi ^2, @tanstack/react-query |

Upgrade all `@dynamic-labs-wallet/*` packages together; majors do not interoperate (https://www.dynamic.xyz/docs/node/reference/upgrade/v1.md). The agent-wallet flow needs `@dynamic-labs-wallet/node` >= 1.0.71 (https://www.dynamic.xyz/docs/node/agents/overview.md).

```bash
# agent / keeper service (MUST run on Linux or macOS, see Gotcha 1)
pnpm add @dynamic-labs-wallet/node-evm @dynamic-labs-wallet/node @dynamic-labs-wallet/core viem
# web app
pnpm add @dynamic-labs/sdk-react-core @dynamic-labs/ethereum viem
```

pnpm 10+ skips build scripts by default. The quickstart therefore adds `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` to package.json so `tsx` works (https://www.dynamic.xyz/docs/node/quickstart.md).

## Env vars

| Var | Used by | Source |
|---|---|---|
| `DYNAMIC_ENVIRONMENT_ID` | agent (Node) | Developer Console → Developer → API |
| `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` | web app | same value |
| `AGENT_SIGNING_TOKEN` | agent. A 0x 32-byte secp256k1 private key. It **is** the agent's Dynamic user identity. | Generate once with `viem/accounts` `generatePrivateKey()` |
| `DYNAMIC_SESSION_KEY_JWK` | agent. The JSON of the P-256 `privateKeyJwk` from `generateSessionKeyPair()`. | Generate once. The SDK stores nothing, so we must persist it. |
| `DYNAMIC_SESSION_PUBLIC_KEY_HEX` | agent. The `publicKeyHex` from the same `generateSessionKeyPair()` call. | Generate once. |
| `DYNAMIC_WALLET_PASSWORD` | agent. Required when `backUpToDynamic: true`. | Our choice. If lost, the backup cannot be decrypted. |
| `DYNAMIC_AGENT_WALLET_METADATA` | agent. JSON `walletMetadata` returned by `createWalletAccount`. | Persist the whole object, because it contains `externalServerKeySharesBackupInfo`. |
| `DYNAMIC_AGENT_KEY_SHARES` | agent. JSON `externalServerKeyShares`. | Secret. |
| `DYNAMIC_APP_ORIGIN` | agent. The origin SIWE sign-in presents; it must be on the environment's CORS allowlist. | Our web app URL |
| `DYNAMIC_AUTH_TOKEN` | only for the API-token server-wallet path or delegated access | Developer Console API token (server-only) |
| `DYNAMIC_WEBHOOK_SECRET`, `DYNAMIC_DELEGATION_PRIVATE_KEY` | only for delegated access | Console webhook page; RSA key pair (`openssl genrsa -out private-key.pem 3072`) |

In our code, every variable above is read through a `requireEnv()` that throws a clear message when the variable is missing. There are no mocks.

## Dashboard setup (access and approval requirements)

1. Create an environment at https://console.dynamic.xyz and copy its environment ID.
2. **Enable embedded wallets** for the environment. For server wallets, also enable "multiple embedded wallets per chain" at https://console.dynamic.xyz/dashboard/embedded-wallets/dynamic (https://www.dynamic.xyz/docs/node/wallets/server-wallets/overview.md).
3. **Enable external wallet auth** under auth methods. SIWE sign-in with the agent signing token requires it (https://www.dynamic.xyz/docs/node/agents/overview.md, "Before you start"). Enable email/social for human borrowers.
4. **Enable Base (8453)** at https://console.dynamic.xyz/dashboard/chains-and-networks, optionally with a custom RPC (https://www.dynamic.xyz/docs/react/chains/enabling-chains.md).
5. **Add the web origin** (for example http://localhost:3000 and the deployed URL) to the allowlisted CORS origins. `appOrigin` must be on this list.
6. The environment must use **header-based JWTs, not cookie-based auth**. The agent flow throws when cookie auth is on (sign-in page and refresh docs).
7. Delegated access only: go to Embedded Wallets → Delegated Access, turn it on, upload the RSA public key, and register an HTTPS webhook URL (https://www.dynamic.xyz/docs/overview/wallets/embedded-wallets/mpc/delegated-access/configuration.md).
8. There is no approval queue for the free sandbox. Pricing is listed at https://www.dynamic.xyz/pricing?tab=onchain-automation. **UNVERIFIED:** free-tier limits for MPC wallet ops.
9. **EVM gas sponsorship (`sendSponsoredTransaction`) is enterprise-only** (https://www.dynamic.xyz/docs/node/wallets/server-wallets/gas-sponsorship-evm.md). We do not use it. The agent wallet must hold Base ETH for gas.

## 1. Underwriter agent wallet: autonomous agent signing token (Node)

Sources:
- https://www.dynamic.xyz/docs/node/agents/sign-in-with-a-private-key.md
- https://www.dynamic.xyz/docs/node/agents/use-agent-wallets.md
- https://www.dynamic.xyz/docs/node/agents/example-usage.md ("Private key (autonomous agent)" tab)
- Typings: `@dynamic-labs-wallet/node-evm@1.1.13` `src/client/client.d.ts` and `@dynamic-labs-wallet/node@1.1.13` `src/index.d.ts`, `src/authClient.d.ts`

Verified exports:
- `@dynamic-labs-wallet/node`: `createAuthClient`, `generateSessionKeyPair`, `signSessionMessage`, `ThresholdSignatureScheme`, `decryptDelegatedWebhookData`, `createDelegatedWalletClient`, `revokeDelegation`
- `@dynamic-labs-wallet/node-evm`: `DynamicEvmWalletClient`, `createDelegatedEvmWalletClient`, `delegatedSignMessage`, `delegatedSignTransaction`, `delegatedSignTypedData`
- `DynamicEvmWalletClient` methods: `authenticateJwt(jwt, { getSessionSignature })`, `authenticateApiToken(token)`, `refreshAuthToken(): Promise<string>`, `createWalletAccount({ thresholdSignatureScheme, password?, onError?, backUpToDynamic? })`, `signMessage({ message, walletMetadata, password?, externalServerKeyShares? })`, `signTransaction({ walletMetadata, transaction: TransactionSerializable, password?, externalServerKeyShares? }): Promise<string>`, `signTypedData({ walletMetadata, typedData, ... })`, `getWalletClient({ walletMetadata, password?, externalServerKeyShares?, chain?, chainId?, rpcUrl? }): Promise<viem WalletClient>`, `createViemPublicClient({ chain, rpcUrl? })`
- `auth.wallet.signIn({ address, signMessage, sessionPublicKey?, statement? })` resolves to `{ jwt, expiresAt, userId }`

### One-time bootstrap (run once, then store the output in `.env`)

```ts
// scripts/dynamic-bootstrap.ts  (run on Linux/WSL: npx tsx --env-file=.env scripts/dynamic-bootstrap.ts)
import { generatePrivateKey } from 'viem/accounts';
import { generateSessionKeyPair } from '@dynamic-labs-wallet/node';

const agentSigningToken = process.env.AGENT_SIGNING_TOKEN ?? generatePrivateKey();
const { publicKeyHex, privateKeyJwk } = await generateSessionKeyPair();
console.log('AGENT_SIGNING_TOKEN=' + agentSigningToken);
console.log('DYNAMIC_SESSION_KEY_JWK=' + JSON.stringify(privateKeyJwk));
console.log('DYNAMIC_SESSION_PUBLIC_KEY_HEX=' + publicKeyHex);
```

If a different `AGENT_SIGNING_TOKEN` is generated later, the agent becomes a **new** Dynamic user and loses access to the old wallets.

### Runtime client (sign in, then create the wallet once or reuse it, then get a viem wallet client on Base)

```ts
import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm';
import { createAuthClient, signSessionMessage, ThresholdSignatureScheme } from '@dynamic-labs-wallet/node';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k} (see .env.example)`); return v; };

export async function getAgentWallet() {
  const environmentId = need('DYNAMIC_ENVIRONMENT_ID');
  const privateKeyJwk = JSON.parse(need('DYNAMIC_SESSION_KEY_JWK')) as JsonWebKey;
  const publicKeyHex = need('DYNAMIC_SESSION_PUBLIC_KEY_HEX'); // saved together with the JWK at bootstrap
  const agent = privateKeyToAccount(need('AGENT_SIGNING_TOKEN') as `0x${string}`);
  const auth = createAuthClient({ environmentId, appOrigin: need('DYNAMIC_APP_ORIGIN') });

  const signIn = () => auth.wallet.signIn({
    address: agent.address,
    signMessage: (message) => agent.signMessage({ message }),
    sessionPublicKey: publicKeyHex,            // REQUIRED, or backUpToDynamic calls fail
    statement: 'Fee Desk underwriter agent sign-in',
  });

  const client = new DynamicEvmWalletClient({ environmentId, enableMPCAccelerator: false });
  const getSessionSignature = (m: string) => signSessionMessage(m, privateKeyJwk);
  await client.authenticateJwt((await signIn()).jwt, { getSessionSignature });

  const password = need('DYNAMIC_WALLET_PASSWORD');
  let walletMetadata = process.env.DYNAMIC_AGENT_WALLET_METADATA && JSON.parse(process.env.DYNAMIC_AGENT_WALLET_METADATA);
  let externalServerKeyShares = process.env.DYNAMIC_AGENT_KEY_SHARES && JSON.parse(process.env.DYNAMIC_AGENT_KEY_SHARES);
  if (!walletMetadata) {
    // First run only. Print these values and store them, otherwise the next run creates a NEW wallet.
    ({ walletMetadata, externalServerKeyShares } = await client.createWalletAccount({
      thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO, password, backUpToDynamic: true,
    }));
    console.log('DYNAMIC_AGENT_WALLET_METADATA=' + JSON.stringify(walletMetadata));
    console.log('DYNAMIC_AGENT_KEY_SHARES=' + JSON.stringify(externalServerKeyShares));
  }

  const walletClient = await client.getWalletClient({
    walletMetadata, externalServerKeyShares, password,
    chain: base,   // or { chainId: 8453, rpcUrl } / an Anvil fork RPC in DEMO_FORK
  });
  return { client, walletClient, walletMetadata, signIn, getSessionSignature };
}
```

The session public key comes from `generateSessionKeyPair()` and is stored as `DYNAMIC_SESSION_PUBLIC_KEY_HEX` (33-byte compressed P-256, lowercase hex). Bind it at every sign-in.

### Disbursing USDC after the credit decision (Dynamic track "decision, then payment action")

```ts
import { erc20Abi, parseUnits } from 'viem';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC on Base (address appears in Dynamic gas-sponsorship doc)
const { walletClient } = await getAgentWallet();
const hash = await walletClient.writeContract({
  address: USDC_BASE, abi: erc20Abi, functionName: 'transfer',
  args: [borrower, parseUnits(String(approvedUsdc), 6)],
});
```

The same `walletClient` handles the keeper txs (`FeeVault.harvest()`, Uniswap swap calldata via `sendTransaction({to,data,value})`, `release()`). Per https://www.dynamic.xyz/docs/node/wallets/server-wallets/viem-wallet-client.md, the returned client supports "all standard Viem wallet client methods including signMessage, signTypedData, sendTransaction". `writeContract` is a standard viem wallet action. **UNVERIFIED:** whether `writeContract` works end to end on this account adapter. If it does not, the documented fallback is `encodeFunctionData` + `sendTransaction`, or `publicClient.prepareTransactionRequest` → `client.signTransaction` → `sendRawTransaction` (https://www.dynamic.xyz/docs/node/evm/sign-transactions.md).

Uniswap Trading API `/swap` may return a Permit2 EIP-712 payload. The agent signs it with `walletClient.signTypedData(...)` (documented on the same page).

### Session refresh (long-running keeper)

```ts
try { await client.refreshAuthToken(); }
catch { await client.authenticateJwt((await signIn()).jwt, { getSessionSignature }); } // past refreshExp: programmatic re-sign-in, no human needed
```

Schedule the refresh before `expiresAt` (https://www.dynamic.xyz/docs/node/agents/use-agent-wallets.md). The simplest approach for a keeper loop is to re-sign in on every tick or on any 401.

### Alternative: plain server wallet via API token (simpler, but not the "agent" pattern)

`new DynamicEvmWalletClient({ environmentId })` → `await client.authenticateApiToken(process.env.DYNAMIC_AUTH_TOKEN)`, then the same `createWalletAccount` / `getWalletClient` calls. The wallet then belongs to the developer account instead of a Dynamic user (https://www.dynamic.xyz/docs/overview/agents/overview.md). Keep this as the fallback if SIWE sign-in setup blocks us.

## 2. Web app: embedded wallets for borrowers, lenders and followers (React SDK in Next.js)

Sources:
- https://www.dynamic.xyz/docs/react/reference/quickstart.md
- https://www.dynamic.xyz/docs/react/wallets/using-wallets/evm/send-a-transaction.md
- The official Next.js example that uses `@dynamic-labs/sdk-react-core`: https://github.com/dynamic-labs-oss/examples/tree/main/examples/nextjs-delegated-access (`lib/providers.tsx`, `next.config.ts`)

```tsx
// app/providers.tsx
'use client';
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core';
import { EthereumWalletConnectors } from '@dynamic-labs/ethereum';

const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;
if (!envId) throw new Error('Missing NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID (see .env.example)');

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <DynamicContextProvider settings={{ environmentId: envId, walletConnectors: [EthereumWalletConnectors] }}>
      {children}
    </DynamicContextProvider>
  );
}
// app/layout.tsx: <body><Providers>{children}</Providers></body>
```

```tsx
// Pledge fee rights: borrower moves the beneficiary share to FeeVault
'use client';
import { DynamicWidget, useDynamicContext } from '@dynamic-labs/sdk-react-core';
import { isEthereumWallet } from '@dynamic-labs/ethereum';

export function PledgeButton({ feesManager, poolId, feeVault }: { feesManager: `0x${string}`; poolId: `0x${string}`; feeVault: `0x${string}` }) {
  const { primaryWallet } = useDynamicContext();
  if (!primaryWallet || !isEthereumWallet(primaryWallet)) return <DynamicWidget />;
  const pledge = async () => {
    await primaryWallet.switchNetwork(8453);  // UNVERIFIED method name for sdk-react-core v5; alternative: useSwitchNetwork hook (docs: /react/reference/hooks/useswitchnetwork)
    const walletClient = await primaryWallet.getWalletClient();
    const publicClient = await primaryWallet.getPublicClient();
    const hash = await walletClient.writeContract({
      address: feesManager,
      abi: [{ type: 'function', name: 'updateBeneficiary', stateMutability: 'nonpayable',
              inputs: [{ name: 'poolId', type: 'bytes32' }, { name: 'newBeneficiary', type: 'address' }], outputs: [] }],
      functionName: 'updateBeneficiary', args: [poolId, feeVault],
      account: primaryWallet.address as `0x${string}`, chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  };
  return <button onClick={pledge}>Pledge fees to Fee Desk</button>;
}
```

Verified: `useDynamicContext()` → `{ primaryWallet, user, handleLogOut }`, `isEthereumWallet` from `@dynamic-labs/ethereum`, `primaryWallet.getWalletClient()`, `primaryWallet.getPublicClient()`, `walletClient.sendTransaction(...)`, `primaryWallet.getNetwork()`, `<DynamicWidget />`.
**UNVERIFIED:** whether `writeContract` needs the `chain`/`account` args as shown (it is standard viem; the docs only demonstrate `sendTransaction`).

## 3. Optional: delegated access for "Follow the Desk" auto-mirroring

Client side: `useWalletDelegation()` from `@dynamic-labs/sdk-react-core` (v4.37.0+) → `initDelegationProcess()`, `getWalletsDelegatedStatus()`, `delegateKeyShares()`, `revokeDelegation()` (https://www.dynamic.xyz/docs/react/reference/hooks/embedded-wallets/usewalletdelegation.md).

Server side: the webhook `wallet.delegation.created` carries `data.{walletId, publicKey (address), userId, encryptedDelegatedShare, encryptedWalletApiKey}`. Verify the header `x-dynamic-signature-256`, which is `sha256=` followed by HMAC-SHA256(secret, JSON body), then:

```ts
import { decryptDelegatedWebhookData } from '@dynamic-labs-wallet/node';
import { createDelegatedEvmWalletClient, delegatedSignTransaction } from '@dynamic-labs-wallet/node-evm';
const { decryptedDelegatedShare, decryptedWalletApiKey } = decryptDelegatedWebhookData({
  privateKeyPem: need('DYNAMIC_DELEGATION_PRIVATE_KEY').replace(/\\n/g, '\n'),
  encryptedDelegatedKeyShare: body.data.encryptedDelegatedShare,
  encryptedWalletApiKey: body.data.encryptedWalletApiKey,
});
const dc = createDelegatedEvmWalletClient({ environmentId: need('DYNAMIC_ENVIRONMENT_ID'), apiKey: need('DYNAMIC_AUTH_TOKEN') });
const signed = await delegatedSignTransaction(dc, { walletId, walletApiKey: decryptedWalletApiKey, keyShare: decryptedDelegatedShare, transaction /* full TransactionSerializable incl. chainId 8453, nonce, gas, fees */ });
await publicClient.sendRawTransaction({ serializedTransaction: signed as `0x${string}` });
```

Sources: https://www.dynamic.xyz/docs/react/wallets/embedded-wallets/mpc/delegated-access/receiving-delegation.md and https://www.dynamic.xyz/docs/node/evm/delegated-access.md.

Delegated access only works for Dynamic **embedded (MPC) wallets**, not for MetaMask-type external wallets. It also needs a public HTTPS webhook, so localhost will not do; use a tunnel or the deployed URL. Treat it as a stretch goal. The core Dynamic track story is covered by sections 1 and 2.

## Gotchas

1. **The Node MPC SDK does NOT run on Windows.** The package ships native addons only for `linux_arm64`, `linux_x86_64`, `macos_arm64` and `macos_x86_64` (checked inside `@dynamic-labs-wallet/node@1.1.13/internal/node/native/`). The docs say "Linux (x64/arm64) or macOS (arm64)… not browsers, edge runtimes, Deno, Bun". On this machine, run the agent/keeper in **WSL Ubuntu** (installed) or **Docker** (installed, v29.5.3). In Next.js, never import it in edge routes; keep it in a separate Node service or set `serverExternalPackages: ['@dynamic-labs-wallet/node','@dynamic-labs-wallet/node-evm']` (as the official example does) and deploy those routes to a Linux Node runtime.
2. `enableMPCAccelerator: false` everywhere except AWS Nitro hosts. Otherwise creation fails with `SessionAttestationError`.
3. **The SDK is stateless (V1).** Persist the full `walletMetadata` from `createWalletAccount`. `fetchWalletMetadata` does NOT return `externalServerKeySharesBackupInfo`, and signing then throws `MissingBackupInfoError`. Calling `createWalletAccount` on every run creates a new wallet each time.
4. **The docs page for `getWalletClient` is stale.** It shows `{ accountAddress }`, but the V1 typings require `{ walletMetadata }`. Use `walletMetadata`.
5. `password` is required whenever `backUpToDynamic: true`.
6. `sessionPublicKey` must be passed at sign-in, and `getSessionSignature` must return lowercase hex r||s. `signSessionMessage` already does this; base64 breaks the proof.
7. `appOrigin` must be on the CORS allowlist, and cookie-based auth must be off. The headless client does not support MFA.
8. Gas: the agent wallet and the borrower wallets need Base ETH. Dynamic gas sponsorship is enterprise-only.
9. **Pledge signer:** only the current beneficiary can call `updateBeneficiary`. For a Bankr-launched token, the beneficiary is usually the creator's **Bankr wallet**, which a Dynamic embedded wallet cannot sign for. Dynamic login covers creators whose beneficiary is an external EOA; `EthereumWalletConnectors` includes injected wallets such as MetaMask. Bankr-wallet creators must pledge via Bankr's `POST /public/doppler/build-transfer-beneficiary` + Bankr signing. The UI should support both paths.
10. For new React apps Dynamic now recommends the JS SDK (`@dynamic-labs-sdk/react-hooks`). `@dynamic-labs/sdk-react-core` is labeled legacy but is still published (5.9.0) and documented. We keep it because the task asks for it and the delegated-access hook lives there.
11. Vite needs `define: { 'process.env': {}, global: 'globalThis' }`. Next.js needs `'use client'` on the provider, and the example also adds `config.externals.push('pino-pretty','lokijs','encoding')`.

## DEMO_FORK (Anvil fork of Base)

- Agent: `getWalletClient({ walletMetadata, externalServerKeyShares, password, chainId: 8453, rpcUrl: 'http://127.0.0.1:8545' })`. The `chainId` + `rpcUrl` form is documented for custom chains. MPC signing is done by Dynamic's relay, and broadcasting goes to our RPC, so signing against a fork should work, but it still needs internet plus the Dynamic backend. **UNVERIFIED** end to end on Anvil. Fund the agent address on the fork with `anvil_setBalance` and a USDC `anvil_setStorageAt` / whale impersonation.
- Browser embedded wallet on a fork: this needs a custom EVM network override in `DynamicContextProvider` settings (docs: /react/chains/adding-custom-networks, not read in detail), so it is **UNVERIFIED**. For the demo, prefer the real Base network in the browser, or sign pledge txs on the fork with `cast send --unlocked` (impersonation), clearly labeled.

## What is NOT possible / not documented

- There is no Windows-native Node MPC SDK. There is no browser or edge use of `@dynamic-labs-wallet/node*`.
- There is no built-in spending policy or limit enforcement in the agent flow that we found. Policies exist as a separate feature (overview/wallets/embedded-wallets/mpc/policies, not read), so enforce loan caps in our own code or contracts.
- `getWallets()` does not return key shares (its `externalServerKeyShares` is always `[]`), so wallets cannot be recovered by lookup.
- Gas sponsorship requires the enterprise plan.
- Delegated access requires a public HTTPS webhook and embedded (MPC) wallets only.
- The Dynamic docs do not say that an agent JWT user can see or operate wallets created in the browser by the same human. We do not rely on this.
