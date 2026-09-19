// Fail fast (one clear message) if the live stack is not up, instead of every test timing out.
import { AGENT } from "./fixtures";

export default async function preflight() {
  const r = await fetch(`${AGENT}/api/health`, { signal: AbortSignal.timeout(15_000) }).catch((e) => {
    throw new Error(`Agent not reachable at ${AGENT} (${(e as Error).message}). Start the agent (and anvil) first.`);
  });
  const j = (await r.json()) as { ok?: boolean; demoFork?: boolean };
  if (!j.ok) throw new Error(`Agent at ${AGENT} is unhealthy: ${JSON.stringify(j)}`);
}
