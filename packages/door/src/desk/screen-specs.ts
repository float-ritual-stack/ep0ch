// The screens the door knows by name (PIE-515): each a spec (src/desk/screen-spec.ts) on the one screen host, the
// desk, and the tile kinds those specs use, registered once as the door starts. `openScreen` makes one.
import type { Screen } from "../app";
import { briefKind, briefSpec } from "../brief/brief";
import { nowPage } from "../hub/now";
import type { ScreenSpec } from "./screen-spec";
import { welcomeKinds, welcomeSpec } from "../hub/welcome";
import { HOME_KIND, homeSpec } from "../home";
import { boardSpec } from "./delivery";
import { BLANK_KIND, blankSpec } from "./blank";
import { LIBRARY_KIND, librarySpec } from "../library/library";
import { KEYS_KIND, keysSpec } from "./keys-window";
import { SETTINGS_INDEX_KIND, settingsScreenSpec } from "./settings-index";
import { echoKinds, echonetSpec } from "../echonet/screen";
import { riverSpec } from "../river/column";
import { Desk, deskSpec, type DeskOpts } from "./desk";
import { extensionScreen, forgetScreen, groupSpec, mountProblem, partSpec, registerScreen, screenNames, screenSpec, screenTargetArg } from "./screen-spec";
import { SHIPPED_EXTENSION } from "./shipped";
import { holdShippedScreens } from "./shipped-screens";
import type { Pane } from "./panes";
import { outlineState, readState } from "../state";
import { registerTileKind, tileKind } from "./tile-kinds";

/**
 * A page pinned on a screen of its own (`screen.open name=pinned address=<page>`): a reader pinned to the page, waiting
 * for it to exist; opens from it land beside it. `address` its name (as in `[[claude-now]]`), `label` the screen's title.
 */
export function pinnedSpec(args: { address?: unknown; label?: unknown } = {}): ScreenSpec {
  const now = nowPage();
  const address = typeof args.address === "string" && args.address ? args.address : now.address;
  const label = typeof args.label === "string" && args.label ? args.label : now.label;
  return { name: "pinned", title: label, lands: "pinned", layout: { focus: "pinned", root: { t: "leaf", kind: "reader", name: "pinned", mode: "pinned", page: address, label } } };
}

/** The built-in screens' kinds and specs (once: every module that opens a screen asks). */
export function registerBuiltinScreens(): void {
  for (const k of [...welcomeKinds(), briefKind(), HOME_KIND, BLANK_KIND, LIBRARY_KIND, KEYS_KIND, SETTINGS_INDEX_KIND, ...echoKinds()]) if (!tileKind(k.kind)) registerTileKind(k);
  const have = new Set(screenNames());
  // A name the shipped extension's served copy took before this module loaded (a test that binds extensions first)
  // is the door's own again: a built-in stands under its name whichever loaded first.
  const add = (name: string, of: Parameters<typeof registerScreen>[1], target?: string) => {
    if (have.has(name) && extensionScreen(name) === SHIPPED_EXTENSION) { forgetScreen(name); have.delete(name); }
    if (!have.has(name)) registerScreen(name, of, target ? { target } : {});
  };
  add("desk", () => deskSpec());
  add("welcome", () => welcomeSpec());
  add("brief", () => briefSpec());
  add("pinned", args => pinnedSpec(args), "address");
  add("board", args => boardSpec(args), "hub");
  add("river", () => riverSpec());
  // EchoNet's message areas (PIE-779): echomail across the outlines this door reaches.
  add("echonet", () => echonetSpec());
  // A blank screen (PIE-565): one tile to build from; ^W w saves what's built as a screen note.
  add("blank", () => blankSpec());
  // The component library (PIE-618): a page per component schema; its args say which component and part it opens on.
  add("library", args => librarySpec(args ?? {}), "component");
  // The keys window (PIE-492): every binding, filtered by the words it was opened with (`?` passes where you are).
  add("keys", args => keysSpec(args ?? {}), "filter");
  // The settings screen (PIE-1709): every place a setting lives on the left, the chosen extension's settings card on the right.
  add("settings", args => settingsScreenSpec(args ?? {}), "ext");
  add("detail", args => {
    const note = typeof args?.note === "string" ? args.note : "";
    return {
      name: "detail", title: "detail", lands: "detail", digits: false,
      layout: { focus: "detail", root: { t: "leaf", kind: "reader", name: "detail", ...(note ? { note } : {}) } },
    };
  }, "note");
  // The home base (src/home.ts): what bare `ep0ch` opens where no outline is named; its args are where it was opened.
  add("home", args => homeSpec(args ?? {}));
  // The screens every door ships that are data alone (the navigator, last callers, who's online) are the screens
  // extension's (packages/outliner/extensions/screens), not literals here: held from its manifest (desk/shipped.ts),
  // and as a host serves them once it has (src/extensions.ts `bindScreens`).
  holdShippedScreens();
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

/**
 * The desk inside a mount (PIE-651): screen `m.screen`'s spec (its part `m.part` alone, `partSpec`), or a group's own
 * tree, laid out as `m.saved` (the mount's tile spec keeps it). It never writes the full screen's file: a save is the
 * screen holding the mount saving (`onSave`). A whole screen's first mount starts as its full screen was last left
 * (its file read, never written); a part's takes only what its models kept (the hub the board remembers).
 */
export function mountDesk(m: { screen: string | null; args?: Record<string, unknown>; part?: string | null; saved?: unknown; label?: string; given?: ReadonlyMap<string, Pane>; chain?: readonly string[] },
  opts: Pick<DeskOpts, "onSave" | "outward" | "where">): Desk {
  const chain = m.chain ?? [];
  if (!m.screen) {
    const root = (m.saved as { root?: unknown } | undefined)?.root;
    if (!root) throw new Error("a group with no tiles in it");
    return new Desk(groupSpec(root, m.label), { saved: m.saved, ...(m.given ? { given: m.given, adopt: true } : {}), writes: false, chain, ...opts });
  }
  if (m.screen === "desk") throw new Error("the desk holds mounts; it isn't mounted in itself");
  // Refused here, so a saved screen that holds itself comes back with this mount a place holder that says why.
  const loop = mountProblem(chain, m.screen, !!m.part);
  if (loop) throw new Error(loop);
  const full = screenSpec(m.screen, m.args);
  if (!full) throw new Error(`no screen ${m.screen}; screens: ${screenNames().join(", ")}`);
  const spec = m.part ? partSpec(full, m.part) : full;
  let saved = m.saved;
  if (saved === undefined && full.saves) {
    const s = readState<{ models?: unknown } | null>(full.saves, outlineState());
    saved = m.part ? (s?.models ? { models: s.models } : undefined) : s ?? undefined;
  }
  const arg = screenTargetArg(m.screen), target = arg ? m.args?.[arg] : undefined;
  return new Desk(spec, { writes: false, chain, ...(saved !== undefined ? { saved } : {}), ...(typeof target === "string" && target ? { openArgs: { target } } : {}), ...opts });
}
