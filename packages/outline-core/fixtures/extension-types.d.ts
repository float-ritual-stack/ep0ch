// Made by packages/outline-core/scripts/extension-types.ts from outline-core's source; never edited by hand
// (test/extension-types.test.ts makes it again and compares). For an extension's author: an action's row
// (action-row), a list's rows (list-row) and the view primitives (primitive), whole, then the declarations of other
// modules those name.

declare module "@ep0ch/outline-core/action-row" {
  export type ArgType = "string" | "number" | "boolean";
  /**
   * What kind of thing in the system an argument's value names (PIE-1031), so the power bar's form offers the values
   * there are (the door's src/bar/arg-kinds.ts answers each from the system: the layout, the service), and `actions` says it:
   * - `tile`: a tile on the screen shown (`to=`); the dispatcher reads it with `tile=`'s one grammar, so the action is
   *   given that tile's name.
   * - `note`: a note, by the service's search (an id, a `((ref))`, a Work ID). `page`: a page's name (`[[name]]`).
   * - `screen`: a screen by name (screen.list). `view`: a saved view (a virtual branch's block id).
   * - `key`: a property's key; `value`: a value of the key the argument `of` names (the outline's property index).
   * - `tile-kind`: a kind of tile (the tile-kind registry). `agent`: a persona of the agents here (the door's src/bar/ask-agent.ts).
   * A boolean needs none (true or false), nor does a value from a fixed list (`choices`).
   */
  export type ArgKind = "outline" | "tile" | "note" | "page" | "screen" | "view" | "key" | "value" | "tile-kind" | "file" | "layout" | "agent" | "script";
  /**
   * One argument: its type, whether it may be left out, and what it means; `kind`: the kind of thing it names (ArgKind);
   * `choices`: the values it takes, when they are a fixed list (`where=left|right|…`), offered first (with a kind, the
   * kind's values follow them: `inbox`, `root`, then any note).
   */
  export interface ArgSpec {
      type: ArgType;
      optional?: boolean;
      about: string;
      kind?: ArgKind;
      /** `kind: "tile"`: the tile a program runs in (`open from=`), which a program names by what it was told (EP0CH_TILE, EP0CH_TILE_ID), not only by `tile=`'s grammar. */
      program?: true;
      choices?: readonly string[];
      /** At least one combination must hold; null means the argument is present. */
      implies?: readonly Readonly<Record<string, string | number | boolean | null>>[];
      /** These arguments cannot accompany this one, even when false. */
      conflicts?: readonly string[];
      /** `kind: "value"`: the argument naming the property whose values it takes. */
      of?: string;
      /** What a left-out optional one means, when it means one thing (`focused`, `1`): its page's default column. */
      default?: string;
      /**
       * The host binds it (the block in front, a passage, the button that pressed it): an agent's `act` names it, and a
       * person is never asked it, so no form or completion offers it (PIE-1076).
       */
      context?: true;
      /**
       * The door's own word on a request (an extension action's `door:via`, `door:asked`): its presses pass it and `act`
       * still takes it, but it isn't the part's argument, so what describes the action (`list`: `ep0ch actions`, its docs
       * page, the bar's form) leaves it out and names it only in `doorWords` (PIE-1705).
       */
      doorWord?: true;
      /** A word written more than once reaches the action as a list (a script's slot, `props.page`); every other argument takes the last. */
      many?: true;
  }
  /**
   * A real call of an action and what it does (PIE-1032): its page shows one or two, as `act` lines. `act` is the line
   * after `ep0ch act`, the action's name first (`layout.move tile=notes to=right`); `does` says what happens, in a few
   * words. `safe`: an agent may run it without asking (it only reads or changes the door's own view); left out, it is
   * read from the action's declarations (`touches: "nothing"`, `replay: "safe"`, not the person's), and `false` unmarks one.
   */
  export interface ActionExample {
      act: string;
      does: string;
      safe?: boolean;
  }
  /**
   * What an action touches of the person's (PIE-514). The door's dispatcher (its src/surface/dispatch.ts) checks it once, against
   * where the person is (its src/whereabouts.ts), before the action runs; the action never asks who acts for this.
   * - `nothing`: a read; a mark; what the service writes and attributes (an extension's action, a refresh). Anyone, any time.
   * - `tile`: the tile it runs in: its view, cursor, selection or input. An agent's is refused in the tile that has the
   *   person's keys (`while: "typing"`: only while they type in it), with the agent's own way said (`way`).
   * - `shape`: the screen's layout. The layout engine decides each operation (the door's src/desk/screen-layout.ts) from the same
   *   answer about where the person is (`ctx.person`).
   * - `draft`: a note the person may have open in a draft. The draft session's rule decides (`draftRule`).
   * - `screen`: what the person looks at, or where their keys go (another screen, their focus, a list's lit row, the
   *   board shown). An agent's waits until they aren't typing anywhere and have been idle `SHELL_IDLE_MS`.
   */
  export type Touches = "nothing" | "tile" | "shape" | "draft" | "screen";
  /**
   * One way to run an action (PIE-1048): `keys` in the keycap grammar `::graph-keys` reads (`alt+h`, `^W c`, `g then d`,
   * `j k`), or a mouse gesture (`click`, `double-click`, `drag`, `wheel`); `does`, what this way does, in a few words
   * (`on a spine opens it`). `via`, instead of keys: a way that is no key at all (the tile menu's "fold", the power bar).
   */
  /**
   * One row of an action's keys: the keys and what they do under the action's heading (its page, `::graph-keys`), and
   * `says`, the whole sentence the keys window lists where `does` would read as a fragment after the action's words (PIE-1425).
   * `on`, the one screen or tile these keys are that place's own, by the name `in:` filters it (`menu`: the main menu's
   * letters, matched by its own key code; `tune`): the keys window then never says they take a key anywhere else (PIE-1439).
   */
  /**
   * One way to press an action: its keys and what they do. `args`: the arguments that key presses it with, when the action's
   * keys differ by them (backlinks.view's K is step=kind): so a part answering "how do I group by kind" names that key alone
   * (yo, PIE-1712).
   */
  export type KeyRow = {
      keys: string;
      does: string;
      says?: string;
      on?: string;
      args?: Readonly<Record<string, string | number | boolean>>;
  } | {
      via: string;
  };
  /** An action's keys: rows (KeyRow), or one line that reads cleanly as them (declaredKeys, keyRows). */
  export type Keys = string | readonly KeyRow[];
  /** An action's keys as one line, for a listing (`actions`, a flash): each row's keys and what it does. */
  export function keysText(keys: Keys | undefined): string | undefined;
  /** One field of an action's answer: its type, what it is, and the kind of thing it names when it names one. */
  export interface AnswerField {
      type: string;
      about: string;
      kind?: ArgKind;
  }
  /**
   * One row of a tile's menu (PIE-492), as data: a few words under a group, the key its keycap shows (a name `declaredKeys`
   * finds in the action's `keys`: the menu's accelerator too), and the arguments the row runs the action with.
   */
  export interface ActionMenuRow<Args = Record<string, unknown>> {
      label: string;
      /** "Tile", "Note", "Terminal", "Board": rows are grouped by it, in the order the dispatcher finds their sets. */
      group: string;
      /** Its keycap; left out, the first key the action's `keys` declares; `""`, none (an action with no key: layout.lock). */
      key?: string;
      args?: Args;
  }
  /**
   * What an action says about itself (PIE-1152: the implementation is what's displayed). `Args`: its arguments by name;
   * `Menu`: its menu rows (a client that runs actions adds what a row is now: the door's `MenuEntry.now`).
   */
  export interface ActionDescription<Args extends object = Record<string, ArgSpec>, Menu extends ActionMenuRow<any> = ActionMenuRow> {
      /** What the action does, in the words `actions` and the README use. */
      summary: string;
      /**
       * Every way to press it (PIE-1048): rows of keys and what each does (KeyRow), or, for a key list that reads cleanly as
       * keycaps, one line of them ("j k ↓ ↑, or a click on a row"). The door's `test/key-rows.test.ts` fails on a line that doesn't.
       */
      keys?: Keys;
      /** What it touches of the person's: the one actor rule, checked by the dispatcher (Touches). The most it can touch. */
      touches: Touches;
      /** `touches: "tile"`: refused in the tile with the person's keys (`focused`, the default), or only while they type in it. */
      while?: "focused" | "typing";
      /**
       * The person's own: an agent's is refused with this, which says why and what an agent does instead. Declared here,
       * on the row every client reads, so a listing, a bar and an agent are told before they run it, and a dispatcher's
       * actor rule is the one check (the door's src/surface/dispatch.ts, native's `rule()`): no action refuses an agent
       * in its own run. In the door, the person's press of a script invites its run and lifts it (PIE-1186); yolo never does.
       */
      person?: string;
      args: Args;
      answer?: Readonly<Record<string, AnswerField>>;
      /** One or two real calls and what each does (ActionExample): its page's examples. An action with arguments has them (the door's test/action-pages.test.ts). */
      examples?: readonly ActionExample[];
      /** Its rows in a tile's menu (`tile.menu`, PIE-492): absent, it isn't in one. */
      menu?: Menu | readonly Menu[];
  }
  /** An action as data, under the id `act` runs it by (`tile.close`): what a client that only reads actions holds. */
  export interface ActionRow extends ActionDescription {
      id: string;
  }
  /**
   * The row of the action `id` that describes itself as `d`: its description as plain data, in one field order, with
   * nothing that runs (a menu row's `now`, an action's `run`) and nothing left `undefined`. Menu rows are a list.
   */
  export function actionRow(id: string, d: ActionDescription<any, any>): ActionRow;
  /** Named keys as the README, hints and `keys` write them, to the one name the door's `keyName` gives. */
  export const NAMED_KEYS: Readonly<Record<string, string>>;
  /** Words that are a mouse gesture: in a hint, what follows them is what's clicked, not more keys. */
  export const MOUSE_KEYS: ReadonlySet<string>;
  /** Whether `s` is a key's one name (what `keyName` gives; never `exactKeyName`'s, which no screen matches): a screen's key map names its keys so. */
  export const isKeyName: (s: unknown) => s is string;
}

