// In place (PIE-1516): a tile wired to itself (its own open wire, or the `self` open rule) takes what it opens. A reader
// replaces its note (back returns, as for any open into it); a list (links, query, the trail, the tree) becomes a reader
// in its own tile, the same tile (id, name, wires, place), with the list kept beneath the reader's trail: ← back past
// the reader's first stop puts the list back as it was. The desk's one placement (`placement()` says `inPlace`) decides
// it; this module only swaps the tile's content and back. The layout saves the list, so a restart brings it back.
import type { Actor } from "../socket";
import { holdsEdit } from "../whereabouts";
import { ReaderPane, sessionName, type Pane } from "./panes";
import { tileRegistry } from "./tile-registry";
import { makeTile } from "./tiles";

/** What the desk lends: its tiles, starting one, and saving and drawing after back. */
export interface InPlaceDesk { panes: Map<number, Pane>; start(id: number): void; changed(): void }

export class ListsBeneath {
  private beneath = new WeakMap<Pane, Pane>();
  constructor(private readonly desk: InPlaceDesk) {}

  /** The list a reader in place opened over, if it is one: what the layout saves for its tile. */
  listOf(p: Pane | undefined): Pane | undefined { return p ? this.beneath.get(p) : undefined; }

  /** Tile `id`'s list becomes a reader in place; `title` names the list on the reader's trail. */
  read(id: number, title: string): ReaderPane {
    const list = this.desk.panes.get(id)!;
    const reader = makeTile({ kind: "reader" }) as ReaderPane;
    reader.beneath = {
      beneath: true, agentRefusal: "",
      peek: dir => (dir < 0 ? title : null),
      trail: () => ({ back: [{ title }], forward: [] }),
      go: (dir: -1 | 1, _by: Actor) => (dir < 0 ? this.back(id, reader) : "nothing ahead: go back first"),
    };
    tileRegistry.replace(list, reader);
    this.desk.panes.set(id, reader);
    this.beneath.set(reader, list);
    this.desk.start(id);
    return reader;
  }

  /** Tile `id`'s list put back before it travels to another desk (the drawer, a group), so it moves as the layout saves it: the list, or undefined. */
  restore(id: number): Pane | undefined { const p = this.desk.panes.get(id); return p instanceof ReaderPane && this.beneath.has(p) && this.back(id, p) === null ? this.desk.panes.get(id) : undefined; }

  /** ← back past the reader's first stop: the list is the tile again, as it was. */
  private back(id: number, reader: ReaderPane): string | null {
    const list = this.beneath.get(reader);
    if (!list || this.desk.panes.get(id) !== reader) return "the list this reader opened over is gone";
    if (reader.editing || reader.holdsKeys) return holdsEdit("the reader", sessionName(reader));
    tileRegistry.replace(reader, list);
    this.desk.panes.set(id, list);
    this.beneath.delete(reader);
    reader.dispose?.();
    this.desk.changed();
    return null;
  }

  /** The tile closed: its list goes with the reader. */
  dropped(p: Pane) { this.beneath.get(p)?.dispose?.(); this.beneath.delete(p); }
}
