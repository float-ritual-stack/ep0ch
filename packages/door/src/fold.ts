// Notes shown with the notes under them (the outline tree's children, a river column's replies): which are open, what's
// under each, read on its first open (and again when the outline changes: `reread`), and the rows walked depth first.
import type { Msg } from "./board";

export class Fold {
  readonly open = new Set<string>();
  /** What's under a note as read, "loading" while it's asked for; nothing before. */
  readonly kids = new Map<string, Msg[] | "loading">();
  /** Folded notes whose `kids` may be older than the outline: read again when they open. */
  private readonly dated = new Set<string>();
  /** Open (`on`) or fold a note; its first open reads what's under it (`read`; a failed read is nothing). `changed` after each step. */
  async show(id: string, on: boolean, read: (id: string) => Promise<Msg[]>, changed: () => void): Promise<void> {
    if (!on) this.open.delete(id);
    else if (this.open.add(id) && (!this.kids.has(id) || this.dated.delete(id))) {
      this.kids.set(id, "loading"); changed();
      this.kids.set(id, await read(id).catch(() => []));
    }
    changed();
  }
  /**
   * The outline changed: what's under each open note (of `only`, when given) is read again (`read`), so a row never shows
   * a copy older than the outline; a folded note's is kept (its count) but read again when it next opens. Settles once
   * every read is back.
   */
  async reread(read: (id: string) => Promise<Msg[]>, only?: ReadonlySet<string>): Promise<void> {
    for (const id of this.kids.keys()) if (!this.open.has(id) && (!only || only.has(id))) this.dated.add(id);
    await Promise.all([...this.open].filter(id => !only || only.has(id)).map(async id => {
      const kids = await read(id).catch(() => null);
      if (!kids) return;
      if (this.open.has(id)) this.kids.set(id, kids); else this.dated.add(id);   // folded while it was read
    }));
  }
  /** Forget everything (the rows now list other notes). */
  clear() { this.open.clear(); this.kids.clear(); this.dated.clear(); }
  /** Every note a row may show: those listed (`list`) and those read under them. */
  shows(list: readonly Msg[], id: string): boolean {
    return list.some(m => m.id === id) || this.kids.has(id) || [...this.kids.values()].some(k => Array.isArray(k) && k.some(m => m.id === id));
  }
  /** `list` with what's open under each, depth first; `each` returning false leaves a note, and what's under it, out. */
  walk(list: readonly Msg[], each: (m: Msg, depth: number) => boolean | void, depth = 0): void {
    for (const m of list) {
      const k = this.kids.get(m.id);
      if (each(m, depth) !== false && this.open.has(m.id) && Array.isArray(k)) this.walk(k, each, depth + 1);
    }
  }
}