declare module "@ep0ch/outline-core/list-row" {
  import type { PagePrimitive } from "@ep0ch/outline-core/note-page";
  import type { RuleTone } from "@ep0ch/outline-core/rules";
  import type { SearchQuery } from "@ep0ch/outline-core/search-match";
  /** The tones a row is drawn in: the component primitives' (`good`, `warn`, … ). */
  export type ListTone = RuleTone;
  /**
   * What ⏎ does on a row: exactly one of four things, never several (the service refuses a row with two). It runs as
   * the picker, under the picker's rules (ADR 0004 §3): `open` lands where the picker's opens land; `run` goes through
   * the dispatcher's actor rules; `insert` goes only into the picker's own draft; `copy` puts text on the person's
   * clipboard and answers an agent with the text.
   */
  export type ListOpenWhere = "current" | "beside" | "float" | "full";
  export interface ListOpen {
      ref: string;
      where?: ListOpenWhere;
      revision?: number;
      at?: number;
      atLabel?: string;
      atSays?: string;
  }
  export type Activation = {
      open: string | ListOpen;
  } | {
      run: {
          action: string;
          args?: Record<string, string>;
      };
  } | {
      copy: string;
  } | {
      insert: string;
  };
  export type ActivationKind = "open" | "run" | "copy" | "insert";
  export const ACTIVATION_KINDS: readonly ActivationKind[];
  /** A row of a list. `do` absent: a header (nothing to pick). `id` is unique in its list and keys its view state. */
  export type ListCell = string | number | {
      text: string;
      act?: string;
      link?: string;
      revision?: number;
      tone?: ListTone;
  };
  export const listCellText: (cell: ListCell) => string;
  export interface ListRow {
      id: string;
      label: string;
      detail?: string;
      mark?: string;
      tone?: ListTone;
      group?: string;
      cells?: ListCell[];
      cover?: string;
      bind?: string;
      body?: string[];
      /** What the list shows beside (or below) it while the row is selected: a block drawn as an embed, or Blockdown. */
      preview?: {
          block: string;
      } | {
          markdown: string;
      };
      do?: Activation;
      /** The properties it carries that the list shows on it, as its author wrote them: any key. */
      chips?: ListChip[];
      /**
       * The act line a pick runs, as any door's dispatcher reads it (`open id=…`, `screen.open name=…`): `do`, said as a
       * line by the one rule (`actOf`), for a client that parses no activation. A row that copies or inserts has none.
       */
      act?: string;
      /** In a tree (`arrange: "tree"`): how deep it sits under the list's top (0), */
      depth?: number;
      /** whether anything is under it, whether what is under it is listed after it, and how many notes that is (said once they are). */
      folds?: boolean;
      open?: boolean;
      kids?: number;
      /**
       * What the row shows under itself, drawn as any primitive is: a proposal's change (a `diff`), a thread's replies, a
       * component's own example. A row that `folds` in a list whose source reads `open` carries it while it is open
       * (`lists.read`'s `open` names the rows that are), so a long one is answered only when asked for.
       */
      view?: PagePrimitive;
  }
  /** A property a row shows: its key and one of its values, as written. */
  export interface ListChip {
      key: string;
      value: string;
  }
  /** The act line an activation is: an open is `open id=<ref>`, a run its action and arguments; a copy and an insert are no act. */
  export function actOf(d: Activation | undefined): string | undefined;
  /** A named run of rows, drawn under its header. `count` is how many rows it holds before any filter. */
  export interface ListGroup {
      name: string;
      label: string;
      glyph?: string;
      count: number;
      note?: string;
      ids?: string[];
      groups?: ListGroup[];
  }
  export const LIST_PREVIEWS: readonly ["right", "below", "none"];
  export type ListPreviewSide = (typeof LIST_PREVIEWS)[number];
  /** The `list` view primitive (ADR 0004 §3). */
  export interface ListPrimitive {
      type: "list";
      rows: ListRow[];
      /** `tree`: rows carry `depth`, `folds` and `open`, and sit in the order they are drawn (a served list's; a view's list has the other four). */
      arrange?: "table" | "rows" | "grid" | "lanes" | "tree";
      size?: "small" | "large";
      columns?: string[];
      headers?: string[];
      page?: number;
      groups?: ListGroup[];
      /** Where the selected row's preview goes; default none. */
      preview?: ListPreviewSide;
      /** `/` types words over the rows; default true. */
      filter?: boolean;
      /** The frame's "⏎ in" takes the keys; default true. */
      enter?: boolean;
      /** What an empty list says. */
      empty?: string;
      /** The title of the tile it fills (PIE-1525: a render tile's frame, "outbox · 3 waiting on 2 people"); a list in a note ignores it. */
      title?: string;
  }
  /** A key the listed notes carry, with the values it takes among them and how many carry each: a list's chips to narrow by. */
  export interface ListFacet {
      key: string;
      count: number;
      values: {
          value: string;
          count: number;
      }[];
      more?: number;
  }
  /** What a list is asked for by name (`lists.read`'s `from`), as it says of itself: every client lists the sources from these rows. */
  export interface ListSource {
      from: string;
      /** What it lists, in a few words (a bar's title over its line). */
      about: string;
      /** What to type for it, when words narrow it. */
      placeholder?: string;
      /** The parameters it reads, each with what it means. */
      params: {
          name: string;
          about: string;
          required?: true;
      }[];
      /**
       * A command bar lists it: under `all` when `main`, alone by its name. `facets`: its answer carries the facets its
       * matches have, so a facet picked anywhere is a term of its question (the bar opens on it).
       */
      bar?: {
          main?: true;
          facets?: true;
      };
  }
  /**
   * `lists.read`'s answer: one list, whatever it is of (a tree, a query's matches, a search, a note's links, lanes, facets).
   * Every row says what it shows and the act line a pick runs; the list says how it is arranged and, for a table, its columns.
   */
  export interface ListAnswer {
      from: string;
      list: ListPrimitive;
      /** The property keys the listed notes carry, counted over every match: chips that narrow the question. */
      facets?: ListFacet[];
      /** What the service says of the question where rows would be ("no notes have <key>; nearest: …"). */
      hint?: string;
      /** How many there are in all, when the list holds fewer. */
      total?: number;
      truncated?: boolean;
      /** A tree: the folders whose notes are listed (asked for and there). */
      open?: string[];
      /** The property the rows are sorted and grouped by, as asked: names, never a list a client keeps. */
      sort?: string;
      group?: string;
      /** `from: "sources"`: the sources as they say of themselves, a row of the list each (what a client reads; the rows are for a person). */
      sources?: ListSource[];
      /** A watched answer hears every change. */
      anyChange: true;
  }
  /** The most rows a list holds (a component's answer cuts each group to this, with `more`). */
  export const LIST_MAX_ROWS = 1000;
  /** The one activation a row carries, or null for a header. A row with several (a hand-built one) answers the first in the ADR's order. */
  export function activationOf(row: Pick<ListRow, "do">): ({
      kind: ActivationKind;
      value: string | {
          action: string;
          args?: Record<string, string>;
      };
  } & Omit<ListOpen, "ref">) | null;
  export const openedRef: (row: Pick<ListRow, "do">) => string | undefined;
  /** How many of the four a `do` names: the validator wants exactly one. */
  export const activationCount: (d: object) => number;
  /** Whether `words` (a typed filter, `/`) match a row: the one matcher, over its label, detail and mark. An empty filter matches all. */
  export function listRowMatches(row: Pick<ListRow, "label" | "detail" | "mark">, words: string | SearchQuery | null): boolean;
  /** The rows `words` leave, in their order. A header (a row with no activation) stays while any row of its group does. */
  export function filterListRows<R extends Pick<ListRow, "id" | "label" | "detail" | "mark" | "group" | "do">>(rows: readonly R[], words: string): R[];
  /** A section of a list as every client draws it: its header (absent for the rows that name no group) and its rows. */
  export interface ListSection {
      head: {
          name?: string;
          label: string;
          glyph?: string;
          count?: number;
          note?: string;
      } | null;
      rows: ListRow[];
  }
  /**
   * A list's rows in the sections they are drawn in, every renderer's order: the rows that name no group, then each
   * declared group's (its header from `groups`), then the groups only a row names. A row with no `do` is a header.
   */
  export function listSections(node: Pick<ListPrimitive, "rows" | "groups">): ListSection[];
  /** A section's header as words: `glyph label (count)`. */
  export const listHead: (head: NonNullable<ListSection["head"]>) => string;
}

