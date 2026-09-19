import { ENV } from "./env";

/** Call the Gadai agent REST API. Throws the agent's `{error}` message on non-2xx. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T> {
  if (!ENV.AGENT_URL) throw new Error("Missing env NEXT_PUBLIC_AGENT_URL (see .env.example)");
  const r = await fetch(ENV.AGENT_URL + path, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers: { ...(init?.body === undefined ? {} : { "content-type": "application/json" }), ...init?.headers },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  }).catch((e) => {
    throw new Error(`Agent unreachable at ${ENV.AGENT_URL} (${(e as Error).message})`);
  });
  const text = await r.text();
  let j: unknown = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!r.ok) throw new Error((j as { error?: string } | null)?.error ?? `${r.status} ${text.slice(0, 200)}`);
  return j as T;
}

/** Base Doppler tokens where `wallet` is the fee beneficiary (agent proxies Bankr creator-fees with its rate-limit cache). */
export type CreatorToken = { token: string; symbol: string; name: string; sharePct: number; claimableWeth: number };
export const creatorTokens = (wallet: string) => api<CreatorToken[]>(`/api/creator-tokens?wallet=${wallet}`);
