// The fictional outlines the host benches serve (PIE-625, PIE-1413). Made-up words only: a shape is counts, never a real
// outline's content.
//
// - `small`: about a working outline of 2025 (~2.4k notes, ~14k property tokens, 72 saved views), bench-host-stalls'.
// - `pie`: the shape of the outline the Oct 29 backfill froze, by its counts that day: ~11k live notes of ~1.4 KB with
//   ~10 property tokens each (~108k), the same mix of kinds (deploys, review findings, peer messages, roadmap items,
//   tosses, deliveries, proofs, annotations), 86 saved views, half the notes referencing another, a few rule notes,
//   and ~400 agent-written notes a write-review backfill flags (a wall, a question buried below the top).
import { join } from "node:path";
import { OutlinerStore } from "../../src/store";

export type FixtureShape = "small" | "pie";

export interface Fixture {
  notes: number;
  views: number;
  /** A note in the middle, for the probe's reads. */
  probe: string;
  /** A hub many notes reference (its backlinks are a watched read). */
  hub: string;
  /** Every saved view's id. */
  viewIds: string[];
  /** The hub the saved views sit under: the board a door opens. */
  board: string;
}

const projects = ["harbor", "lantern", "meadow", "quarry", "orchard", "beacon", "thistle", "copper"];
const tracks = ["stability", "performance", "docs", "ux", "data"];
const stages = ["queued", "doing", "review", "validate", "done", "later"];
const pick = <T>(list: readonly T[], n: number) => list[n % list.length]!;
const prose = (n: number) => `Some words about step ${n}: who does it, what it needs, and what done looks like. See https://example.test/notes/${n}.`;

export function makeOutline(path: string, workspaceRoot: string, shape: FixtureShape = "small"): Fixture {
  const store = new OutlinerStore(path, { workspaceRoot });
  try {
    return shape === "pie" ? pieShaped(store) : small(store);
  } finally {
    store.close();
  }
}

function small(store: OutlinerStore): Fixture {
  let notes = 0;
  const ids: string[] = [], viewIds: string[] = [];
  const add = (text: string, parent: string | null = null) => { notes += 1; const block = store.create(text, parent, "user"); ids.push(block.id); return block; };
  let hub = "", boardId = "";
  store.database.transaction(() => {
    const hubs = projects.map((name, i) => add(`Project ${name} [type::project] [owner::team-${i % 3}]`));
    hub = hubs[0]!.id;
    const board = add("Workboard [type::hub]");
    boardId = board.id;
    for (let i = 0; i < 560; i++) {
      const project = pick(projects, i), parent = pick(hubs, i);
      const related = ids.length > 10 ? ` [related-to::((${pick(ids, i * 7)}))]` : "";
      const item = add(`BEN-${i} — Make the ${project} thing better, part ${i} [type::roadmap-item] [priority::${pick(["high", "medium", "low"], i)}] ` +
        `[work-stage::${pick(stages, i)}] [project::${project}] [arc::${pick(["core", "edge"], i)}] [track::${pick(tracks, i)}] [ref::BEN-${i}]${related}\n\n` +
        `${prose(i)}\n- first, ((${pick(ids, i * 3)}))\n- then the rest #followup`, parent.id);
      if (i % 2 === 0) add(`Delivery for BEN-${i} [type::delivery] [repository::example/${project}] [pull-request-number::${1000 + i}] ` +
        `[pull-request-state::${pick(["open", "merged"], i)}] [work-branch::ben-${i}] [base-branch::main] [delivery-stage::review]`, item.id);
      if (i % 5 === 0) add(`Proof for BEN-${i} [type::proof] [commit::${(i * 2654435761 >>> 0).toString(16)}]\n${prose(i + 1)}`, item.id);
    }
    for (let i = 0; i < 1_350; i++) {
      const parent = i % 4 === 0 ? null : pick(ids, i * 13);
      const long = i % 97 === 0;
      const body = long
        ? Array.from({ length: 300 }, (_, n) => n % 40 === 0 ? `## Part ${n}\n\`\`\`ts\nconst step${n} = ${n};\n\`\`\`` : `- ${prose(n)} [[Page ${n % 30}]]`).join("\n")
        : `${prose(i)}\n- a line with [status::${pick(["open", "closed"], i)}] and ((${pick(ids, i * 5)}))`;
      add(`Note ${i} about ${pick(projects, i)} [type::${pick(["note", "log", "idea", "task"], i)}] [project::${pick(projects, i)}] [tag::t${i % 9}]\n${body}`, parent);
    }
    for (let i = 0; i < 30; i++) add(`Page ${i} [page::Page ${i}] [type::page]\n${prose(i)}`);
    for (let i = 0; i < 4; i++) add(`Callout ${i} [callout-type::kind-${i}] [color::${pick(["red", "blue"], i)}]`);
    for (let i = 0; i < 72; i++) {
      const query = i % 3 === 0 ? `type=roadmap-item project=${pick(projects, i)}` : i % 3 === 1 ? `work-stage=${pick(stages, i)}` : `type=${pick(["note", "task", "delivery"], i)}`;
      viewIds.push(add(`View ${i} [type::virtual-branch] [query::${query}] [limit::${pick([20, 50, 200], i)}]`, board.id).id);
    }
  })();
  return { notes, views: viewIds.length, probe: ids[ids.length >> 1]!, hub, viewIds, board: boardId };
}

