// `ep0ch where [--json]`: which stack of layers this process runs in, each layer checked, and where the person's
// keys are. Read-only: it reads EP0CH_NEST (src/nest.ts), asks the door on EP0CH_CONTROL for `peek` (the same
// state `layout.get` and `view.get` give, without an agent's act being announced on the person's screen), and
// lists Herdr's panes (`herdr pane list`). Nothing is moved, opened or written.
//
// It answers with no door ("not in a door"), with a door gone, and with a door older than the fields it reads
// (`pid`, `nest`, tile ids): it says what it couldn't check instead of guessing.
import { connect } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { alive } from "./state";
import { herdrBin, herdrRunner, type HerdrRun } from "./desk/herdr-agent";
import { appendNest, ELIDED, nestLayers, outerLayers, parseLayer, type Layer } from "./nest";

/** One layer, checked: `live` true, false (gone), or null (couldn't tell); `why` says what was looked at. */
export interface WhereLayer { kind: Layer["kind"] | "tile"; label: string; raw: string; live: boolean | null; why: string }
export interface WhereKeys { mine: boolean | null; typing: boolean | null; tile: string | null; text: string }
export interface Where {
  inDoor: boolean;
  /** EP0CH_NEST as this process got it (null: unset). */
  recorded: string | null;
  /** The nest with the outer layers the environment shows and the nest lacks (a shell ssh'd straight in). */
  nest: string;
  layers: WhereLayer[];
  door: null | {
    pid: number | null; control: string | null; answers: boolean; screen: string | null; outline: string | null; workspace: string | null;
    /** `dock`: the tile is the door's agent drawer (PIE-498), not a desk tile. */
    tile: { id: string | null; name: string | null; found: boolean; shown: boolean | null; focused: boolean | null; descends: boolean | null; dock?: boolean } | null;
    /** The door that answers isn't the one in the nest: the Herdr agent's pane, now shown by another door. */
    moved: boolean;
  };
  keys: WhereKeys;
  /** One line for an agent's context. */
  summary: string;
}

/** What `where` reads from outside: injected in tests. */
export interface WhereDeps {
  env: Record<string, string | undefined>;
  pid: number;
  /** The door's answer to `peek` on this socket, or null when none answers. */
  peek(control: string): Promise<any | null>;
  /** Herdr, when there's one to ask (read-only commands only). */
  herdr: HerdrRun | null;
  alive(pid: number): boolean;
  ttyExists(tty: string): boolean;
  /** This process's ancestors' pids, nearest first (empty where it can't tell). */
  ancestors(pid: number): number[];
}

/** `peek` on a control socket; null when nothing answers in `timeoutMs`. Reads only. */
export function peekDoor(path: string, timeoutMs = 2000): Promise<any | null> {
  return new Promise(res => {
    let done = false, buf = "";
    const finish = (v: any | null) => { if (done) return; done = true; clearTimeout(timer); try { c.destroy(); } catch { /* gone */ } res(v); };
    const c = connect(path, () => c.write(JSON.stringify({ cmd: "peek" }) + "\n"));
    const timer = setTimeout(() => finish(null), timeoutMs);
    c.on("data", d => {
      buf += d.toString();
      const i = buf.indexOf("\n");
      if (i < 0) return;
      try { const r = JSON.parse(buf.slice(0, i)); finish(r?.ok ? r.result : null); } catch { finish(null); }
    });
    c.on("error", () => finish(null));
    c.on("close", () => finish(null));
  });
}

function procAncestors(pid: number): number[] {
  const out: number[] = [];
  let p = pid;
  for (let i = 0; i < 64; i++) {
    let stat: string;
    try { stat = readFileSync(`/proc/${p}/stat`, "utf8"); } catch { return out; }
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    if (!(ppid > 1)) return out;
    out.push(ppid); p = ppid;
  }
  return out;
}

export const realDeps = (): WhereDeps => {
  const bin = herdrBin();
  return {
    env: process.env, pid: process.pid, peek: p => peekDoor(p),
    herdr: bin ? herdrRunner(bin, 3000) : null,
    alive, ttyExists: t => existsSync(`/dev/${t}`), ancestors: procAncestors,
  };
};

const json = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };

export async function where(d: WhereDeps): Promise<Where> {
  const env = d.env;
  const recorded = env.EP0CH_NEST?.trim() || null;
  const nest = appendNest(recorded, ...(recorded ? [] : outerLayers(env, null)));
  const parsed = nestLayers(nest).map(parseLayer);
  const control = env.EP0CH_CONTROL || null;
  const doors = parsed.filter((l): l is Extract<Layer, { kind: "door" }> => l.kind === "door");
  const inner = doors.at(-1) ?? null;
  const herdrs = parsed.filter((l): l is Extract<Layer, { kind: "herdr" }> => l.kind === "herdr");
  // The Herdr agent's pane: the nest ends in the launcher's `herdr:<label>` after the door that made it.
  const agentPane = parsed.at(-1)?.kind === "herdr" && inner ? (parsed.at(-1) as Extract<Layer, { kind: "herdr" }>).pane : null;
  // A door's drop shell (`screen.shell`): the nest ends in `shell:<door pid>`, with the door waiting under it.
  const inShell = parsed.at(-1)?.kind === "shell";

  const [peek, panes] = await Promise.all([
    control ? d.peek(control) : Promise.resolve(null),
    d.herdr && herdrs.length ? d.herdr(["pane", "list"]).then(r => (r.code === 0 ? json(r.out)?.result?.panes : null), () => null) : Promise.resolve(null),
  ]);
  const paneList: any[] | null = Array.isArray(panes) ? panes : null;

  // ── the door and the tile, from the door that answers ──
  const state = peek?.screen?.state;
  const desk = state?.kind === "desk" ? state : null;
  const tilePanes: any[] = Array.isArray(desk?.panes) ? desk.panes : [];
  const myTileId = inner?.tileId ?? env.EP0CH_TILE_ID ?? null;
  const myTileName = inner?.tile ?? env.EP0CH_TILE ?? null;
  const ancestors = d.ancestors(d.pid);
  // The door's agent drawer (PIE-498): a tile the App owns, on every screen, up (`shown`) or put away.
  const dv = peek?.screen?.dock;
  const dockTile = dv?.tile?.id ? { id: dv.tile.id, name: dv.tile.name, shown: !!dv.shown, focused: !!dv.entered, herdr: dv.herdr, terminal: dv.terminal, dock: true } : null;
  // In the Herdr agent's pane, "my tile" is whichever tile shows that pane now; elsewhere the tile by id, else name.
  let tile = agentPane ? tilePanes.find(p => p?.herdr?.pane === agentPane) ?? (dockTile?.herdr?.pane === agentPane ? dockTile : undefined) : undefined;
  if (!tile && !agentPane && dockTile && myTileId === dockTile.id) tile = dockTile;
  if (!tile && !agentPane) tile = tilePanes.find(p => myTileId && p?.id === myTileId) ?? (tilePanes.some(p => p?.id) ? undefined : tilePanes.find(p => p?.name === myTileName));
  const answeringPid = typeof peek?.screen?.pid === "number" ? peek.screen.pid : null;
  const inDoor = !!(inner || control);
  const moved = !!(inner && answeringPid !== null && answeringPid !== inner.pid);
  const tpid = typeof tile?.terminal?.pid === "number" ? tile.terminal.pid : null;
  const door: Where["door"] = inDoor ? {
    pid: answeringPid ?? inner?.pid ?? null, control, answers: !!peek, moved,
    screen: peek?.screen?.screen ?? null, outline: peek?.screen?.outline ?? null, workspace: peek?.screen?.workspace ?? null,
    tile: myTileId || myTileName || agentPane ? {
      id: tile?.id ?? myTileId, name: tile?.name ?? myTileName, found: !!tile,
      shown: tile ? tile.shown !== false : null, focused: tile ? !!tile.focused : null,
      descends: tpid !== null && ancestors.length ? ancestors.includes(tpid) || d.pid === tpid : null,
      ...(tile?.dock ? { dock: true } : {}),
    } : null,
  } : null;

  // ── each layer, checked ──
  const layers: WhereLayer[] = [];
  const herdrPane = (pane: string) => paneList?.find(p => p?.pane_id === pane || p?.label === pane);
  for (const l of parsed) {
    if (l.kind === "ssh") {
      const live = l.tty ? d.ttyExists(l.tty) : null;
      layers.push({ kind: "ssh", raw: l.raw, label: l.tty ?? (l.from ? `from ${l.from}` : "no tty"), live, why: l.tty ? (live ? `/dev/${l.tty} is there` : `/dev/${l.tty} is gone`) : "no tty to check" });
    } else if (l.kind === "herdr") {
      const p = herdrPane(l.pane);
      const live = paneList ? !!p : null;
      const why = !d.herdr ? "herdr isn't on PATH" : !paneList ? "Herdr didn't answer" : p ? `in Herdr${p.label && p.label !== l.pane ? ` as ${p.label}` : ""}${p.pane_id !== l.pane ? ` (${p.pane_id})` : ""}${p.focused ? " · focused" : ""}` : "no such pane in Herdr now";
      layers.push({ kind: "herdr", raw: l.raw, label: `pane ${l.pane}`, live, why });
    } else if (l.kind === "door") {
      const isInner = l === inner;
      const up = d.alive(l.pid);
      const why = !up ? "not running" : !isInner ? "running" : peek
        ? (moved ? `running · the door on EP0CH_CONTROL is pid ${answeringPid}, which shows this pane now` : `running · its control socket answers`)
        : control ? "running · its control socket doesn't answer" : "running";
      layers.push({ kind: "door", raw: l.raw, label: `pid ${l.pid} · ${l.place}${isInner && peek?.screen?.outline ? ` · outline ${peek.screen.outline}` : ""}`, live: up, why });
      if (isInner && !agentPane) layers.push(tileLayer(l.tileId, l.tile, door!.tile, peek, desk, moved));
    } else if (l.kind === "shell") {
      const up = d.alive(l.pid);
      const waits = l === parsed.at(-1) && peek?.screen?.suspended === "shell";
      layers.push({ kind: "shell", raw: l.raw, label: `door pid ${l.pid}`, live: up,
        why: !up ? "the door is gone" : waits ? "the door's drop shell · the door waits under it" : "the door's drop shell · the door is running" });
    } else layers.push({ kind: "other", raw: l.raw, label: l.raw, live: null, why: l.raw === ELIDED ? "older layers left out (EP0CH_NEST keeps the first and the newest)" : "not a layer this door knows" });
  }
  // A door older than EP0CH_NEST: the tile from its variables alone.
  if (!inner && control && !inShell) {
    layers.push({ kind: "door", raw: "", label: `${answeringPid ? `pid ${answeringPid}` : "a door"}${peek?.screen?.outline ? ` · outline ${peek.screen.outline}` : ""}`, live: peek ? true : null, why: peek ? "its control socket answers (a door older than EP0CH_NEST)" : "its control socket doesn't answer" });
    layers.push(tileLayer(myTileId, myTileName ?? "?", door!.tile, peek, desk, false));
  }
  // In the Herdr agent's pane: the tile showing it now, whichever door that is.
  if (agentPane && door) {
    const t = door.tile;
    layers.push({ kind: "tile", raw: "", label: t?.found ? `shown in ${t.dock ? "the agent drawer" : "tile"} ${t.id ?? "?"} ${t.name}${moved ? ` of door ${answeringPid}` : ""}` : "shown in no tile",
      live: peek ? !!t?.found : null, why: !peek ? "no door answers on EP0CH_CONTROL (the agent runs on in Herdr)" : t?.found ? "the tile attached to this pane" : "no tile of the door shows this pane" });
  }

  const keys = inShell && peek?.screen?.suspended === "shell"
    ? { mine: true, typing: true, tile: null, text: "the person is in the door's shell (the door waits under it until it exits)" }
    : keysOf(peek, desk, door, agentPane, paneList, env);
  const summary = summaryOf(nest, layers, keys, inDoor);
  return { inDoor, recorded, nest, layers, door, keys, summary };
}

