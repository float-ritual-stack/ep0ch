// The screens and tile kinds every door ships are one extension's: packages/outliner/extensions/screens. A door
// reads them as it reads any extension's (`extensions.list` for the kinds, `screens.list` and its own extension
// records for the screens); this file is what it holds of them before its host has answered, read from the same
// manifest the service serves, so there is one copy of every word.
//
// - A kind's description (`about`) is its row's. The door keeps the code that draws a kind (its drawer); what the
//   kind is, in words, is the extension's to say.
// - A kind's served name (`screens.reader`) reads as the door's own kind (`reader`): `screens.list` serves a tile's
//   kind as the kind that serves it, so a screen saved by another door opens here.
// - Its screens that are data alone are registered as the extension's from the start (desk/shipped-screens.ts). What
//   a host serves takes their place (src/extensions.ts `bindScreens`: a forked copy's spec is the one that opens),
//   and the manifest's are held again when it stops.
// (Nothing of the door's is imported here: a kind's own file reads its description from this one as it loads.)
import { readFileSync } from "node:fs";

interface ShippedTile { kind: string; description?: string; drawer?: string; replaces?: string[] }
interface Shipped { id: string; tiles: ShippedTile[]; screens: ({ name: string } & Record<string, unknown>)[] }

const manifest = JSON.parse(readFileSync(new URL("../../../outliner/extensions/screens/extension.json", import.meta.url), "utf8")) as Shipped;

/** The extension the shipped screens and kinds are (`screens`). */
export const SHIPPED_EXTENSION = manifest.id;

/** What the kind the door calls `kind` is, in its row's words. A kind with no row says so loudly: its description moved there. */
export function shippedAbout(kind: string): string {
  const row = manifest.tiles.find(t => t.kind === kind || t.replaces?.includes(kind));
  if (!row?.description) throw new Error(`the screens extension has no row for the tile kind ${kind}: its description lives in packages/outliner/extensions/screens/extension.json`);
  return row.description;
}

/** Each shipped kind's served name with the names it serves in place of: what the door's own kinds answer to. */
export const shippedKinds = (): { served: string; names: string[] }[] => manifest.tiles.map(t => ({ served: `${manifest.id}.${t.kind}`, names: t.replaces ?? [t.kind] }));

/** The shipped screens, as their specs are written. */
export const shippedScreens = (): readonly ({ name: string } & Record<string, unknown>)[] => manifest.screens;
