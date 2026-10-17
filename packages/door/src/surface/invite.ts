// A press invites the run it starts (PIE-957, S7; design §4.8): the person's click on a button that runs a script mints
// a one-run invitation, scoped to what the run may touch of the person's screen (shape and screen), and every action the run
// asks of the door carries it. It lets the run move the person's tiles, including the one they are looking at, where
// "the person is at the keys" would refuse an agent the moment after their click. It never reaches a draft's text, and a
// tile the person starts typing in during the run is still refused (the layout module's own rule). Any actor gets one on
// the same terms (an MCP action the person confirmed carries one too): there is no script-only exception. It is spent
// when the run ends (`scripts.ended`), or lapses after ten minutes.
import { randomUUID } from "node:crypto";

export type InviteScope = "shape" | "screen";

interface Invite { id: string; scope: readonly InviteScope[]; until: number; run?: string; by: string }

const LAPSE_MS = 10 * 60_000;

class Invites {
  private readonly open = new Map<string, Invite>();

  /** Mint one for the person's press: `by` says whose it is in words (for a status line). */
  mint(by = "you", scope: readonly InviteScope[] = ["shape", "screen"], now = Date.now()): string {
    for (const [id, inv] of this.open) if (inv.until <= now) this.open.delete(id);
    const id = randomUUID();
    this.open.set(id, { id, scope, until: now + LAPSE_MS, by });
    return id;
  }

  /**
   * Whether `id` is a live invitation covering `touch` for the run asking: one run's, never another's (a token a press
   * minted is bound to the first run that carries it, or to the run its press answered with).
   */
  covers(id: string | undefined, touch: InviteScope, run?: string, now = Date.now()): boolean {
    const inv = id ? this.open.get(id) : undefined;
    return !!inv && inv.until > now && inv.scope.includes(touch) && (inv.run === undefined || inv.run === run);
  }

  /** Bind it to the run it starts (the press's answer, or the first action it carried): `ended` spends it by that. A bound token stays with its run. */
  bind(id: string | undefined, run: string | undefined) {
    const inv = id ? this.open.get(id) : undefined;
    if (inv && run && !inv.run) inv.run = run;
  }

  /** The run ended: its invitation is spent. */
  spendRun(run: string) { for (const [id, inv] of this.open) if (inv.run === run) this.open.delete(id); }
  spend(id: string) { this.open.delete(id); }
  /** Whose invitation it is, for the status line ("on your press"), or undefined. */
  byOf(id: string | undefined): string | undefined { return id ? this.open.get(id)?.by : undefined; }
  get size() { return this.open.size; }
}

/** The door's invitations: one process, one set. */
export const INVITES = new Invites();
