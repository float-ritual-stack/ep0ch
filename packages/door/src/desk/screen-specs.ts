// The screens the door knows by name (PIE-515): each a spec (src/desk/screen-spec.ts) on the one screen host, the
// desk, and the tile kinds those specs use, registered once as the door starts. `openScreen` makes one.
import type { Screen } from "../app";
import { briefKind, briefSpec } from "../brief/brief";
import { pinnedKind, pinnedSpec } from "../hub/pinned";
import { WAITING_KIND, waitingSpec } from "../hub/waiting";
import { welcomeKinds, welcomeSpec } from "../hub/welcome";
import { HOME_KIND, homeSpec } from "../home";
import { boardSpec } from "./delivery";
import { BLANK_KIND, blankSpec } from "./blank";
import { riverSpec } from "../river/column";
import { Desk, deskSpec } from "./desk";
import { registerScreen, screenNames, screenSpec, screenTargetArg } from "./screen-spec";
import { registerTileKind, tileKind } from "./tile-kinds";

/** The built-in screens' kinds and specs (once: every module that opens a screen asks). */
export function registerBuiltinScreens(): void {
  for (const k of [WAITING_KIND, ...welcomeKinds(), briefKind(), pinnedKind(), HOME_KIND, BLANK_KIND]) if (!tileKind(k.kind)) registerTileKind(k);
  const have = new Set(screenNames());
  const add = (name: string, of: Parameters<typeof registerScreen>[1], target?: string) => { if (!have.has(name)) registerScreen(name, of, target ? { target } : {}); };
  add("desk", () => deskSpec());
  add("waiting", () => waitingSpec());
  add("welcome", () => welcomeSpec());
  add("brief", () => briefSpec());
  add("pinned", args => pinnedSpec(args), "address");
  add("board", args => boardSpec(args), "hub");
  add("river", () => riverSpec());
  // A blank screen (PIE-565): one tile to build from; ^W w saves what's built as a screen note.
  add("blank", () => blankSpec());
  add("detail", args => {
    const note = typeof args?.note === "string" ? args.note : "";
    return {
      name: "detail", title: "detail", lands: "detail", digits: false,
      layout: { focus: "detail", root: { t: "leaf", kind: "detail", name: "detail", ...(note ? { note } : {}) } },
    };
  }, "note");
  // The home base (src/home.ts): what bare `ep0ch` opens where no outline is named; its args are where it was opened.
  add("home", args => homeSpec(args ?? {}));
  // The BBS menu's W and L: the who and activity tiles as screens (the activity's ⏎ shows its note in the reader).
  add("who", () => ({ name: "who", title: "who's online", layout: { focus: "who", root: { t: "leaf", kind: "who", name: "who" } } }));
  add("lastcall", () => ({ name: "lastcall", title: "last callers", layout: { focus: "activity", root: { t: "split", dir: "row", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "activity", name: "activity" }, { t: "leaf", kind: "reader", name: "reader" }] } } }));
}
registerBuiltinScreens();

/**
 * The screen named `name`, made from its spec: a new desk showing it (the desk itself comes back running when it was
 * left with programs: `Desk.resume`). Throws when there's no such screen.
 */
export function openScreen(name: string, args?: Record<string, unknown>): Screen {
  if (name === "desk") return Desk.resume();
  const spec = screenSpec(name, args);
  if (!spec) throw new Error(`no screen ${name}; screens: ${screenNames().join(", ")}`);
  // `persist: false`: it comes back as its screen was saved, and never saves (a screen in a tile, which the desk saves).
  // What it was opened on (its target: detail's note, the board's hub), so a session brings it back on the same.
  const arg = screenTargetArg(name), target = arg ? args?.[arg] : undefined;
  return new Desk(spec, { writes: args?.persist !== false, ...(typeof target === "string" && target ? { openArgs: { target } } : {}) });
}
