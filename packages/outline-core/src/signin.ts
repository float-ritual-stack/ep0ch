// Who may sign in, one rule for every door that checks it: the remote MCP gateway (the door's mcp-gateway.ts) and the
// signed-in web client (the outliner's web-signin.ts). Clerk is the authorization server for both; this says which
// Clerk instance (its issuer, from the publishable key) and which people (Clerk user ids). Pure: the caller passes env.

/** The one setting naming who may sign in: comma-separated Clerk user ids (`user_…`). Shared by MCP and the web. */
export const ALLOWED_SUBJECTS_ENV = "EP0CH_MCP_ALLOWED_SUBJECTS";

/** The people allowed in, from the environment; empty means nobody (capture mode: refuse and log who asked). */
export function allowedSubjects(env: Record<string, string | undefined>): string[] {
  return (env[ALLOWED_SUBJECTS_ENV] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Clerk's Frontend API URL, its OAuth issuer, from a publishable key (`pk_test_<base64 of "<host>$">`). */
export function issuerFromPublishableKey(key: string): string | undefined {
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key.trim());
  if (!m) return undefined;
  try {
    const host = atob(m[1]!.replace(/-/g, "+").replace(/_/g, "/")).replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : undefined;
  } catch { return undefined; }
}

/**
 * The origin a request's Host header names (PIE-813: one listener, several public names), from origins kept by their
 * `URL.host` (no default port), or undefined: `name:443` is `name` over https. The web sign-in and the MCP gateway both
 * pick their origin with it.
 */
export function originOfHost(origins: ReadonlyMap<string, string>, header: string | null): string | undefined {
  const host = (header ?? "").trim().toLowerCase();
  const exact = origins.get(host);
  if (exact) return exact;
  const bare = /^(.*):(443|80)$/.exec(host);
  const origin = bare ? origins.get(bare[1]!) : undefined;
  return origin && origin.startsWith(bare![2] === "443" ? "https:" : "http:") ? origin : undefined;
}