declare module "@ep0ch/outline-core/primitive" {
  import type { ListCell, ListPrimitive } from "@ep0ch/outline-core/list-row";
  import type { Align, BandPattern } from "@ep0ch/outline-core/rules";
  export const PRIMITIVE_TYPES: readonly ["text", "blockdown", "badge", "stat", "bar", "table", "checklist", "sparkline", "card", "box", "stack", "row", "band", "track", "image", "button", "list"];
  /** The fields each primitive accepts besides `type` (anything else is refused): the one list the validator checks and the scripts reference prints. */
  export const PRIMITIVE_FIELDS: {
      readonly text: readonly ["text", "tone", "strong", "act", "link", "revision"];
      readonly blockdown: readonly ["text"];
      readonly badge: readonly ["label", "tone", "act"];
      readonly button: readonly ["label", "act", "tone"];
      readonly stat: readonly ["label", "value", "unit", "tone"];
      readonly bar: readonly ["label", "value", "max", "tone"];
      readonly table: readonly ["columns", "rows", "links", "acts"];
      readonly checklist: readonly ["items"];
      readonly sparkline: readonly ["label", "values"];
      readonly card: readonly ["title", "subtitle", "badge", "link", "act", "children"];
      readonly box: readonly ["title", "children"];
      readonly stack: readonly ["children"];
      readonly row: readonly ["children", "minWidth"];
      readonly band: readonly ["text", "level", "style", "pattern", "align", "row", "tone"];
      readonly track: readonly ["style", "pattern", "tone"];
      readonly image: readonly ["src", "svg", "alt", "size", "fit", "height", "caption"];
      readonly list: readonly ["rows", "groups", "preview", "filter", "enter", "empty", "arrange", "size", "columns", "headers", "page", "title"];
  };
  export const TONES: readonly ["default", "good", "warn", "bad", "dim", "accent"];
  /** A table cell: plain text or a number, or one that presses an action line or opens a note on its own (PIE-1461). */
  export type TableCell = ListCell;
  export type Tone = typeof TONES[number];
  /**
   * What a press runs (PIE-957, PIE-981): an action line as the power bar and `ep0ch act` take it, `<action> key=value …`.
   * Its head is an action the door has (`layout.load`) or a script's name (`ttt-move`), which runs as the script; the
   * words are its slots. The door runs it through its one dispatcher as the person; every other client draws the
   * primitive as it is without it, so a page or an export never gains a write.
   */
  export type ActionLine = string;
  export type Primitive = ({
      type: "text";
      strong?: boolean;
  } & Extract<TableCell, object>)
  /**
   * Blockdown a client draws with its own reader (the door's note surface, Detail's, the publisher's HTML), so its
   * headings, lists, links and properties read as they do in a note. A text target gets the source as written.
   */
   | {
      type: "blockdown";
      text: string;
  } | {
      type: "badge";
      label: string;
      tone?: Tone;
      act?: ActionLine;
  }
  /** A button (PIE-957): a labelled press, drawn in the control row an extension line's controls are. */
   | {
      type: "button";
      label: string;
      act: ActionLine;
      tone?: Tone;
  } | {
      type: "stat";
      label: string;
      value: string | number;
      unit?: string;
      tone?: Tone;
  } | {
      type: "bar";
      label: string;
      value: number;
      max: number;
      tone?: Tone;
  }
  /**
   * `links`: a block id or a Resource ref (`file:`, `web:`, `resource:`) per row (or null) that a client opens on Enter or a click.
   * `acts`: an action line to press per row (or null), in place of its link.
   * A cell is text or a number, or `{ text, act?, link?, tone? }`: a cell of its own that presses or opens (PIE-1461), so one
   * row can open its note from the title and change a property from another column.
   */
   | {
      type: "table";
      columns: string[];
      rows: TableCell[][];
      links?: (string | null)[];
      acts?: (ActionLine | null)[];
  } | {
      type: "checklist";
      items: {
          label: string;
          done: boolean;
      }[];
  } | {
      type: "sparkline";
      label?: string;
      values: number[];
  } | {
      type: "card";
      title: string;
      subtitle?: string;
      badge?: {
          label: string;
          tone?: Tone;
      };
      link?: string;
      act?: ActionLine;
      children?: Primitive[];
  } | {
      type: "box";
      title?: string;
      children: Primitive[];
  } | {
      type: "stack";
      children: Primitive[];
  }
  /**
   * Side by side. `minWidth`: the narrowest a child may be, in characters (terminal cells; `ch` on the web); where
   * the reader can't give each child that much, the row stacks them, one under the other. Default 12.
   */
   | {
      type: "row";
      children: Primitive[];
      minWidth?: number;
  }
  /**
   * A heading in a band of glyph tracks (PIE-599's banner, PIE-600's heading style): three rows, the text on `row`
   * (top, middle or bottom), aligned. `level` is the heading it stands for (a text target draws `#`, `##`, `###`).
   */
   | {
      type: "band";
      text?: string;
      level?: 1 | 2 | 3;
      style?: string;
      pattern?: BandPattern;
      align?: Align;
      row?: "top" | "middle" | "bottom";
      tone?: Tone;
  }
  /** One row of glyph track: a hard divider. `style`: a heading style by name (PIE-599), drawn with it where a client can. */
   | {
      type: "track";
      style?: string;
      pattern?: BandPattern;
      tone?: Tone;
  }
  /**
   * A picture (PIE-827), drawn as each client draws a note's `[img::]` line (outline-core's imagePrimitiveSpec): the
   * door's graphics, dimmed dark-first; a page's served image, when the publish roots allow the file; elsewhere its alt
   * text and file. `src`: a path or a `file:` Resource ref; `size` as `[size::]` (cells, `N%`, `full`); `height` in rows;
   * `caption: false` (PIE-839): the picture alone where it's drawn (a card's cover), its caption only where it isn't.
   * `svg` in place of `src` (PIE-1555): the picture's own markup, a render script's drawing (its text laid out, its
   * `<a href>` links), drawn by the door as an SVG file is; a text or a page target says it with its alt text.
   */
   | {
      type: "image";
      src?: string;
      svg?: string;
      alt?: string;
      size?: string;
      fit?: "cover" | "contain";
      height?: number;
      caption?: boolean;
  }
  /**
   * A selectable, filterable list with a preview (PIE-747, ADR 0004 contract 3): rows with one activation each, drawn
   * by every client (the door's one ListView, Detail as text, a page as `<ul>`). The viewer's selection, filter and
   * whether they are in it are theirs: never written, never sent. The rows' shape is outline-core's (`list-row.ts`).
   */
   | ListPrimitive;
}

