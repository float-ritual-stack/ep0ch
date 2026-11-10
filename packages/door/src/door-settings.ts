// The door's own settings as a settings card (PIE-1725): the trail's, kept in this door's trail.json, drawn by the same
// card an extension's are (src/surface/settings.ts, its owner a `SettingsOwner`). Its fields are its action's own
// (`trail.settings`'s arguments and their words), its defaults the trail's (`TRAIL_DEFAULTS`), and a change goes
// through that action, so a key, a click and an agent's `act` write alike. The card frames a door page: a note the door
// makes (`door:<id>`), never written to the outline.
import type { ExtensionSettings } from "@ep0ch/outline-core/protocol";
import type { Msg } from "./board";
import { extensionCardSchema, extensionCardValues, type SettingsOwner } from "./extension-settings";
import { TRAIL_DEFAULTS, type Trail, type TrailSettings } from "./trail";
import { TRAIL_QUERIES } from "./trail-actions";

/** A door page's id: a note the door makes for one of its own settings places. */
export const DOOR_PAGE = "door:";

/** The door's places with a card, by id: its name and what it is. */
const PLACES: Record<string, { name: string; description: string }> = {
  trail: { name: "Trail", description: "How long the door keeps your visits, and when a visit counts as read" },
};

/** The page a door place's card frames (`door:trail`): its name, and what it is. */
export function doorPage(id: string): Msg | null {
  const p = PLACES[id];
  const now = Date.now();
  return p ? { id: `${DOOR_PAGE}${id}`, text: `${p.name}\n${p.description}.`, parentId: null, childIds: [], createdAt: now, updatedAt: now, author: "the door", properties: [] } : null;
}

/** The trail's settings as the card reads them: each of `trail.settings`'s arguments, its value now and its default. */
function trailSettings(t: Trail): ExtensionSettings {
  const args = TRAIL_QUERIES.argsOf("trail.settings") ?? {};
  const fields = Object.entries(args).map(([name, spec]) => {
    const key = name as keyof TrailSettings, value = t.settings[key], dflt = TRAIL_DEFAULTS[key];
    return { name, type: "number" as const, description: spec.about, default: dflt, value, state: value === dflt ? "default" as const : "set" as const };
  });
  return { file: "trail.json", exists: true, state: fields.some(f => f.state === "set") ? "set" : "default", fields, secrets: [], config: { ...t.settings } };
}

/** The door's trail, as the App binds it when it starts: the card reads its settings from it. */
let trailNow: () => Trail | undefined = () => undefined;
export const bindDoorSettings = (trail: () => Trail | undefined) => { trailNow = trail; };

/** The owner of a door page's card (`door:trail`), or null: the trail's settings, written through `trail.settings`. */
export function doorOwner(page: string): SettingsOwner | null {
  const trail = trailNow();
  if (page !== `${DOOR_PAGE}trail` || !trail) return null;
  const { name, description } = PLACES.trail!, entry = { id: "trail", name, description };
  return {
    ...entry, settings: trailSettings(trail), kept: "this door's trail.json",
    schema: s => extensionCardSchema(entry, s), values: s => extensionCardValues(null, s), now: () => trailSettings(trail),
    async write(ctx, given, actor) {
      // Taken out is back to its default: the trail keeps every setting, so its default is written.
      const unset = typeof given.unset === "string" ? given.unset.split(",").filter(Boolean) : [];
      const args = { ...Object.fromEntries(Object.entries(given).filter(([k]) => k !== "unset")), ...Object.fromEntries(unset.map(k => [k, TRAIL_DEFAULTS[k as keyof TrailSettings]])) };
      await ctx.dispatch!.act({ action: "trail.settings", args }, actor);
      return { settings: trailSettings(trail) };
    },
  };
}
