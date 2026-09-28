// A made-up ticket provider for the showcase and the tests (PIE-445): an installed Resource extension
// (pi-herdr-outliner docs/extensions/resource-process.md, contract 1) that answers `resolve` and `read`
// from a JSON file of fictional tickets named in its config. It contacts nothing. The outliner service
// runs it, only when something refreshes a ticket; the door itself only reads stored projections.
//
// The file: { "ACME-12": { "id": "1012", "title": "…", "status": "…", "type": "…", "priority": "…",
// "assignee": "…", "labels": ["…"], "updatedAt": "…", "description": "…" }, … }
export {};
type Ticket = { id: string; title: string; status?: string; type?: string; priority?: string; assignee?: string; labels?: string[]; updatedAt: string; description?: string };

const fail = (code: string) => { console.log(JSON.stringify({ ok: false, code })); process.exit(0); };
const request = await Bun.stdin.json().catch(() => null);
if (!request || request.contract !== 1 || !["resolve", "read"].includes(request.operation)) fail("invalid-config");
const tickets: Record<string, Ticket> = await Bun.file(String(request.config?.tickets ?? "")).json().catch(() => fail("invalid-config"));
const origin = new URL(String(request.input?.source?.origin ?? ""));
const project = String(request.input?.source?.project ?? "");
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
} }));