declare module "@ep0ch/outline-core/rules" {
  export type { BandPattern } from "@ep0ch/outline-core/heading-styles";
  export type { BandAlign as Align } from "@ep0ch/outline-core/heading-styles";
  /** The tones a decoration is drawn in: the component primitives' (`good`, `warn`, … ). */
  export const RULE_TONES: readonly ["default", "good", "warn", "bad", "dim", "accent"];
  export type RuleTone = (typeof RULE_TONES)[number];
}

declare module "@ep0ch/outline-core/note-page" {
  import type { SourceRange } from "@ep0ch/outline-core/code-ranges";
  import type { ComponentKind } from "@ep0ch/outline-core/component-at";
  import type { Align, ContentWidth, Focus } from "@ep0ch/outline-core/media-line";
  import type { Primitive } from "@ep0ch/outline-core/primitive";
  /**
   * A picture a note shows (a media line, `[img::path]`; or an ```svg fence, whose text is the picture): where its bytes
   * are and how the note asks for it to be laid out. A client reads a file's bytes with `media.read`.
   */
  export interface PagePicture {
      /** The file's path as written: `media.read` answers its bytes. None for a picture drawn from the note's own text. */
      path?: string;
      /** An ```svg fence's text: the picture itself. */
      svg?: string;
      alt?: string;
      /** `fit` keeps the reading measure; `full` fills the width there is. */
      width: ContentWidth;
      /** Its height in terminal rows, when the note says one. */
      height?: number;
      align?: Align;
      /** A header's: crop to fill its band (`cover`) or show it whole (`contain`). */
      fit?: "cover" | "contain";
      /** The point a crop keeps in view, as fractions across and down. */
      focus?: Focus;
      /** 0 as it is … 1 black. */
      dim?: number;
      /** What's written on its line that isn't a layout value: said under it. */
      problems?: string[];
  }
  /**
   * What a part of a page is drawn as: a primitive of the catalogue (primitive.ts), or one of the five a page adds.
   * A client draws each by its `type` and reads nothing else of the note.
   */
  export type PagePrimitive = Exclude<Primitive, {
      type: "box";
  }>
  /** A box: its children are the parts written inside it. */
   | {
      type: "box";
      title?: string;
      children: PagePrimitive[];
  }
  /** Prose as Markdown (the render target): Blockdown links written as Markdown links (`blockHref`, `pageHref`). */
   | {
      type: "markdown";
      text: string;
  }
  /** A picture where it stands in the note. (The note's header image is the page's `hero`, not a part.) */
   | ({
      type: "picture";
  } & PagePicture)
  /** Lines as they were written: a component nobody has an answer or a drawing for. Never hidden. */
   | {
      type: "source";
      text: string;
  } | DiffPrimitive | PagePart;
  /**
   * One line of a change: as it was and still is (`same`), written (`add`), taken out (`del`), or a run of lines the
   * same on both sides left out, said in words (`skip`).
   */
  export interface DiffLine {
      op: "same" | "add" | "del" | "skip";
      text: string;
  }
  /**
   * A change to a text, line by line, as the service found it: a proposal's patch against its note, a revision against
   * the note as it is now (`lists.read from=proposals|revisions`, a row's `view`). A client draws the lines and diffs
   * nothing. `from` and `to` name the two sides in words; `added` and `removed` count the lines each way.
   */
  export interface DiffPrimitive {
      type: "diff";
      from?: string;
      to?: string;
      lines: DiffLine[];
      added: number;
      removed: number;
  }
  /** What a part was written as: `componentAt`'s kinds (component-at.ts), prose, and a picture. Said for a reader of the data; nothing draws by it. */
  export type PagePartKind = ComponentKind | "prose" | "picture";
  /**
   * One part of a note's body, in order: where it is written, the service's word on its answer, and what to draw
   * (`view`). The frame is the same for every part; a part of prose has only its place and its view.
   */
  export interface PagePart {
      type: "part";
      kind: PagePartKind;
      /** The note it is written in. */
      block: string;
      /** Where its lines are in that note's text, in UTF-16 code units (`end` exclusive): `text.slice(start, end)` is it as written. */
      span: SourceRange;
      /** The line of the note (from 0) it starts on: how a press names a button (`scripts.sequence`). */
      line: number;
      /** A component's name as written (`graph-stat`, `links`, `button`). */
      name?: string;
      /** A figure's kind (`stat`, `check`…). */
      figure?: string;
      title?: string;
      /** The question it asks, in the views' grammar: a client opens it as a query. */
      query?: string;
      /** How fresh the answer is, as a page's footer says it ("live · 3 results"). */
      status?: string;
      /** Why it has no answer, or what is wrong with the one it has: the service's words. */
      error?: string;
      /** More matched than the view holds. */
      truncated?: true;
      /** A button whose press is the service's to run (several steps, or a script): `scripts.sequence` with `block` and `line`. */
      sequence?: true;
      /** The slots a button's line leaves empty (`{bed}` with `bed=` unwritten): a press has nothing to run until each is written or asked for. Any other `error` on a button is said and stops no press. */
      needs?: string[];
      view: PagePrimitive;
  }
}

