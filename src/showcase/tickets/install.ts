// Made-up tickets for the showcase and the tests (PIE-445): install the fictional ticket extension
// (tickets.ts) into a scratch service's config, register a Source for it, and fetch tickets through the
// service, so readers have stored ticket details to project. Only for a scratch or showcase service: the
// door's readers never do any of this; they only read projections (src/projection.ts).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SocketBoard } from "../../socket";

export interface Ticket { id: string; title: string; status?: string; type?: string; priority?: string; assignee?: string; labels?: string[]; updatedAt: string; description?: string }

export const TICKET_ORIGIN = "https://tickets.example.test";
export const TICKET_PROJECT = "ACME";

/** The showcase's tickets: fictional, in the made-up ACME project. */
export const SHOWCASE_TICKETS: Record<string, Ticket> = {
  "ACME-12": { id: "1012", title: "Rollout checklist for the vendor switch", status: "In progress", type: "Task", priority: "High", assignee: "A. Person", labels: ["rollout", "vendor"], updatedAt: "2026-09-19T08:30:00.000Z", description: "Steps for moving the depot to the new supplier." },
  "ACME-14": { id: "1014", title: "Label printer drops the last line", status: "To do", type: "Bug", priority: "Medium", assignee: "B. Person", labels: ["printing"], updatedAt: "2026-09-18T15:05:00.000Z" },
};

/**
 * Install the extension for the service whose `XDG_CONFIG_HOME` is `configDir`, answering from `tickets`
 * (rewritten on each call, so a test can change a ticket and refresh it). Returns the tickets file.
 */
export function installTickets(configDir: string, tickets: Record<string, Ticket>): string {
  const dir = join(configDir, "pi-herdr-outliner", "tickets");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(import.meta.dir, "tickets.ts"), join(dir, "tickets.ts"));
  // The service starts it with a minimal environment: the interpreter is named by its path.
  const manifest = { ...require("./manifest.json"), command: [process.execPath, "tickets.ts"] };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  const file = join(dir, "tickets.json");
  writeFileSync(file, JSON.stringify(tickets));
  writeFileSync(join(configDir, "pi-herdr-outliner", "resource-extensions.json"), JSON.stringify({
    version: 1, providers: { jira: { manifest: join(dir, "manifest.json"), enabled: true, config: { tickets: file }, credentials: {} } },
  }));
  return file;
}

/** The ticket Source (created once). */
export async function ticketSource(b: SocketBoard): Promise<string> {
  const sources = await b.request<{ id: string; provider: string; boundary?: { project?: string } }[]>("resource-sources.list");
  const found = sources.find(s => s.provider === "jira" && s.boundary?.project === TICKET_PROJECT);
  if (found) return found.id;
  return (await b.request<{ id: string }>("resource-sources.create", { input: { name: "Tickets (made up)", provider: "jira", boundary: { origin: TICKET_ORIGIN, project: TICKET_PROJECT } } })).id;
}

/** Register a ticket by its key (the service resolves it through the extension). Its Resource id. */
export async function registerTicket(b: SocketBoard, key: string): Promise<string> {
  const r = await b.request<{ resource: { id: string } }>("resources.follow-authored", { reference: { kind: "jira", key } });
  return r.resource.id;
}

/**
 * Fetch a ticket's details into the service, as Detail's `r` does (`SocketBoard.refreshResource`, which
 * registers the Detail destination the call names). The service runs the extension.
 */
export async function refreshTicket(b: SocketBoard, resourceId: string): Promise<void> {
  await b.refreshResource(resourceId);
}
