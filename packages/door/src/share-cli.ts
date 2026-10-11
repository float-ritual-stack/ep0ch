// Share sessions (the outliner's share-sessions.ts): a short-lived public link to a note and what's under it, or to the
// whole outline, served by the publisher's public listener; and what the person's web client shows now (`reader.view`).
// One set of verbs everywhere: `ep0ch share`, the MCP's share tools and the door's share actions all call these, and the
// tailnet's `/pub/shares` page lists the same sessions. Starting one is the one approval it needs: nothing asks again.
import { boardFor, type Out } from "./notes-cli";
import { resolveBoardRef } from "./mcp-writes";
import { USER, type Actor } from "./socket";
import type { ReaderView, ShareSession } from "@ep0ch/outline-core/protocol";

export const SHARE_USAGE = `  ep0ch share start [<ref>] [--only <ref>] [--ttl 1h] [--no-comments] [--via edge|cloudflare]
                    [--allow-mail <email>]… [--as <agent id>] [--json]
  ep0ch share list [--all] [--json] | revoke <id> | revoke --all     [--ws <name>] [--machine <ssh-name>]
                                   short-lived public links to the outline, navigated as the tailnet's web
                                   client is: <ref> (an id, ((id)), a page name or [[page]], PIE-123) is the
                                   page the link opens on; --only <ref> shows only that note and what's under
                                   it. It ends by itself after --ttl (30m, 1h, 2h30m; 1h by
                                   default, at most 24h) and takes comments unless --no-comments. [publish::never]
                                   notes stay hidden. --via edge (the default): the outline's public host
                                   (https://pie.ep0ch.sh/s/<token>/); --via cloudflare: a Cloudflare tunnel of its
                                   own on a random trycloudflare.com host, and with --allow-mail (an email or
                                   @domain, repeatable) only those who sign in by a one-time PIN, for sharing with
                                   someone else. list shows each open one (link, what, ends in); revoke ends
                                   one now, --all every one. The tailnet page <publisher>/pub/shares does the same
  ep0ch reader [--json] [--ws <name>]
                                   what your web client shows now: the page and the words selected on it`;