declare module "@ep0ch/outline-core/search-match" {
  /** A query, prepared once for every document it is matched against. */
  type SearchMode = "search" | "completion";
  export interface SearchQuery {
      mode: SearchMode;
      /** `searchNormalize`d: what ids compare against. */
      raw: string;
      /** The folded query, or the raw one when folding leaves nothing (a query of punctuation, `((` or `#`). */
      phrase: string;
      folded: boolean;
      terms: string[];
      budgets: number[];
      /** Each term's distance to each document word seen so far. */
      distances: Map<string, number>[];
  }
}

declare module "@ep0ch/outline-core/heading-styles" {
  export const BAND_PATTERNS: readonly ["stack", "waffle", "uptime", "dots", "rule"];
  export type BandPattern = (typeof BAND_PATTERNS)[number];
  export const BAND_ALIGNS: readonly ["left", "center", "right"];
  export type BandAlign = (typeof BAND_ALIGNS)[number];
}

declare module "@ep0ch/outline-core/media-line" {
  export type ContentWidth = "fit" | "full";
  export type Align = "left" | "center" | "right";
  /** A point in an image, as fractions of it across and down. */
  export type Focus = {
      x: number;
      y: number;
  };
}

declare module "@ep0ch/outline-core/code-ranges" {
  /** An offset range of the text: `start` inclusive, `end` exclusive. */
  export interface SourceRange {
      start: number;
      end: number;
  }
}

