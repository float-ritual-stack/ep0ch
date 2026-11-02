// PIE-1333: a published page folds the outline's machinery the way the door and outline_query's fold do. An applied
// proposal under a note is one line ("1 edit from @tidy, applied") with its diff a click away, a delivery folds with
// it, and a proposal's `[draft-patch::…]` base64 is never printed anywhere on a page. One scratch service and one
// publisher; the outline is made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { proposalText, withProposalStatus, type DraftProposal } from "../src/draft-patch";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { scratchOutline } from "./scratch-outline";

const HOST = "garden.tail0000.ts.net";
let root = "";
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
let publisher: Publisher;
let plan: Block, proposal: Block, delivery: Block, notes: Block;
let payload = "";

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-pub-proposals-")));
  const paths = scratchOutline(root, { name: "garden" });
  store = new OutlinerStore(paths.database, { workspaceRoot: join(root, "garden") });
  server = new OutlinerServer(store, paths.socket, undefined, undefined, { extensionPollMs: 0 });
  await server.start();
  client = new OutlinerClient(paths.socket, 15_000);

  plan = store.create("Bean trellis [type::roadmap-item] [work-id::GDN-7] [work-stage::doing]\nTie the runner beans in by June.", null, "user");
  notes = store.create("Trellis sketch\nSix canes, string at the top.", plan.id, "user");
  const patch: DraftProposal = {
    version: 1,
    edits: [{ blockId: plan.id, revision: plan.revision, patches: [{ observed: "by June", replacement: "by the first week of June" }] }],
    reason: "the note was saved since it was read",
    actor: { author: "agent", actorId: "tidy" },
  };
  const text = withProposalStatus(proposalText(patch, () => "Bean trellis"), "applied");
  payload = /\[draft-patch::([A-Za-z0-9_-]+)\]/.exec(text)![1]!;
  proposal = store.create(text, plan.id, "agent");
  delivery = store.ensureDelivery({ taskBlockId: plan.id, deliveryKey: "GDN-7/trellis", repository: "garden/beds", baseBranch: "main", workBranch: "feat/trellis" }).delivery;

  publisher = new Publisher({ client, basePath: "/pub", publicUrl: "/share" });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  await server?.close();
  store?.close();
  rmSync(root, { recursive: true, force: true });
});

const page = async (path: string, accept = "text/html,application/xhtml+xml") => {
  const response = await publisher.handle(new Request(`http://${HOST}${path}`, { headers: { host: HOST, accept } }), "tailnet");
  expect(response.status).toBe(200);
  return response.text();
};

test("a note's inside list folds an applied proposal and a delivery into one line each, and never prints the patch", async () => {
  const html = await page(`/pub/p/${plan.id}`);
  expect(html).not.toContain(payload.slice(0, 24));
  expect(html).not.toContain("draft-patch");
  const inside = html.slice(html.indexOf('<section class="inside">'));
  // What a person wrote is listed as before.
  expect(inside).toContain("Trellis sketch");
  // The proposal and the delivery fold into the note's changes, as outline_query's fold counts them.
  const [, changes = ""] = inside.split('<details class="changes">');
  expect(changes).toMatch(/<summary>2 changes \(1 proposal, 1 delivery\)/);
  expect(changes).toContain("1 edit from @tidy, applied");
  expect(changes).toContain(`href="/pub/p/${proposal.id}"`);
  expect(changes).toContain(">Delivery GDN-7/trellis<");
  expect(changes).not.toContain("::");
  expect(changes).not.toContain("proposal-status");
  expect(inside).toMatch(/<h2>Inside <span class="dim">1 · 2 changes<\/span><\/h2>/);
  expect(notes.id).toBeTruthy();
});

test("a proposal's own page is its diff, with no base64", async () => {
  const html = await page(`/pub/p/${proposal.id}`);
  expect(html).not.toContain(payload.slice(0, 24));
  expect(html).not.toContain("draft-patch");
  expect(html).toContain("by the first week of June");
  const markdown = await page(`/pub/p/${proposal.id}?view=md`, "text/markdown");
  expect(markdown).not.toContain(payload.slice(0, 24));
  expect(delivery.id).toBeTruthy();
});

test("the whole subtree on one page (?view=full, and its Markdown) never prints the patch either", async () => {
  for (const [path, accept] of [[`/pub/p/${plan.id}?view=full`, "text/html"], [`/pub/p/${plan.id}?view=md`, "text/markdown"]] as const) {
    const body = await page(path, accept);
    expect(body).toContain("Tie the runner beans in");
    expect(body).not.toContain(payload.slice(0, 24));
    expect(body).not.toContain("draft-patch");
  }
});

test("a [publish::never] proposal or delivery is a locked row, its proposer, status and title never shown", async () => {
  const rows = store.create("Pea row\nSow the second row in May.", null, "user");
  const patch: DraftProposal = {
    version: 1,
    edits: [{ blockId: rows.id, revision: rows.revision, patches: [{ observed: "in May", replacement: "in early May" }] }],
    reason: "the note was saved since it was read",
    actor: { author: "agent", actorId: "hedge" },
  };
  const text = withProposalStatus(proposalText(patch, () => "Pea row"), "applied").replace("\n", " [publish::never]\n");
  store.create(text, rows.id, "agent");
  store.create("Delivery PEA-2/sowing [type::delivery] [machine::delivery] [publish::never]", rows.id, "agent");
  const html = await page(`/pub/p/${rows.id}`);
  const [, changes = ""] = html.split('<details class="changes">');
  expect(changes).toMatch(/<summary>2 changes \(1 proposal, 1 delivery\)/);
  expect(changes.match(/<li class="locked">locked note<\/li>/g)?.length).toBe(2);
  expect(changes).not.toContain("@hedge");
  expect(changes).not.toContain("applied");
  expect(changes).not.toContain("PEA-2");
});

test("a proposal whose patch is malformed still draws its page, as its title line", async () => {
  const beds = store.create("Raised beds\nTop up with compost.", null, "user");
  const broken = Buffer.from(JSON.stringify({ version: 1, edits: [{}] }), "utf8").toString("base64url");
  store.create(`Proposed edit to the beds [type::draft-proposal] [proposal-status::open]\n[draft-patch::${broken}]`, beds.id, "agent");
  const html = await page(`/pub/p/${beds.id}`);
  const [, changes = ""] = html.split('<details class="changes">');
  expect(changes).toContain(">Proposed edit to the beds<");
  expect(html).not.toContain(broken);
});
