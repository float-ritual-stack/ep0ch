/**
 * The pi-outliner mod's session state: what its Recent mentions band and pane
 * draw (hooks/mentions-view.ts) and the BlockView drawings they show
 * (hooks/block-view.ts). Each value is the mod's own; any plugin may read it.
 */

/** What `ep0ch show <id> --cells` prints (packages/door, src/cells.ts). */
export type BlockCells = { id: string; uri?: string; columns: number; rows: number; cells: string; replaced: number }

/** A block ready to draw: the door's cells, or why there are none (its text is drawn instead). */
export type BlockViewData = ({ kind: 'cells' } & BlockCells) | { kind: 'text'; why: string }

/** One block's drawing kept for the session: the latest only, `at` naming the revision and width it was drawn for. */
export type BlockViewEntry = { at: string; data: BlockViewData }

/**
 * The Outliner Detail beside Claude in Herdr, as find-detail (or the last open) found it: one a press reuses,
 * none (a press opens one), or a press would be refused, and why (two Trees in the tab, a dead link).
 */
export type DetailBeside = { found: 'detail' | 'none' } | { found: 'refused'; why: string }

/** Whether the mod draws its outline and workboard tool calls as compact rows (`/tool-rows on|off`), kept in `$.store`. */
export type ToolRowsPrefs = { enabled: boolean }

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

/** One note opened in the detail view: what was asked for, and the block it resolved to. */
export type DetailEntry = { uri: string; id: string; title: string }

/**
 * The detail view's history: the notes opened in the mentions pane, which one
 * it shows (back and forward move `at`), and whether the pane shows it or the list.
 */
export type DetailHistory = { entries: DetailEntry[]; at: number; isShown: boolean }

/** A reference in a note shown in the detail view: its stand-in href and its text. */
export type DetailLink = { href: string; label: string }

/**
 * A note's text for the detail view, read by the outliner (the note and its
 * children) or by `ep0ch show --source` (the note alone), as Markdown with its
 * references as stand-in links; or why it couldn't be read.
 */
export type DetailSource =
  | { kind: 'source'; markdown: string; links: DetailLink[]; from: 'outliner' | 'ep0ch'; isTruncated: boolean }
  | { kind: 'missing'; why: string }

/** Where this Claude is bound (hooks/binding.ts, PIE-546). */
/** What the card reads from `ep0ch where --json`; null fields: not known. */
export type WhereFacts = {
  inDoor: boolean
  /**
   * Which door this Claude reaches and by which rule (`ep0ch where`, PIE-715): `control` (EP0CH_CONTROL or its outline's
   * session), `folder` (the door of the outline this folder names, for a Claude that does not descend from a tile) or
   * `only` (the one door running). `none`: no door, `text` says why and the command that starts one. `control` is the
   * socket, only when a door answers there.
   */
  reach?: { rule: 'control' | 'folder' | 'only' | 'none'; text: string; control: string | null }
  /** The machine Claude runs on (its hostname) and its folder. */
  here: { machine: string | null; folder: string | null }
  /** The innermost Herdr pane: its label when Herdr gave one, and whether it is the door agent's own pane. */
  herdr: { pane: string; label: string | null; agent: boolean } | null
  door: null | {
    /** A door answers on EP0CH_CONTROL now. */
    answers: boolean
    outline: string | null
    /** The ssh name the door reached its outline's machine by (null: this machine's host). */
    machine: string | null
    /** The outline host's machine, by its own name. */
    host: string | null
    /** In the door's drawer, rather than a tile on its desk. */
    drawer: boolean
    /** The tile's name (`claude`), when in a tile. */
    tile: string | null
    /**
     * Claude's environment is older than its door (PIE-604): the session was handed over or restarted, or
     * EP0CH_CONTROL went stale. `ep0ch` and the door tools follow the door by its outline's session.
     */
    stale: boolean
  }
}

/** How the folder's outline was looked up: found, none named, opted out, or the lookup failed (why). */
export type FolderFacts =
  | { kind: 'bound'; workspace: { root: string; outline?: string; machine?: string; pinned?: true; via?: 'env' | 'call' } }
  | { kind: 'unbound' }
  | { kind: 'opted-out'; root: string }
  | { kind: 'failed'; why: string }

export type BindingFacts = {
  folder: FolderFacts
  /** null: `ep0ch where` could not run (not on PATH, too old, no answer); `why` says which. */
  where: WhereFacts | null
  whereWhy?: string
  /** Claude's folder (the session's cwd), and HOME for writing it short. */
  cwd: string
  home?: string
  /** The door's control socket is set: the door tools are registered and act there. */
  doorTools: boolean
}

/** The binding card above the prompt: shown at the start and after /clear until hidden; its facts once read. */
export type BindingCard = { shown: boolean; facts: BindingFacts | null }

declare module 'claude-code' {
  interface PluginState {
    'pi-outliner': {
      mentionsPrefs: MentionsPrefs
      mentions: MentionsList
      /** BlockView drawings, by block id: the latest one each. */
      blockViews: StateFamily<BlockViewEntry>
      /** What the Outliner's find-detail found beside Claude in Herdr: what the heading's "opens in" says. */
      detailBeside: DetailBeside
      /** The detail view's history (no door or Herdr: a press opens the note here). */
      detail: DetailHistory
      /** What the detail view draws, by block id: the latest read of each. */
      detailSources: StateFamily<DetailSource>
      /** Where this Claude is bound (hooks/binding.ts): the card's facts (null: still being read), and whether it shows. */
      binding: BindingCard
      /** `/tool-rows`: whether the mod draws its tool calls as compact rows (hooks/tool-rows.ts). */
      toolRows: ToolRowsPrefs
      /** Which tool rows are folded open, by tool_use_id. */
      toolRowOpen: StateFamily<boolean>
      /** Block titles the tool rows name, by block id. */
      toolTitles: StateFamily<string>
    }
  }
}
