// What a new card is written as, and where it goes: the pure half of creating cards on the board
// (PIE-406). The board (delivery.ts) reads, asks the service and writes; these only decide.
import { subject, type Msg } from "../board";
import { NOT_CREATED_IN } from "../move";

type Prop = { key: string; value: string };

/** `[key::value]` tokens in `text`, by a plain scan: what stands in when the service can't preview properties. */
export const scanTokens = (text: string): Prop[] =>
  [...text.matchAll(/\[([A-Za-z][\w.-]*)::([^\]\n]*)\]/g)].map(m => ({ key: m[1]!.toLowerCase(), value: m[2]!.trim() }));

/**
 * The text a new card is saved with: what was typed, with each property the lane needs appended to the
 * first line as a `[key::value]` token (where the outliner reads it as the card's own property), unless
 * the text already says so. A typed value that contradicts the lane is refused, never overwritten.
 * `defaults` (the lane's `[create::]`) are only added for keys the text doesn't set: a typed value
 * wins, and the lane's whole query is checked afterwards. `typed` is how the service reads the typed
 * text (properties.preview); null when it can't say, then a plain `[key::` scan stands in, only to avoid
 * adding a second value for a key the text sets.
 */
export function composeCardText(text: string, born: Prop[], typed: Prop[] | null, defaults: Prop[] = []): { text: string } | { refused: string } {
  const lines = text.replace(/\s+$/, "").split("\n");
  const seen = typed ?? scanTokens(text);
  const own = (key: string): string[] => seen.filter(p => p.key === key).map(p => p.value);
  const add: string[] = [];
  for (const p of born) {
    const have = own(p.key);
    if (have.some(v => v.toLowerCase() === p.value.toLowerCase())) continue;
    if (have.length) return { refused: `the text sets ${p.key}::${have.join(",")}, but the lane needs ${p.key}=${p.value}` };
    add.push(`[${p.key}::${p.value}]`);
  }
  for (const p of defaults) if (!own(p.key).length && !born.some(b => b.key === p.key)) add.push(`[${p.key}::${p.value}]`);
  if (add.length) lines[0] = `${lines[0]!.replace(/\s+$/, "")} ${add.join(" ")}`.trimStart();
  return { text: lines.join("\n") };
}

// ── roadmap items, through the workboard's allocator ──

/** The keys the allocator writes itself; the outliner refuses them in a roadmap item's title or body. */
const RESERVED = new Set(["type", "status", "priority", "work-stage", "work-batch", "project", "arc", "track", "depends-on", "related-to", "source-block", "work-id"]);
const PRIORITIES = ["high", "medium", "low"];
const REQUIRED = ["project", "priority", "arc", "track"] as const;

export interface RoadmapItemPlan {
  /** What `roadmap.items.create` is called with. */
  input: { title: string; body?: string; priority: string; workStage?: string; workBatchId?: string; project: string; arc: string; tracks: string[]; dependsOn?: string[]; relatedTo?: string[]; sourceBlockId?: string };
  /** The properties the item will have (all but its work-id), to check against the lane's whole query. */
  props: Prop[];
}

/** "project, priority and arc" */
const listed = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const idOf = (v: string) => v.replace(/^\(\((.*)\)\)$/, "$1").split("|")[0]!.trim();

/**
 * A new roadmap item in a roadmap lane, as the workboard's allocator takes it. Each field is the typed
 * text's `[key::value]` token, else the lane's plain clause (`born`), else its `[create::]` default:
 * project / work-stage / work-batch usually come from the lane (or the OR group the text picks), and
 * priority / arc / track(s) from the text. A typed value that contradicts a plain clause is refused; so is
 * a missing required field (all of them named at once), a stage items aren't created in, and a work-id
 * (the allocator issues it). The consumed tokens come out of the title and body, which the allocator
 * requires. Pure: `typed` is the service's reading of `text` (properties.preview), or null for a plain scan.
 */