/** About 1.4 KB of made-up prose with a list, a reference now and then, and a heading in the longer ones. */
function body(n: number, ids: readonly string[]): string {
  const lines = [prose(n), ""];
  const items = 6 + (n % 9);
  for (let i = 0; i < items; i++) lines.push(`- ${prose(n + i)}${i === 1 && ids.length && n % 2 === 0 ? ` ((${pick(ids, n * 7 + i)}))` : ""}`);
  if (n % 11 === 0) lines.push("", "## Details", ...Array.from({ length: 8 }, (_, i) => `- ${prose(n * 3 + i)} [[Page ${i % 30}]]`));
  return lines.join("\n");
}

/** What a write-review backfill flags in an agent's note: a wall of prose and a question for Evan buried below the top. */
function agentWall(i: number): string {
  return `Status of the ${pick(projects, i)} shed ${i}\n\n` +
    `- The roof went on at nine and the felt was cut to size. The tacks ran out halfway; we borrowed a box. Then the rain held off.\n` +
    `- Evan, should we paint it now or wait for spring?\n\n${"The gutter came down and went back up again. ".repeat(8)}`;
}

function pieShaped(store: OutlinerStore): Fixture {
  let notes = 0;
  const ids: string[] = [], viewIds: string[] = [];
  const add = (text: string, parent: string | null = null) => { notes += 1; const block = store.create(text, parent, "user"); ids.push(block.id); return block; };
  let hub = "", boardId = "";
  // The mix by kind, as counts (made-up notes of each).
  const kinds: Array<[kind: string, count: number, props: (i: number) => string]> = [
    ["deploy", 2470, i => `[host::box-${i % 4}] [when::2026-10-${String(1 + (i % 28)).padStart(2, "0")}] [sha::${(i * 40503 >>> 0).toString(16)}] [result::${pick(["ok", "ok", "failed"], i)}]`],
    ["review-finding", 1460, i => `[source::${pick(["write", "backfill"], i)}] [rubric::${pick(["shape", "figure", "question", "title"], i)}] [rule::r${i % 12}] [writer::${pick(["moss", "fern", "lichen"], i)}] [day::2026-10-${String(1 + (i % 28)).padStart(2, "0")}]`],
    ["peer-message", 1340, i => `[from::${pick(["moss", "fern", "lichen", "bracken"], i)}] [to::${pick(["moss", "fern", "lichen", "bracken"], i + 1)}] [thread::t${i % 90}]`],
    ["roadmap-item", 1310, i => `[work-id::BEN-${i}] [work-stage::${pick(stages, i)}] [priority::${pick(["high", "medium", "low"], i)}] [track::${pick(tracks, i)}] [project::${pick(projects, i)}]`],
    ["toss", 955, i => `[echo::${pick(["recon", "notes", "status"], i)}] [node::n${i % 6}] [packet::p${i}]`],
    ["delivery", 813, i => `[repository::example/${pick(projects, i)}] [pull-request-number::${1000 + i}] [pull-request-state::${pick(["open", "merged"], i)}] [delivery-stage::review]`],
    ["proof", 660, i => `[commit::${(i * 2654435761 >>> 0).toString(16)}] [kind::${pick(["test", "drive", "snapshot"], i)}]`],
    ["annotation", 397, i => `[state::${pick(["open", "resolved"], i)}]`],
    ["note", 1300, i => `[project::${pick(projects, i)}] [tag::t${i % 9}] [status::${pick(["open", "closed"], i)}]`],
  ];
  store.database.transaction(() => {
    const hubs = projects.map((name, i) => add(`Project ${name} [type::project] [owner::team-${i % 3}]\n\n${body(i, ids)}`));
    hub = hubs[0]!.id;
    const board = add("Workboard [type::hub]");
    boardId = board.id;
    let n = 0;
    for (const [kind, count, props] of kinds) {
      const folder = add(`${kind} records [type::hub] [kind-of::${kind}]`, hubs[n % hubs.length]!.id);
      for (let i = 0; i < count; i++, n++) {
        // Half the notes say where they belong: a reference to the hub or to an earlier note.
        const ref = i % 2 === 0 ? ` [related-to::((${i % 10 === 0 ? hub : pick(ids, n * 13)}))]` : "";
        add(`${kind} ${i} about ${pick(projects, n)} [type::${kind}] ${props(i)}${ref}\n\n${body(n, ids)}`, i % 3 === 0 ? folder.id : pick(ids, n * 7 + 1));
      }
    }
    for (let i = 0; i < 160; i++) add(`Page ${i} [page::Page ${i}] [type::page]\n\n${body(i, ids)}`);
    for (let i = 0; i < 4; i++) add(`Callout ${i} [callout-type::kind-${i}] [color::${pick(["red", "blue"], i)}]`);
    // Rule notes that draw (a band on matching notes): every save is matched against them.
    for (let i = 0; i < 5; i++) add(`Rule ${i} [rule-name::bench-${i}] [rule-match::type=${pick(["roadmap-item", "review-finding", "deploy", "peer-message", "note"], i)}] [rule-decorate::badge] [rule-label::{{this.title}}]`);
    for (let i = 0; i < 86; i++) {
      const query = i % 4 === 0 ? `type=roadmap-item project=${pick(projects, i)}` : i % 4 === 1 ? `work-stage=${pick(stages, i)}`
        : i % 4 === 2 ? `type=review-finding rubric=${pick(["shape", "figure", "question", "title"], i)}` : `type=${pick(["note", "deploy", "delivery", "peer-message"], i)}`;
      viewIds.push(add(`View ${i} [type::virtual-branch] [query::${query}] [limit::${pick([20, 50, 200], i)}]`, board.id).id);
    }
  })();
  // The agents' notes a backfill reviews, last, so they are the newest.
  store.database.transaction(() => {
    for (let i = 0; i < 400; i++) { notes += 1; store.create(agentWall(i), null, "agent", { actorId: `${pick(["moss", "fern", "lichen"], i)}/claude-code@shed` }); }
  })();
  return { notes, views: viewIds.length, probe: ids[ids.length >> 1]!, hub, viewIds, board: boardId };
}

/** The fixture's database path in an outlines folder, with its folder beside it. */
export function fixturePaths(outlines: string, name: string) {
  return { database: join(outlines, `${name}.sqlite`), workspaceRoot: join(outlines, name) };
}