declare module "@ep0ch/outline-core/component-at" {
  import type { ButtonCall } from "@ep0ch/outline-core/button-call";
  import type { ComponentBlock } from "@ep0ch/outline-core/component-block";
  import type { LinkBlockSpec } from "@ep0ch/outline-core/link-blocks";
  import type { SiteBlock } from "@ep0ch/outline-core/site-blocks";
  import type { UseCall } from "@ep0ch/outline-core/template-use";
  import type { ViewSpec } from "@ep0ch/outline-core/view-spec";
  /** A component found at a line: what it is, the line it ends on (inclusive), and its own reading. */
  export type ComponentAt = 
  /** A `::view`, or a `::graph-table` with a query or a view: a collection the service answers. */
  {
      kind: "view";
      end: number;
      block: ComponentBlock;
      spec: ViewSpec;
  }
  /** `::links`, `::outlinks`, `::backlinks`, `::resources`. */
   | {
      kind: "links";
      end: number;
      block?: ComponentBlock;
      spec: LinkBlockSpec;
  }
  /** `::use`: a template drawn in place of its line. */
   | {
      kind: "use";
      end: number;
      call: UseCall;
  }
  /** `::button`: a labelled press. */
   | {
      kind: "button";
      end: number;
      call: ButtonCall;
  }
  /** `::fields`. */
   | {
      kind: "fields";
      end: number;
      site: Extract<SiteBlock, {
          kind: "fields";
      }>;
  }
  /** `::if`: `end` is its closing `::`. */
   | {
      kind: "if";
      end: number;
      site: Extract<SiteBlock, {
          kind: "if";
      }>;
  }
  /** A `::graph-*` figure: `figure` is its kind (`stat`, `check`…). */
   | {
      kind: "figure";
      end: number;
      block: ComponentBlock;
      figure: string;
  }
  /** A `::box`: its body (the lines between its two) is note content, read line by line as the note is. */
   | {
      kind: "box";
      end: number;
      block: ComponentBlock;
  }
  /** Any other component block (an extension's, one nobody knows): its block, as written. */
   | {
      kind: "component";
      end: number;
      block: ComponentBlock;
  };
  export type ComponentKind = ComponentAt["kind"];
}