function tileLayer(id: string | null, name: string, t: NonNullable<Where["door"]>["tile"], peek: any, desk: any, moved: boolean): WhereLayer {
  const label = `tile ${id ?? "?"} ${name}`;
  if (!peek || moved) return { kind: "tile", raw: "", label, live: null, why: peek ? "another door answers" : "no door to ask" };
  if (t?.dock) return { kind: "tile", raw: "", label, live: true, why: `the agent drawer, on every screen · ${t.shown ? "pulled up" : "put away"}${t.descends === true ? " · this process runs in it" : ""}` };
  if (!desk) return { kind: "tile", raw: "", label, live: null, why: `the door is on ${peek.screen?.screen ?? "another screen"}, not the desk: the tile runs in the background` };
  if (!t?.found) return { kind: "tile", raw: "", label, live: false, why: "the desk has no such tile now" };
  return { kind: "tile", raw: "", label, live: true, why: `on the desk${t.shown ? "" : " (hidden: a drawer or another tab)"}${t.descends === true ? " · this process runs in it" : t.descends === false ? " · but this process isn't its program's" : ""}` };
}

function keysOf(peek: any, desk: any, door: Where["door"], agentPane: string | null, panes: any[] | null, env: Record<string, string | undefined>): WhereKeys {
  if (door && peek) {
    const screen = peek.screen?.screen ?? "?";
    // The person typing in the agent drawer (PIE-498): over any screen, the desk's focus doesn't matter then.
    if (peek.screen?.dock?.entered) {
      const mine = !!door.tile?.dock || (!!agentPane && peek.screen.dock.herdr?.pane === agentPane);
      return { mine, typing: true, tile: peek.screen.dock.tile?.id ?? null, text: mine ? "the person is typing in this tile (the agent drawer)" : `the person is typing in the agent drawer over the ${screen}, not this tile` };
    }
    if (!desk) return { mine: false, typing: false, tile: null, text: `the person is on the door's ${screen} screen, not the desk` };
    const mine = door.tile?.found ? door.tile.name : null;
    const focus: string | null = desk.focusName ?? null;
    const typingIn: string | null = desk.inTerminal ?? null;
    const f = (desk.panes as any[] ?? []).find(p => p?.name === focus);
    const ref = f ? `${f.id ? `${f.id} ` : ""}${f.name}` : focus ?? "?";
    if (mine && focus === mine) return typingIn === mine
      ? { mine: true, typing: true, tile: ref, text: `the person is typing in this tile (${ref})` }
      : { mine: true, typing: false, tile: ref, text: `this tile (${ref}) is focused, but the door has the keys (not typing in it)` };
    return { mine: false, typing: typingIn !== null, tile: ref, text: `the person is on tile ${ref}${typingIn ? ", typing in it" : ""}, not this one` };
  }
  if (door) return { mine: null, typing: null, tile: null, text: "unknown: no door answers" };
  const here = env.HERDR_PANE_ID;
  const p = here && panes?.find(x => x?.pane_id === here);
  if (p) return { mine: !!p.focused, typing: null, tile: null, text: p.focused ? "this Herdr pane is focused" : "another Herdr pane is focused" };
  return { mine: null, typing: null, tile: null, text: "unknown: no door and no Herdr pane to ask" };
}

