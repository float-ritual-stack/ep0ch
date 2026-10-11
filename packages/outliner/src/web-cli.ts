// `web sessions` and `web revoke <id>|--all` (`ep0ch web …`): the signed-in web client's sessions (web-sessions.ts), the
// same list and the same Revoke as the web client's `/sessions` page, asked of this machine's outline host.
import type { WebSession } from "@ep0ch/outline-core/protocol";
import { outlineHostClient } from "./outline-host-client";

export const WEB_USAGE = `web sessions [--json]                the browsers signed in to the web client (my.ep0ch.sh): id, browser, who, last seen
  web revoke <id> | --all [--json]     sign one out now, or every one (sign out everywhere)`;

const ago = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};

export function webSessionLine(session: WebSession, now = Date.now()): string {
  return `${session.id}  ${session.device}\n    ${session.name ? `${session.name} (${session.subject})` : session.subject} · last seen ${ago(session.lastSeenAt, now)} · ends ${session.expiresAt.slice(0, 10)}`;
}

export async function runWebCommand(args: string[], io = { out: console.log, err: console.error }, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [verb, ...rest] = args;
  const json = rest.includes("--json");
  const words = rest.filter((word) => word !== "--json");
  if (verb !== "sessions" && verb !== "revoke") { io.err(`error: web takes sessions or revoke\n  ${WEB_USAGE}`); return 2; }
  if (verb === "sessions" && words.length) { io.err(`error: web sessions takes no words (${words.join(" ")})\n  ${WEB_USAGE}`); return 2; }
  const all = words.includes("--all");
  const ids = words.filter((word) => word !== "--all");
  if (verb === "revoke" && (all === (ids.length > 0) || ids.length > 1 || ids.some((id) => id.startsWith("--")))) { io.err(`error: web revoke takes one id (ep0ch web sessions lists them) or --all\n  ${WEB_USAGE}`); return 2; }
  const host = await outlineHostClient(env);
  if (!host) { io.err("error: no outline host answers on this machine: start it (systemctl --user start outliner-host), then try again"); return 1; }
  try {
    if (verb === "sessions") {
      const { sessions } = await host.request<{ sessions: WebSession[] }>({ action: "web.sessions.list" });
      if (json) io.out(JSON.stringify({ sessions }, null, 2));
      else io.out(sessions.length ? sessions.map((session) => webSessionLine(session)).join("\n") : "no browser is signed in to the web client");
      return 0;
    }
    const { revoked } = await host.request<{ revoked: WebSession[] }>(all ? { action: "web.sessions.revoke", all: true } : { action: "web.sessions.revoke", sessionId: ids[0]! });
    if (json) io.out(JSON.stringify({ revoked }, null, 2));
    else io.out(revoked.length ? `signed out: ${revoked.map((session) => `${session.id} (${session.device})`).join(", ")}` : "no browser was signed in");
    return 0;
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