declare module "@ep0ch/outline-core/component-block" {
  /** A component block found in a note's lines: its name, its arguments, and its first and last line (inclusive). */
  export interface ComponentBlock {
      name: string;
      args: string | null;
      start: number;
      end: number;
      attrs?: string; /** Its `^name` (PIE-747): the id it has inside its note. */
      id?: string;
  }
}

declare module "@ep0ch/outline-core/view-spec" {
  export interface ViewSpec {
      props: Record<string, unknown>;
      args?: Record<string, string>;
      key?: string;
      error?: string; /** A YAML key the graph-table doesn't take, said as the write warning says it (PIE-1513). */
      warning?: string;
  }
}

declare module "@ep0ch/outline-core/link-blocks" {
  export type LinkGroupName = "outlinks" | "resources" | "backlinks" | "children" | "matches";
  /** The inline component's names: every group, or one. */
  export const LINK_BLOCK_KINDS: readonly ["links", "outlinks", "resources", "backlinks"];
  export type LinkBlockKind = (typeof LINK_BLOCK_KINDS)[number];
  /** Where an inline component draws its selected row (PIE-693): beside the list, under it, or not at all. */
  export type LinkPreview = "right" | "below" | "none";
  /**
   * What an inline component asks: whose links (default the note it's in), which groups, a filter, a title; and
   * (PIE-693) a query whose matches it lists, and where it previews the selected row.
   */
  export interface LinkBlockSpec {
      kind: LinkBlockKind;
      of: string | null;
      filter: string;
      title: string | null;
      /** Its `^name` on the first line (PIE-747): its id inside the note, the key its view state is kept under. */
      id?: string;
      /** The groups written (`groups:`), or null for its name's. */
      groups: LinkGroupName[] | null;
      /** A query in the saved views' grammar: its matches are the `matches` group. */
      query: string | null;
      /** The matches' order, in the views' sort words (`day desc`, PIE-1720); the service's own order when left out. */
      sort?: string;
      preview: LinkPreview;
      /**
       * The stage values its group headers and Stage name, in order (`stages: [next, doing, waiting]`, PIE-819), or null
       * for every value its rows carry. Rows with another value stay listed, said as "other".
       */
      stages: string[] | null;
      lines?: number;
      /**
       * How tall its preview draws (PIE-1720): a number of rows, or `fill` for the previewed note's own length, drawn
       * whole in the note so the reader's one scroll carries it. Left out, the preview's default.
       */
      height?: number | "fill";
      problem?: string;
  }
}