function summaryOf(nest: string, layers: WhereLayer[], keys: WhereKeys, inDoor: boolean): string {
  const gone = layers.filter(l => l.live === false).map(l => `${l.kind} ${l.label}`);
  return [
    nest ? `stack: ${nest}` : "stack: (nothing recorded)",
    !inDoor ? "not in a door" : null,
    gone.length ? `gone: ${gone.join(", ")}` : null,
    `keys: ${keys.text}`,
  ].filter(Boolean).join(" · ");
}

const MARK = (live: boolean | null) => (live === true ? "✓" : live === false ? "✗" : "?");

export function formatWhere(w: Where): string {
  const out = [w.nest ? `you are in: ${w.nest}` : "you are in: (no layers recorded: EP0CH_NEST is unset and no ssh or Herdr is seen)"];
  if (!w.inDoor) out.push("not in a door");
  const width = Math.max(0, ...w.layers.map(l => l.label.length));
  for (const l of w.layers) out.push(`  ${MARK(l.live)} ${l.kind.padEnd(5)} ${l.label.padEnd(width)}  ${l.why}`);
  out.push(`keys: ${w.keys.text}`);
  return out.join("\n");
}

export async function whereCommand(args: string[], deps = realDeps()): Promise<number> {
  const w = await where(deps);
  console.log(args.includes("--json") ? JSON.stringify(w, null, 2) : formatWhere(w));
  return 0;
}
