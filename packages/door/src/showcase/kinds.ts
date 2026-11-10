// The tile-kind sections: the registry itself (kinds), and what a kind says of its tiles (kind-facts, PIE-1523: a kind
// declared as an extension's manifest declares one, `tiles[].holds`, holds the person's keys while they're on it).
import { ReaderPane } from "../desk/panes";
import { columnsOf, leaf, pair, splitOf } from "../desk/screen-layout";
import { registerTileKind, serviceKind, tileKind, tileKinds, type TileKind } from "../desk/tile-kinds";
import { C, fg, RESET } from "../style";
import type { Section, deskOf as MakeDesk, row as Row } from "./showcase";

/**
 * The kind-facts section's tile (PIE-1523): a service-drawn kind declared as an extension's manifest declares one,
 * `tiles[].holds` passed to serviceKind as kindEntry passes it. While the person's keys are on it, it holds them.
 */
export const PATIENCE_KIND: TileKind = serviceKind({
  kind: "showcase.patience", about: "a hand of patience, declared as an extension's tile that holds the keys (the showcase's)", noun: "the patience tile",
  holds: { keys: true, edit: "a hand of patience" },
  render: async () => ({
    title: "patience",
    lines: [
      `${fg(C.lcyan)}♠ 7  ♥ Q  ♦ 3  ♣ 10${RESET}`, "",
      `${fg(C.grey)}extension.json: "holds": { "keys": true, "edit": "a hand of patience" }${RESET}`,
      `${fg(C.dark)}your keys here: agents don't move, float or close it, and opens go elsewhere${RESET}`,
    ],
  }),
});
if (!tileKind(PATIENCE_KIND.kind)) registerTileKind(PATIENCE_KIND);

export function kindSections({ deskOf, row }: { deskOf: typeof MakeDesk; row: typeof Row }): Section[] {
  return [
    {
      key: "kinds", need: "add a kind of tile (a built-in, or an extension's whole tile); fill a container from data", part: "the tile-kind registry: registerTileKind, one TileKind entry per kind (make, keys, actions, policy, accepts, save); serviceKind for a tile the service draws; a tile source fills columns (hub:<id>, one query tile per view)", files: "src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/query.ts",
      aside: "the left tile is a service-drawn kind (ServiceTile) whose rows are the registry itself; an extension's kind registers the same way (PIE-507, PIE-1506): tiles[] with run (a program in a terminal), render (a shipped render script's view, its list the door's one ListView: the what-changed extension's list in the changes section, ^W o W) or view (a query, as a query tile). Over the reader, columns filled from the house board's hub: a query tile per view, as the board's lanes are",
      stage(n, show) {
        // The registry listed by a tile drawn the way an extension's is: its render answers rows, the door draws them.
        const list = serviceKind({
          kind: "showcase.kinds", about: "the registry, listed",
          render: async _req => ({
            title: "tile kinds",
            lines: tileKinds().flatMap(k => [`${fg(C.lcyan)}${k.kind}${RESET}${k.keys?.length ? ` ${fg(C.dark)}^W o ${k.keys.map(x => x.key).join(" ")}${RESET}` : ""}`, `  ${fg(C.grey)}${k.about}${RESET}`]),
          }),
        }).make({ kind: "showcase.kinds" });
        const r = new ReaderPane();
        // The hub's views as query tiles: a columns container its tile source (hub:<id>) fills, as the board's lanes.
        const lanes = n.hub ? [columnsOf<number>([], { key: "lanes", source: `hub:${n.hub.id}` })] : [];
        return deskOf({ title: "showcase · kinds", panes: [list, r], layout: ([a, b]) => pair("row", 0.4, leaf(a!), lanes.length ? splitOf("col", [...lanes, leaf(b!)], [0.45, 0.55]) : leaf(b!)) }, show, [[r, n.notebook]]);
      },
    },
    {
      key: "kind-facts", need: "make an extension's tile hold the person's keys, as a reader's edit or a terminal does, so agents leave it where it is while they're in it (PIE-1523)",
      part: "TileKind.facts: what a tile of a kind is now (an edit held, a program running, the keys in it, a pin), merged by Desk.facts with what only the desk knows; placement, the typing rule, closing and the select wires read TileFacts and never the tile's class. Reader and terminal are its first users (readerFacts, terminalFacts); an extension declares tiles[].holds in its extension.json ({ keys, edit }), and serviceKind answers from it (declaredFacts)",
      files: "src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/desk.ts (facts), src/extensions.ts (kindEntry); outliner src/extension-manifest.ts",
      aside: "the left tile is a kind declared the way an extension's manifest declares it: \"holds\": { \"keys\": true, \"edit\": \"a hand of patience\" }. Put your keys on it (a click, or ^W h): an agent's tile.move, tile.close or tile.float of it is refused with the typing rule's words, and an agent's open goes to the reader instead. Move your keys to the reader and the same move goes through",
      stage(n, show) {
        const hand = PATIENCE_KIND.make({ kind: PATIENCE_KIND.kind });
        const r = new ReaderPane();
        return deskOf({ title: "showcase · kind facts", panes: [hand, r], names: ["patience", "reader"], layout: ([a, b]) => row(0.45, a!, b!) }, show, [[r, n.notebook]]);
      },
    },
  ];
}
