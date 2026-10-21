import { readState, writeState } from "../state";
import { ActionRefused, allActionSets } from "./actions";
import { MODE_HINTS } from "./hint-card";

export type HintSetting = "card" | "status" | "off";
export const HINT_SETTINGS: readonly HintSetting[] = ["card", "status", "off"];
export const hintOverrides = () => readState<Record<string, HintSetting>>("hints.json") ?? {};
export function hintSetting(id: string, global: string): HintSetting {
  return hintOverrides()[id] ?? (global === "off" ? "off" : id === "confirm" ? "status" : "card");
}

export function declaredHints(global: string) {
  const rows = new Map<string, { id: string; trigger: string }>();
  for (const set of allActionSets()) for (const id of set.names()) {
    const def = set.def(id)!;
    if (def.hint) rows.set(def.hintId ?? id, { id: def.hintId ?? id, trigger: `${id}${def.keys ? ` (${def.keys})` : ""}: ${def.summary}` });
  }
  for (const [id, hint] of Object.entries(MODE_HINTS)) rows.set(id, { id, trigger: hint.trigger });
  const own = hintOverrides();
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(r => ({ ...r, setting: hintSetting(r.id, global), own: own[r.id] ?? null }));
}
export function setHint(id: string, to: HintSetting, global: string) {
  if (!declaredHints(global).some(r => r.id === id)) throw new ActionRefused(`unknown hint ${id}; hints.list shows the declared hints`);
  if (!HINT_SETTINGS.includes(to)) throw new ActionRefused("to is card, status or off");
  writeState("hints.json", { ...hintOverrides(), [id]: to });
}
export function resetHints() { writeState("hints.json", {}); }
