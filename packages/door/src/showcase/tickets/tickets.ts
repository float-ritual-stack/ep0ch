// A made-up ticket provider for the showcase and the tests (PIE-445): the outliner's Jira extension shape
// (pi-herdr-outliner docs/extensions/resource-process.md, contract 2: a folder with extension.json and
// config.json) that answers `resolve`, `read` and `changed` from a JSON file of fictional tickets named in
// its config. It contacts nothing. The outliner service runs it when a note asks for a ticket (on save and
// open), on `r`, and on its poll; the service keeps each ticket as a block. The door only reads.
//
// The file: { "ACME-12": { "id": "1012", "title": "…", "status": "…", "type": "…", "priority": "…",
// "assignee": "…", "sprint": "…", "labels": ["…"], "updatedAt": "…", "description": "…",
// "comments": [{ "id": "…", "author": "…", "createdAt": "…", "body": "…" }] }, … }
export {};
type Comment = { id: string; author: string; createdAt: string; body: string };
type Ticket = { id: string; title: string; status?: string; type?: string; priority?: string; assignee?: string; sprint?: string; labels?: string[]; updatedAt: string; description?: string; comments?: Comment[] };

const fail = (code: string) => { console.log(JSON.stringify({ ok: false, code })); process.exit(0); };
const request = await Bun.stdin.json().catch(() => null);
if (!request || (request.contract !== 1 && request.contract !== 2) || !["resolve", "read", "changed"].includes(request.operation)) fail("invalid-config");
const tickets: Record<string, Ticket> = await Bun.file(String(request.config?.tickets ?? "")).json().catch(() => fail("invalid-config"));
const origin = new URL(String(request.input?.source?.origin ?? ""));
const project = String(request.input?.source?.project ?? "");
if (request.operation === "changed") {
  const since = Date.now() - Number(request.input?.sinceMinutes ?? 0) * 60_000;
  const wanted = new Set<string>((request.input?.locators ?? []).map(String));
  const items = Object.entries(tickets).filter(([key, t]) => wanted.has(key) && Date.parse(t.updatedAt) >= since).map(([key, t]) => ({ entityId: t.id, locator: key }));
  console.log(JSON.stringify({ ok: true, value: { items } }));
  process.exit(0);
}
const entry = request.operation === "resolve"
  ? Object.entries(tickets).find(([key]) => key === String(request.input.locator).trim().toUpperCase())
  : Object.entries(tickets).find(([, t]) => t.id === String(request.input.entityId));
if (!entry) fail("not-found");
const [key, t] = entry!;
if (!key.startsWith(project + "-")) fail("outside-source");
if (request.operation === "resolve") { console.log(JSON.stringify({ ok: true, value: { entityId: t.id, locator: key } })); process.exit(0); }
const metadata = { key, status: t.status ?? null, type: t.type ?? null, priority: t.priority ?? null, assignee: t.assignee ?? null, labels: t.labels ?? [] };
console.log(JSON.stringify({ ok: true, value: {
  entityId: t.id, locator: key, title: t.title, metadata, updatedAt: t.updatedAt,
  sourceContent: JSON.stringify({ key, ...t }),
  markdown: `# ${t.title}\n\n${t.description ?? ""}\n`,
  externalUrl: new URL(`/browse/${encodeURIComponent(key)}`, origin).href,
  record: {
    title: t.title,
    fields: [
      { key: "status", value: t.status ?? null }, { key: "assignee", value: t.assignee ?? null },
      { key: "type", value: t.type ?? null }, { key: "priority", value: t.priority ?? null },
      { key: "sprint", value: t.sprint ?? null }, { key: "label", value: t.labels ?? [] }, { key: "updated", value: t.updatedAt },
    ],
    body: t.description ?? "",
    comments: t.comments ?? [],
  },
} }));
