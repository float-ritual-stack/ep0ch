// A hint row's segment is a click, and the click runs the binding its key does, with the arguments the key gives it
// (PIE-1293): never an action short of an argument, refused. Every key table's hint is drawn and each segment's click
// checked against the action's own arguments; the reader's hint is drawn on a note and every segment clicked.
import { describe, expect, test } from "bun:test";
import type { Msg } from "../src/board";
import "../src/app";
import "../src/screens";
import * as attached from "../src/surface/attached-keys";
import * as parts from "../src/hint-parts";
import { AGENTS_KEYS } from "../src/desk/agents-panel";
import { ActionRefused, allActionSets, coerceActionArgs, executable } from "../src/surface/actions";
import { keyTables } from "../src/surface/keymap";
import { modeHint, partsHint, type HintPart, type ModeKey } from "../src/surface/modes";
import { stripSegments } from "../src/surface/strip-state";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";

/** What a click on each segment of `hint` would run, refused if it is short of an argument: one line per problem. */
function shortClicks(where: string, hint: string): string[] {
  return stripSegments(hint).flatMap(t => {
    const hit = t.hit;
    if (!hit?.action) return [];
    const specs = allActionSets().map(s => s.argsOf(hit.action)).filter(Boolean);
    if (!specs.length) return [`${where}: "${t.label}" runs ${hit.action}, which no action set has`];
    const refusals = specs.map(spec => { try { coerceActionArgs(hit.action, spec!, { ...(hit.args ?? {}) }); return null; } catch (e) { return e instanceof ActionRefused ? e.message : String(e); } });
    // The host binds a `context` argument (the block in front, the tile): only what the person would be asked counts.
    return refusals.every(r => r !== null) && !executable(hit.action, hit.args ?? {}) ? [`${where}: "${t.label}" runs ${hit.action} refused: ${refusals[0]}`] : [];
  });
}

/** An action's own words, for a row with no label of its own: any set that has it. */
const about = (action: string) => ({ summary: allActionSets().map(s => s.def(action)?.summary).find(Boolean) ?? action });

const tables = (): [string, readonly ModeKey[]][] => [
  ...keyTables().map(t => [`table ${t.scope}`, t.rows as readonly ModeKey[]] as [string, readonly ModeKey[]]),
  ["AGENTS_KEYS", AGENTS_KEYS],
  ...Object.entries(attached).filter(([, v]) => Array.isArray(v) && (v as unknown[]).every(r => r && typeof r === "object" && "action" in (r as object))).map(([k, v]) => [`attached-keys ${k}`, v as readonly ModeKey[]] as [string, readonly ModeKey[]]),
];

describe("hint clicks run their key's binding (PIE-1293)", () => {
  test("no segment of any key table's hint is a click short of its action's arguments", () => {
    const problems = tables().flatMap(([where, rows]) => shortClicks(where, modeHint(rows, about)));
    const hintParts = Object.entries(parts).filter(([, v]) => v && typeof v === "object" && "action" in (v as object)) as [string, HintPart][];
    problems.push(...hintParts.flatMap(([k, p]) => shortClicks(`hint-parts ${k}`, partsHint([p]))));
    problems.push(...shortClicks("hint-parts readerHeldParts", partsHint(parts.readerHeldParts(true, "the edit"))), ...shortClicks("drawer foot", parts.drawerFoot(true)), ...shortClicks("drawer title", parts.drawerTitleHint()));
    expect(problems).toEqual([]);
  });

  test("the reader's hint: j k [ ] ( ) are clicks with the step their key takes, and clicking every segment is never refused for an argument", async () => {
    const msg: Msg = { id: "11111111-2222-4333-8444-555555555555", text: "Plan the allotment\nBeans along the fence.\n\n## Beds\n- bed one\n- bed two\n\n## Tools\n- spade", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, properties: [] };
    const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
    const s = new NoteSurface(), h = host();
    s.show(msg, h);
    s.render(60, 20, h);
    const segments = stripSegments(s.hint()).filter(t => t.hit);
    const step = segments.find(t => t.hit!.action === "reading.step");
    expect(step?.hit?.args).toMatchObject({ by: expect.any(Number) });
    expect(segments.some(t => t.hit!.action === "fold.select" && typeof t.hit!.args?.by === "number")).toBe(true);
    const short: string[] = [];
    for (const t of segments) {
      try { await s.runKey(t.hit!.action as never, (t.hit!.args ?? {}) as never, h); }
      catch (e) { if (e instanceof ActionRefused && / needs /.test(e.message)) short.push(`${t.label}: ${e.message}`); }
    }
    expect(short).toEqual([]);
  });
});
