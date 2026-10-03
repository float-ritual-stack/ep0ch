// Notes shown with the notes under them (the outline tree's children, a river column's replies): which are open, what's
// under each, read once on its first open, and the rows walked depth first.
import type { Msg } from "./board";

export class Fold {
  readonly open = new Set<string>();
  /** What's under a note as read, "loading" while it's asked for; nothing before. */
  readonly kids = new Map<string, Msg[] | "loading">();
  /** Open (`on`) or fold a note; its first open reads what's under it (`read`; a failed read is nothing). `changed` after each step. */
  async show(id: string, on: boolean, read: (id: string) => Promise<Msg[]>, changed: () => void): Promise<void> {
    if (!on) this.open.delete(id);
    else if (this.open.add(id) && !this.kids.has(id)) {
      this.kids.set(id, "loading"); changed();
      this.kids.set(id, await read(id).catch(() => []));
    }
    changed();
  }
  /** `list` with what's open under each, depth first; `each` returning false leaves a note, and what's under it, out. */
  walk(list: readonly Msg[], each: (m: Msg, depth: number) => boolean | void, depth = 0): void {
    for (const m of list) {
      const k = this.kids.get(m.id);
      if (each(m, depth) !== false && this.open.has(m.id) && Array.isArray(k)) this.walk(k, each, depth + 1);
    }
  }
}
