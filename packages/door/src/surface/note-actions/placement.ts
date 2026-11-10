// Where the reader's attached parts go and how they move (PIE-785, PIE-846, PIE-1536): the placement menu
// (placement.*), attachment.split, and the grip, move and place of Sources (sources.grip/move/place), the edit's preview
// (edit.preview.*) and the comment being written (comment.place/grip/move/leaving).
import { ATTACHED_KEYS } from "../attached-keys";
import { closeExtensionAttachment, openExtensionAttachment, scrollExtensionAttachment } from "../extension-attachment";
import { ATTACHED_PLACES } from "../attached";
import { FLOAT_MOVE_ARGS, type On } from "./shared";
import { modeActionKeys } from "../modes";
import { type ActionDef, ActionRefused, def } from "../actions";

/** Where the reader's parts go is the person's (each placement action's `person`). */
const BY_PERSON = "the placement belongs to the person";

export const PLACEMENT_DEFS = {
  "placement.menu": def({
    summary: "choose where the attachment sits; the current placement is marked",
    keys: "click the placement chip", touches: "tile", person: BY_PERSON, replay: "ask",
    args: { target: { type: "string", about: "comment, sources, list-preview, edit-preview or settings" } },
    examples: [{ act: "placement.menu target=sources", does: "opens the Sources placement menu" }],
    run: ({ target }, { surface, host }) => surface.openPlacementMenu(surface.attachments.kind(target), host),
  }),
  "placement.step": def({
    summary: "move through the placement menu", keys: [{ keys: "← ↑ ↓ → j k tab", does: "in the placement menu" }],
    touches: "tile", person: BY_PERSON, replay: "ask",
    args: { by: { type: "number", about: "rows to move" } },
    examples: [{ act: "placement.step by=1", does: "selects the next placement" }],
    run: ({ by }, { surface, host }) => surface.stepPlacement(by, host),
  }),
  "placement.choose": def({
    summary: "choose a placement from the open menu", keys: "Enter or click a placement",
    touches: "tile", person: BY_PERSON, replay: "ask",
    args: { place: { type: "string", optional: true, about: "placement; left out, the selected row" }, direction: { type: "string", optional: true, about: "right or down for a split" } },
    examples: [{ act: "placement.choose place=split direction=right", does: "places the attachment beside the note" }],
    run: ({ place, direction }, { surface, host }) => surface.choosePlacement(place, host, direction),
  }),
  "placement.close": def({
    summary: "close the placement menu", keys: "Esc or click outside the placement menu",
    touches: "tile", person: BY_PERSON, replay: "ask", args: {},
    run: (_, { surface, host }) => surface.closePlacement(host),
  }),
  "attachment.split": def({
    summary: "size an attached surface split, or choose beside versus below", keys: [{ keys: "drag", does: "the split divider" }, { via: "placement menu beside/below" }],
    touches: "tile", person: "the split belongs to the person", replay: "ask",
    args: { target: { type: "string", about: "comment, sources, list-preview, edit-preview or settings" }, direction: { type: "string", optional: true, about: "right or down" }, share: { type: "number", optional: true, about: "attachment share of the reader, .15 to .85" } },
    examples: [{ act: "attachment.split target=sources direction=down share=0.4", does: "puts the sources split below the note with forty percent of its height" }],
    run({ target, direction, share }, { surface, host }) { const split = surface.attachments.split(surface.attachments.kind(target), direction, share); host.redraw(); return split; },
  }),
  // An extension's attached surface (Nov 3 review card 16): the one set of actions every declared `<id>.<kind>` shares.
  "attachment.open": def({
    summary: "open an installed extension's attached surface beside the note now shown (its record's `attachments`, named <id>.<kind>); it follows the reader to the next note",
    keys: [{ via: "the power bar's actions list" }], touches: "tile", replay: "ask",
    args: { target: { type: "string", about: "the extension's kind, <id>.<kind> (extensions.list's attachments)" }, place: { type: "string", optional: true, about: "inline, floating, split, popup or tile; left out, split" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "attachment.open target=beside.facts", does: "opens the Beside extension's facts card next to the note" }],
    run: ({ target, place, side }, { surface, host }) => openExtensionAttachment(surface.attachments, target, place, side, host),
  }),
  "attachment.close": def({
    summary: "put an extension's attached surface away", keys: [{ via: "the power bar's actions list" }], touches: "tile", replay: "ask",
    args: { target: { type: "string", about: "the extension's kind, <id>.<kind>" } },
    examples: [{ act: "attachment.close target=beside.facts", does: "closes the facts card" }],
    run: ({ target }, { surface, host }) => closeExtensionAttachment(surface.attachments, target, host),
  }),
  "attachment.place": def({
    summary: "place an open extension surface inline, floating, split, popup or in a tile; left out, the next one",
    keys: "click its placement chip", touches: "tile", person: BY_PERSON, replay: "ask",
    args: { target: { type: "string", about: "the extension's kind, <id>.<kind>" }, place: { type: "string", optional: true, about: "inline, floating, split, popup, tile; left out, cycle" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "attachment.place target=beside.facts place=floating", does: "floats the facts card over the note" }],
    run: async ({ target, place, side }, { surface, host }) => ({ place: await surface.attachments.put(surface.attachments.kind(target), place, host, side) }),
  }),
  "attachment.move": def({
    summary: "move or size an extension's floating surface inside its reader", keys: "drag its header or corner", touches: "tile", person: BY_PERSON, replay: "ask",
    args: { target: { type: "string", about: "the extension's kind, <id>.<kind>" }, ...FLOAT_MOVE_ARGS },
    examples: [{ act: "attachment.move target=beside.facts dx=2 dy=-1", does: "moves the floating facts card right and up" }],
    run: ({ target, ...move }, { surface, host }) => surface.attachments.move(surface.attachments.kind(target), move, host),
  }),
  "attachment.scroll": def({
    summary: "scroll an extension's surface by rows", keys: [{ via: "the power bar's actions list" }], touches: "tile", replay: "ask",
    args: { target: { type: "string", about: "the extension's kind, <id>.<kind>" }, by: { type: "number", about: "rows, negative up" } },
    examples: [{ act: "attachment.scroll target=beside.facts by=3", does: "scrolls the facts card down three rows" }],
    run: ({ target, by }, { surface }) => scrollExtensionAttachment(surface.attachments, target, by),
  }),
  "sources.grip": def({
    summary: "move or size sources with the comment box's grip keys", keys: modeActionKeys(ATTACHED_KEYS, "sources.grip"),
    touches: "tile", person: "the panel belongs to the person", replay: "ask", args: {},
    run: (_, { surface, host }) => surface.gripSources(host),
  }),
  "sources.move": def({
    summary: "move or size the floating Sources panel inside its reader", keys: "drag its header or corner; ctrl+g then arrows or shift+arrows; 0 its usual place",
    touches: "tile", person: "the panel belongs to the person", replay: "ask", args: FLOAT_MOVE_ARGS,
    examples: [{ act: "sources.move dx=2 dy=-1", does: "moves floating sources right and up" }],
    run: (args, { surface, host }) => surface.attachments.move("sources", args, host),
  }),
  "edit.preview.place": def({
    summary: "place the edit preview below, beside, floating, popup or in a tile; kept for next time",
    keys: [{ keys: "click", does: "the preview header's placement chip" }, { keys: "← ↑ ↓ → ⏎", does: "in its menu" }],
    touches: "tile", person: BY_PERSON, replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline (below), split, floating, popup or tile" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "edit.preview.place place=split", does: "places the live preview beside or below the draft" }],
    run: async ({ place, side }, { surface, host }) => ({ place: await surface.attachments.put("edit-preview", place, host, side) }),
  }),
  "edit.preview.move": def({
    summary: "move or size the floating edit preview inside its reader", keys: "drag its header or corner",
    touches: "tile", person: "the preview belongs to the person", replay: "ask", args: FLOAT_MOVE_ARGS,
    examples: [{ act: "edit.preview.move dx=2 dy=-1", does: "moves the floating edit preview right and up" }],
    run: (args, { surface, host }) => surface.attachments.move("edit-preview", args, host),
  }),
  "sources.place": def({
    summary: "place sources inline, floating, split, popup or in its own tile; kept for next time",
    keys: modeActionKeys(ATTACHED_KEYS, "sources.place"),
    touches: "tile", person: BY_PERSON, replay: "ask",
    args: { place: { type: "string", optional: true, about: "inline, floating, split, popup, tile; left out, cycle" }, side: { type: "string", optional: true, about: "left, right, up or down for a tile" } },
    examples: [{ act: "sources.place place=tile side=right", does: "puts Sources in a tile beside the note" }],
    run: async ({ place, side }, { surface, host }) => ({ place: await surface.attachments.put("sources", place, host, side) }),
  }),
  "comment.place": def({
    summary: "where the comment, question or reply being written sits (PIE-770): inline (a box under its passage, in the note, which still reads and scrolls around it), floating (a box over the note beside the passage), split (the reader shared: the note beside the composer, or over it when narrow), popup (a box in the middle, the passage quoted) or tile (PIE-846: a tile of its own in the note's place, beside it on side= left, right, up or down, the tiles round them never moving; sized by its border; closing it gives the note its room back; the thread list (m) goes there too). Left out, the next one. This composer only: composer.place sets where new ones open",
    keys: modeActionKeys(ATTACHED_KEYS, "comment.place"),
    touches: "draft", draft: "type", replay: "ask",
    args: {
      place: { type: "string", optional: true, about: `${ATTACHED_PLACES.join(", ")}; left out, the next one (with side=, tile)` },
      side: { type: "string", optional: true, about: "left, right, up or down: which side of its note the comment's tile is on (PIE-846); kept for the next" },
    },
    examples: [
      { act: "comment.place place=split", does: "shares the reader: the note beside the comment being written" },
      { act: "comment.place place=tile side=right", does: "gives the comment a tile of its own to the right of the note" },
    ],
    async run({ place, side }, { surface, host }) {
      const want = await surface.attachments.put("comment", place, host, side);
      return { place: want, ...(side !== undefined ? { side } : {}) };
    },
  }),
  "comment.grip": def({
    summary: "move and size the comment being written by keys (PIE-785): it floats (if it was elsewhere), then ← → ↑ ↓ or h j k l move it, shift+arrows or H J K L size it, 0 puts it back in its usual place, ⏎ or esc is done. Each step is comment.move. For this sitting only: opened again, it's in its usual place",
    keys: modeActionKeys(ATTACHED_KEYS, "comment.grip"),
    touches: "draft", draft: "type", replay: "ask",
    args: {},
    run(_, { surface, host }) {
      surface.grip(host);
      return { moving: true };
    },
  }),
  "comment.move": def({
    summary: "move or size the floating comment being written (PIE-785): dx dy step it (columns, rows), col row put its corner there, dcols drows or cols rows size it (the reader's cells); reset=true puts it back in its usual place beside the passage. Moving it never changes the passage it's on. For this sitting only: never kept, so a comment opened again (or read later) is in its usual place",
    keys: "drag its top edge (≡ move), drag its ◢ corner or edges; ctrl+g then arrows (shift: size); 0 its usual place",
    touches: "draft", draft: "type", replay: "ask",
    args: FLOAT_MOVE_ARGS,
    examples: [
      { act: "comment.move dx=4 dy=-2", does: "moves the floating comment four columns right and two rows up" },
      { act: "comment.move cols=60 rows=12", does: "sizes the floating comment to 60 columns by 12 rows" },
      { act: "comment.move reset=true", does: "puts the floating comment back in its usual place and size" },
    ],
    run(args, { surface, host }) {
      return { float: surface.moveComposer(args, host) };
    },
  }),
  "comment.leaving": def({
    summary: "answer \"about to leave an unsent comment\" (PIE-785), asked when the person follows a link, a comment mark, back or forward while their comment is unsent: save keeps it as unsent where it was written (opening it again brings it back) and goes on; keep goes back to writing; discard lets it go (a copy stays on disk) and goes on. The person's choice: an agent's action never asks it",
    keys: [{ keys: "⏎ click", does: "the power bar's rows" }, { keys: "esc", does: "keeps writing", says: "keep writing the comment" }],
    touches: "draft", draft: "leave", replay: "ask", person: "leaving the person's unsent comment is their choice",
    args: { choice: { type: "string", about: "save, keep or discard" } },
    examples: [
      { act: "comment.leaving choice=save", does: "keeps the unsent comment where it was written and goes on" },
      { act: "comment.leaving choice=keep", does: "goes back to writing the comment instead of leaving" },
      { act: "comment.leaving choice=discard", does: "lets the unsent comment go, a copy staying on disk, and goes on" },
    ],
    run({ choice }, { surface, host }) {
      if (choice !== "save" && choice !== "keep" && choice !== "discard") throw new ActionRefused(`choice is save, keep or discard, not ${JSON.stringify(choice)}`);
      return surface.answerLeave(choice, host);
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
