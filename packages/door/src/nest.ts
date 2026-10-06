// Where am I: EP0CH_NEST, the stack of layers a program runs in, outermost first, one line.
//
//   ssh:pts/5 › herdr:w1:p1 › door:1388380/drawer/drawer.agent:claude › herdr:door-pie-1a2b3c4d
//
// Each layer appends itself as it starts the next, since each one only knows its own variables:
// - a door, in each terminal tile's environment (`tileEnv`): `door:<pid>/<layout or screen>/<tile id>:<tile name>`;
// - before that, what the door inherited and the nest doesn't record yet: an ssh session (`ssh:<tty>`, or
//   `ssh:-` without a tty: the client's address is never recorded) and the Herdr pane it runs in (`herdr:<workspace>:<pane>`), which
//   `tileEnv` then drops so a tile can't claim that pane;
// - a door's drop shell (`screen.shell`, src/drop.ts): `shell:<door pid>`, the door waiting under it;
// - the Herdr launcher (scripts/door-agent-herdr.ts), for the pane it makes for the agent: `herdr:<pane label>`.
//
// The nest says how the program was started, not what is true now: a tile moved to another layout keeps its
// launch-time place, and the Herdr agent's pane keeps the door that made it while another door shows it.
// `ep0ch where` (src/where.ts) checks each layer and says what is live.
import { printable } from "./text";

export const NEST_SEP = " › ";
/** The longest nest: past it, the oldest layers after the first go, replaced by one `…`. */
export const NEST_MAX = 480;
const LAYER_MAX = 120;

export type Layer =
  | { kind: "ssh"; raw: string; tty: string | null; from: string | null }
  | { kind: "herdr"; raw: string; pane: string }
  | { kind: "door"; raw: string; pid: number; place: string; tileId: string | null; tile: string }
  | { kind: "shell"; raw: string; pid: number }
  | { kind: "other"; raw: string };

/** One layer as it goes in the nest: one line, no separator inside, capped. */
export function cleanLayer(s: string): string {
  return printable(s, " ").replaceAll("›", ">").trim().slice(0, LAYER_MAX);
}

export const nestLayers = (nest: string | undefined | null): string[] => (nest ?? "").split(NEST_SEP).map(s => s.trim()).filter(Boolean);

/** The layer standing for the ones `appendNest` dropped to keep the nest under NEST_MAX. */
export const ELIDED = "…";

/**
 * `nest` with `layers` appended, kept under NEST_MAX by dropping the oldest layers after the first. The inherited
 * nest is cleaned as the new layers are (it is only an environment variable: anything may have set it), so a
 * newline or an overlong layer in it can't reach an agent's context or push the newest layers out.
 */
export function appendNest(nest: string | undefined | null, ...layers: string[]): string {
  const all = [...nestLayers(nest), ...layers].map(cleanLayer).filter(Boolean);
  const join = (l: string[]) => l.join(NEST_SEP);
  while (join(all).length > NEST_MAX && all.length > 2) {
    if (all[1] === ELIDED) { if (all.length <= 3) break; all.splice(2, 1); } else all.splice(1, 1, ELIDED);
  }
  return join(all).slice(0, NEST_MAX);
}

export function parseLayer(raw: string): Layer {
  const door = /^door:(\d+)\/([^/]*)\/([^:]*):(.*)$/.exec(raw);
  if (door) return { kind: "door", raw, pid: Number(door[1]), place: door[2]!, tileId: door[3] && door[3] !== "-" ? door[3] : null, tile: door[4]! };
  const shell = /^shell:(\d+)$/.exec(raw);
  if (shell) return { kind: "shell", raw, pid: Number(shell[1]) };
  if (raw.startsWith("ssh:")) {
    const v = raw.slice(4);
    return /^(pts|tty)/.test(v) ? { kind: "ssh", raw, tty: v, from: null } : { kind: "ssh", raw, tty: null, from: v && v !== "-" ? v : null };
  }
  if (raw.startsWith("herdr:") && raw.length > 6) return { kind: "herdr", raw, pane: raw.slice(6) };
  return { kind: "other", raw };
}

/** The layer a door writes for one of its tiles. */
export function doorLayer(pid: number, place: string | null | undefined, tileId: string | null | undefined, tile: string): string {
  return cleanLayer(`door:${pid}/${(place || "desk").replaceAll("/", "-").replaceAll(":", "-")}/${tileId || "-"}:${tile || "tile"}`);
}

/** The layer a door writes for its drop shell (`screen.shell`): the shell runs in the door's own terminal, the door waiting under it. */
export const shellLayer = (pid: number): string => `shell:${pid}`;

/** The Herdr pane these variables name: `<workspace>:<pane>` (Herdr's pane ids already carry the workspace). */
export function herdrPaneOf(env: Record<string, string | undefined>): string | null {
  const pane = env.HERDR_PANE_ID?.trim();
  if (!pane) return null;
  const ws = env.HERDR_WORKSPACE_ID?.trim();
  return pane.includes(":") || !ws ? pane : `${ws}:${pane}`;
}

/**
 * The layers outside this process that its environment shows and `nest` doesn't record yet, outermost first:
 * the ssh session (unless the nest has one: ssh doesn't pass EP0CH_NEST on, so a recorded one is this one),
 * then the Herdr pane (unless the nest ends in a Herdr layer, such as the launcher's `herdr:door-pie-1a2b3c4d`,
 * which is that same pane under its label).
 */
export function outerLayers(env: Record<string, string | undefined>, nest: string | undefined | null): string[] {
  const had = nestLayers(nest).map(parseLayer);
  const out: string[] = [];
  if (!had.some(l => l.kind === "ssh")) {
    const tty = env.SSH_TTY?.trim().replace(/^\/dev\//, "");
    const from = (env.SSH_CONNECTION ?? env.SSH_CLIENT)?.trim().split(/\s+/)[0];
    if (tty) out.push(`ssh:${tty}`);
    else if (from) out.push("ssh:-");
  }
  const pane = herdrPaneOf(env);
  if (pane && had.at(-1)?.kind !== "herdr" && !had.some(l => l.kind === "herdr" && l.pane === pane)) out.push(`herdr:${pane}`);
  return out;
}

/** The nest a door runs in: what it was started with, plus the outer layers it inherited that aren't in it yet. */
export const doorNest = (env: Record<string, string | undefined>): string => appendNest(env.EP0CH_NEST, ...outerLayers(env, env.EP0CH_NEST));