export function planRoadmapItem(laneName: string, text: string, born: Prop[], defaults: Prop[], typed: Prop[] | null): RoadmapItemPlan | { refused: string } {
  const seen = typed ?? scanTokens(text);
  const own = (key: string) => seen.filter(p => p.key === key).map(p => p.value);
  for (const p of born) {
    const have = own(p.key);
    if (have.length && !have.some(v => v.toLowerCase() === p.value.toLowerCase()))
      return { refused: `the text sets ${p.key}::${have.join(",")}, but ${laneName} needs ${p.key}=${p.value}` };
  }
  if (own("work-id").length) return { refused: "the workboard's allocator issues the work-id; take [work-id::] out of the text" };
  if (own("status").length) return { refused: "roadmap items have no status (work-stage owns their stage); take [status::] out of the text" };
  const values = (key: string): string[] => {
    const t = own(key);
    if (t.length) return t;
    const b = born.filter(p => p.key === key).map(p => p.value);
    return b.length ? b : defaults.filter(p => p.key === key).map(p => p.value);
  };
  const one = (key: string): string | undefined | { refused: string } => {
    const v = [...new Map(values(key).map(x => [x.toLowerCase(), x])).values()];
    return v.length > 1 ? { refused: `the text sets ${key} to ${v.join(" and ")}; a roadmap item has one ${key}` } : v[0];
  };
  const fields: Record<string, string | undefined> = {};
  for (const key of ["project", "priority", "arc", "work-stage", "work-batch", "source-block"]) {
    const v = one(key);
    if (typeof v === "object") return v;
    fields[key] = v;
  }
  const tracks = [...new Map(values("track").map(x => [x.toLowerCase(), x])).values()];
  const missing = REQUIRED.filter(k => k === "track" ? !tracks.length : !fields[k]);
  if (missing.length) {
    const hint = missing.map(k => k === "priority" ? "[priority::high|medium|low]" : `[${k}::…]`).join(" ");
    return { refused: `${laneName} makes roadmap items through the workboard's allocator, which needs ${listed(missing.map(k => k === "track" ? "a track" : k))}: add ${hint} to the text` };
  }
  const priority = fields.priority!.toLowerCase();
  if (!PRIORITIES.includes(priority)) return { refused: `priority must be high, medium or low, not ${fields.priority}` };
  const stage = fields["work-stage"]?.toLowerCase();
  if (stage && NOT_CREATED_IN.has(stage)) return { refused: `roadmap items aren't created in ${stage}: create in Queued or Doing, then move` };
  if (typed && own("type").some(v => v.toLowerCase() !== "roadmap-item")) return { refused: `${laneName} lists roadmap items; the text sets type::${own("type").join(",")}` };

  // The title and body without the tokens the allocator writes itself.
  const stripped = text.replace(/[ \t]*\[([A-Za-z][\w.-]*)::[^\]\n]*\]/g, (all, k: string) => RESERVED.has(k.toLowerCase()) ? "" : all);
  const [first = "", ...rest] = stripped.split("\n");
  const title = first.trim();
  if (!title) return { refused: "type the item's title on the first line" };
  const body = rest.map(l => l.replace(/[ \t]+$/, "")).join("\n").trim();
  const workBatchId = fields["work-batch"] ? idOf(fields["work-batch"]) : undefined;
  const dependsOn = values("depends-on").map(idOf), relatedTo = values("related-to").map(idOf);
  const sourceBlockId = fields["source-block"] ? idOf(fields["source-block"]) : undefined;
  const input: RoadmapItemPlan["input"] = {
    title, ...(body ? { body } : {}), priority, ...(stage ? { workStage: stage } : {}), ...(workBatchId ? { workBatchId } : {}),
    project: fields.project!, arc: fields.arc!, tracks,
    ...(dependsOn.length ? { dependsOn } : {}), ...(relatedTo.length ? { relatedTo } : {}), ...(sourceBlockId ? { sourceBlockId } : {}),
  };
  // As the allocator writes them (store.ts createRoadmapItem): no stage means queued with a batch, else unprioritized.
  const props: Prop[] = [
    { key: "type", value: "roadmap-item" }, { key: "priority", value: priority }, { key: "work-stage", value: stage ?? (workBatchId ? "queued" : "unprioritized") },
    ...(workBatchId ? [{ key: "work-batch", value: workBatchId }] : []), { key: "project", value: input.project }, { key: "arc", value: input.arc },
    ...tracks.map(value => ({ key: "track", value })), ...dependsOn.map(value => ({ key: "depends-on", value })), ...relatedTo.map(value => ({ key: "related-to", value })),
    ...(sourceBlockId ? [{ key: "source-block", value: sourceBlockId }] : []),
    ...seen.filter(p => !RESERVED.has(p.key)),
  ];
  return { input, props };
}

export interface ParentPick { id: string; why: string }

/**
 * Where a new card in a lane goes: the lane's `[create-parent::<id>]`; else the parent most of the
 * lane's cards share, else most of the board's. "Most" means more than half: a board whose cards
 * are spread across parents gets no guess, and the reason says how to name one.
 */
export function pickParent(laneName: string, def: Msg | undefined, laneItems: Msg[], boardItems: Msg[]): ParentPick | { refused: string } {
  const named = def?.properties?.filter(p => p.key === "create-parent") ?? (def?.props["create-parent"] ? [{ key: "create-parent", value: def.props["create-parent"] }] : []);
  if (named.length > 1) return { refused: `${laneName} has more than one create-parent::` };
  if (named.length === 1) {
    const id = named[0]!.value.replace(/^\(\((.*)\)\)$/, "$1").trim();
    return { id, why: `${laneName}'s create-parent` };
  }
  const majority = (items: Msg[], where: string): ParentPick | null => {
    // A row's parent is only known when the service sent one; top-level cards don't vote for "top level".
    const withParent = items.filter(m => m.parentId);
    if (!withParent.length) return null;
    const tally = new Map<string, number>();
    for (const m of withParent) tally.set(m.parentId!, (tally.get(m.parentId!) ?? 0) + 1);
    const [id, n] = [...tally].sort((a, b) => b[1] - a[1])[0]!;
    return n * 2 > withParent.length ? { id, why: n === withParent.length ? `where ${where} cards live` : `where ${n} of ${withParent.length} ${where} cards live` } : null;
  };
  const dedupe = (items: Msg[]) => [...new Map(items.map(m => [m.id, m])).values()];
  const pick = majority(laneItems, `${laneName}'s`) ?? majority(dedupe(boardItems), "the board's");
  if (pick) return pick;
  return { refused: boardItems.length
    ? `the board's cards live under different parents; give ${laneName} a [create-parent::<block id>] to say where new cards go`
    : `there's no card on the board to take a parent from; give ${laneName} a [create-parent::<block id>]` };
}

/** "Paint the shed": a card's title for a flash, kept short. */
export const titleOf = (m: Msg, n = 50) => { const t = subject(m); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
