/**
 * The pi-outliner mod's session state: what its Recent mentions band and pane
 * draw (hooks/mentions-view.ts) and the BlockView drawings they show
 * (hooks/block-view.ts). Each value is the mod's own; any plugin may read it.
 */

/** What `ep0ch show <id> --cells` prints (packages/door, src/cells.ts). */
export type BlockCells = { id: string; columns: number; rows: number; cells: string; replaced: number }

/** A block ready to draw: the door's cells, or why there are none (its text is drawn instead). */
export type BlockViewData = ({ kind: 'cells' } & BlockCells) | { kind: 'text'; why: string }

/** One block's drawing kept for the session: the latest only, `at` naming the revision and width it was drawn for. */
export type BlockViewEntry = { at: string; data: BlockViewData }

/** Where Recent mentions shows: a compact band above the prompt, a pane beside the transcript, or nowhere. */
export type MentionsPlacement = 'band' | 'pane' | 'off'

/** Whose mentions: this conversation's, or every conversation's in the outline (as the Tree's `s`). */
export type MentionsScope = 'conversation' | 'workspace'

/** The person's choices, kept across sessions in `$.store` (`mentions-view`). */
export type MentionsPrefs = { placement: MentionsPlacement; previews: boolean; scope: MentionsScope }

/** One mentioned block, as `outliner mentions list` gives it. */
export type MentionRow = {
  /** The block's id; null when the mention no longer resolves. */
  id: string | null
  /** Its revision, so a drawing of an older one isn't reused. */
  revision: number | null
  /** The title Tree and Detail show. */
  title: string
  /** What the answer wrote: a page, a Work ID or a block id. */
  address: string
  /** The block's text, drawn when the door can't draw it. */
  text: string
  mentionedAt: string
  excerpt: string
  /** Why it doesn't resolve, when it doesn't. */
  unavailable?: string
}

/**
 * The mentions shown, or why there are none; `note`, what the last press
 * couldn't do here and the command that reads it instead.
 */
export type MentionsList = { rows: MentionRow[]; loaded: boolean; why?: string; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'pi-outliner': {
      mentionsPrefs: MentionsPrefs
      mentions: MentionsList
      /** BlockView drawings, by block id: the latest one each. */
      blockViews: StateFamily<BlockViewEntry>
      /** Whether the Outliner's find-detail found a Detail beside Claude in Herdr: what the heading's "opens in" says. */
      adminDetail: boolean
    }
  }
}