/** The calls a share verb makes, on a board's connection to its outline. */
export interface ShareBoard {
  request<T = unknown>(action: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  info(): Promise<unknown>;
}

/**
 * A note as the share verbs name it: an id, ((id)), [[page]] or Work ID, as the outline's own links name one, or a page
 * name written bare (`Field Notes`), as `view order` and the door's `open` take it.
 */
export async function shareRef(board: ShareBoard, ref: string): Promise<string> {
  const resolve = (text: string) => resolveBoardRef(board as Parameters<typeof resolveBoardRef>[0], text);
  try {
    return (await resolve(ref)).id;
  } catch (error) {
    if (/[[\]()]/.test(ref)) throw error;
    try { return (await resolve(`[[${ref}]]`)).id; } catch { throw error; }
  }
}

/**
 * Starts a share of the whole outline, as the tailnet's web client shows it: `ref` is the page the link opens on,
 * `only` narrows it to that note and what's under it (`outline` for either is the top).
 */
export async function startShare(board: ShareBoard, input: { ref?: string; only?: string; ttl?: string | number; comments?: boolean; via?: string; allowMail?: string[] }, actor: Actor): Promise<{ share: ShareSession; said?: string }> {
  const named = async (ref: string | undefined) => (!ref?.trim() || ref.trim() === "outline" ? undefined : shareRef(board, ref.trim()));
  const scope = await named(input.only);
  const open = await named(input.ref);
  return board.request("shares.start", {
    ...(scope ? { scope } : {}), ...(open ? { open } : {}), ...(input.ttl !== undefined ? { ttl: input.ttl } : {}), ...(input.comments !== undefined ? { comments: input.comments } : {}),
    ...(input.via ? { via: input.via } : {}), ...(input.allowMail?.length ? { allowMail: input.allowMail } : {}),
    mutation: actor.kind === "agent" ? { author: "agent", actorId: actor.id } : { author: "user" },
  }, input.via === "cloudflare" ? 45_000 : undefined);
}

export const listShares = (board: ShareBoard, all = false) => board.request<{ shares: ShareSession[] }>("shares.list", all ? { all: true } : {});

export const revokeShares = (board: ShareBoard, which: { id: string } | { all: true }) =>
  board.request<{ revoked: ShareSession[] }>("shares.revoke", "all" in which ? { all: true } : { shareId: which.id });

export const readerView = (board: ShareBoard) => board.request<{ view: ReaderView | null; readers: ReaderView[] }>("reader.view");

/** How long until `iso`, as a person says it: `47 min`, `3 h 5 min`, `ended`. */
export function endsIn(iso: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 0) return Date.parse(iso) > now ? "under a minute" : "ended";
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

/** What a share shows, in words. */
export const shareWhat = (share: ShareSession) => (share.scope.kind === "outline" ? "the whole outline" : `only “${share.scope.title}” ((${share.scope.blockId})) and what's under it`) +
  (share.opens ? `, opening on “${share.opens.title}”` : "");

/** One share as a line: its id, link, what, when it ends, comments. */
export function shareLine(share: ShareSession, now = Date.now()): string {
  const state = share.state === "active" ? `ends in ${endsIn(share.expiresAt, now)}` : share.state;
  const via = share.via === "cloudflare" ? ` · cloudflare tunnel${share.allowMail?.length ? ` for ${share.allowMail.join(", ")}` : ", public"}${share.tunnel?.pid ? ` (pid ${share.tunnel.pid})` : ""}` : "";
  const missing = share.via === "cloudflare" ? `(no link: its tunnel is ${share.tunnel?.state ?? "starting"}${share.tunnel?.error ? `: ${share.tunnel.error}` : ""})` : "(no link: the publisher hasn't said its public address)";
  return `${share.id}  ${share.url ?? missing}\n    ${shareWhat(share)} · ${state} · comments ${share.comments ? "on" : "off"}${via} · by ${share.by}`;
}

/** What the reader shows, in words an agent can say back. */
export function readerLine(view: ReaderView | null, now = Date.now()): string {
  if (!view) return "no web client page has said what it shows (open a note's page on the tailnet, or a share link)";
  const ago = Math.max(0, Math.round((now - Date.parse(view.at)) / 1000));
  const when = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
  const where = `${view.title || "(untitled)"}${view.blockId ? ` ((${view.blockId}))` : ""} · ${view.url} · ${view.reader} · ${when}`;
  if (!view.selection) return `${where}\n  nothing selected`;
  return `${where}\n  selected${view.selection.blockId && view.selection.blockId !== view.blockId ? ` in ((${view.selection.blockId}))` : ""}: “${view.selection.text}”${view.selection.truncated ? " (cut at 2,000 characters)" : ""}`;
}

export async function shareCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const reader = argsIn[0] === "reader";
  const args = argsIn.slice(1);
  const verb = reader ? "reader" : args.shift();
  if (!reader && verb !== "start" && verb !== "list" && verb !== "revoke") { io.err(`ep0ch: share takes start, list or revoke\n${SHARE_USAGE}`); return 2; }
  const valued = ["--ws", "--machine", "--as", "--ttl", "--via", "--allow-mail", "--only"];
  const flags = ["--json", "--all", "--no-comments"];
  for (const [at, f] of args.entries()) {
    if (valued.includes(f) && (args[at + 1] === undefined || args[at + 1]!.startsWith("--"))) { io.err(`ep0ch: ${f} needs a value`); return 2; }
  }
  const allowMail = args.flatMap((a, i) => (args[i - 1] === "--allow-mail" ? [a] : []));
  const words = args.filter((a, i, all) => !valued.includes(a) && !valued.includes(all[i - 1] ?? "") && !flags.includes(a));
  const unknown = words.find(w => w.startsWith("--"));
  if (unknown) { io.err(`ep0ch: ${reader ? "reader" : `share ${verb}`} doesn't take ${unknown}\n${SHARE_USAGE}`); return 2; }
  const value = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
  const json = args.includes("--json");
  if (words.length > 1 || (words.length && (verb === "list" || verb === "reader"))) { io.err(`ep0ch: ${reader ? "reader" : `share ${verb}`} takes ${verb === "start" ? "one note" : verb === "revoke" ? "one id" : "no words"}\n${SHARE_USAGE}`); return 2; }
  if (verb === "revoke" && !words[0] === !args.includes("--all")) { io.err(`ep0ch: share revoke takes an id (ep0ch share list) or --all\n${SHARE_USAGE}`); return 2; }
  const as = value("--as") ?? process.env.EP0CH_AGENT ?? undefined;
  const actor: Actor = as ? { kind: "agent", id: as } : USER;
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    if (verb === "reader") {
      const seen = await readerView(board);
      io.out(json ? JSON.stringify(seen) : readerLine(seen.view));
    } else if (verb === "start") {
      const started = await startShare(board, {
        ...(words[0] ? { ref: words[0] } : {}), ...(value("--only") ? { only: value("--only") } : {}), ...(value("--ttl") ? { ttl: value("--ttl") } : {}), ...(args.includes("--no-comments") ? { comments: false } : {}),
        ...(value("--via") ? { via: value("--via") } : {}), ...(allowMail.length ? { allowMail } : {}),
      }, actor);
      io.out(json ? JSON.stringify(started) : `${shareLine(started.share)}${started.said ? `\n  ${started.said}` : ""}\n  ends it now: ep0ch share revoke ${started.share.id}`);
    } else if (verb === "list") {
      const { shares } = await listShares(board, args.includes("--all"));
      io.out(json ? JSON.stringify({ shares }) : shares.length ? shares.map(s => shareLine(s)).join("\n") : "no share is open (ep0ch share start <ref> opens one)");
    } else {
      const { revoked } = await revokeShares(board, args.includes("--all") ? { all: true } : { id: words[0]! });
      io.out(json ? JSON.stringify({ revoked }) : revoked.length ? `ended ${revoked.map(s => s.id).join(", ")}: ${revoked.length === 1 ? "its link opens" : "their links open"} nothing now (410 on the outline's host; a Cloudflare tunnel is stopped)` : "no share was open");
    }
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}