declare module "@ep0ch/outline-core/template-use" {
  /** One `::use` line of a note. */
  export interface UseCall {
      /** The line (from 0) it is written on. */
      line: number;
      /** The template as written (`[[meeting-template]]`, `((id))`, a Work ID, an id, or `type:meeting`); null when the line names none. */
      of: string | null;
      /** The call's props, in the order written: every attribute but the reserved ones (`of`, `act`, `as`…). */
      props: {
          key: string;
          value: string;
      }[];
      /** Reserved attributes written on the line that `::use` doesn't take (`as=new`, `freeze=all`), for a message. */
      reserved: {
          key: string;
          value: string;
      }[];
      /** The line couldn't be read as a call (no template named): what to write. */
      problem?: string;
  }
}

declare module "@ep0ch/outline-core/button-call" {
  /** One step: what it runs (`source`, its {slots} filled from the line) and, for a step with slots, the line as written (`written`). */
  export interface ButtonStep {
      kind: "act" | "script";
      source: string;
      written?: string;
  }
  /** One button, including its closed body when present. */
  export interface ButtonCall {
      /** The line (from 0) it is written on. */
      line: number;
      endLine: number;
      steps: ButtonStep[];
      sequence: boolean;
      /** Repeated slots of an of= script, in authored order. */
      props: Record<string, string[]>;
      /** What the button says: `label=`, else the script's or action's name. */
      label: string;
      /** The action line a press runs; null when the line names none. */
      act: string | null;
      /** The alternate press, when supplied. */
      alt?: string;
      /** The alternate press as written, when it names a slot (`tile.zoom tile={lift}`): what its slots are asked as (slotArgs). */
      altWritten?: string;
      /** How it looks (PIE-1287): what the line says of glyph, tone, frame and fill; the door's button part draws it. */
      look: ButtonLookWords;
      /** The slots the line fills itself (PIE-1298): `target=` for a `{target}` in act= or in an of= script's values, in the order written. */
      slots: ButtonSlot[];
      /** The slots with no value yet, in the order the button reads them: a press asks for each (never runs with one open). */
      empty: string[];
      /** The slots its alt= reads with no value yet (PIE-1316): the alt press asks for each; absent when none is open. */
      altEmpty?: string[];
      /** The line couldn't be read as a button, or reads as something other than what was written: what to write. */
      problem?: string;
      /** A look word it doesn't take (`tone=red`): what to write. It still runs; only its look falls back. */
      lookProblem?: string;
      /**
       * The container's marks before it on its line, as written (`- `, `  1. `, `> `, `> - `), when it sits in a list item or a
       * quote (PIE-1224); a button at the start of its line has none.
       */
      prefix?: string;
  }
  /** A button's tone: a theme role, never a colour. */
  export const BUTTON_TONES: readonly ["quiet", "primary", "danger"];
  /** A button's frame: `none` is one row (a filled band with fill=on), the rest are the box glyph sets, three rows high. */
  export const BUTTON_FRAMES: readonly ["none", "box", "round", "heavy", "double"];
  export type ButtonTone = typeof BUTTON_TONES[number];
  export type ButtonFrame = typeof BUTTON_FRAMES[number];
  /** What a `::button` line says of its look; a word it can't read is left out and named in `problem`. */
  export interface ButtonLookWords {
      glyph?: string;
      tone?: ButtonTone;
      frame?: ButtonFrame;
      fill?: boolean;
  }
  /** A word on the button's line that a `{key}` elsewhere on it reads. */
  export interface ButtonSlot {
      key: string;
      value: string;
  }
}

declare module "@ep0ch/outline-core/site-blocks" {
  /** What a `::fields` asks: which key, in whose note, and its title. */
  export interface FieldsSpec {
      key: string;
      of: string | null;
      title: string | null;
      problem?: string;
  }
  /** What an `::if` asks: the query `this` must match. */
  export interface IfSpec {
      where: string;
      problem?: string;
  }
  export type SiteBlock = {
      kind: "fields";
      spec: FieldsSpec;
      start: number;
      end: number;
  }
  /** `end` is the closing `::` line; the body is the lines between (`start + 1` to `end - 1`). */
   | {
      kind: "if";
      spec: IfSpec;
      start: number;
      end: number;
  };
}
