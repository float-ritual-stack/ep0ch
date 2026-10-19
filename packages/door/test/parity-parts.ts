// Each entry is one Bun worker; labels keep the serial walks below the CI tail budget (PIE-1087).
export const PARITY_PARTS = {
  "board": { part: "board", labels: [
    "board: preview",
    "board: detail",
    "board: float",
    "board: outline dock",
    "board: backlinks dock",
  ] },
  "board-2": { part: "board", labels: [
    "board: hub picker",
    "river: a column beside",
    "river: replies shown",
  ] },
  "board-3": { part: "board", labels: [
    "river: a held column and a stacked pane",
  ] },
  "desk-tiles": { part: "desk-tiles", labels: [
    "desk: backlinks tile",
    "desk: who tile",
  ] },
  "desk-tiles-2": { part: "desk-tiles", labels: [
    "desk: art tile",
    "desk: facets tile",
  ] },
  "desk-tiles-3": { part: "desk-tiles", labels: [
    "desk: tags tile",
    "desk: daily",
    "desk: a terminal",
  ] },
  "desk": { part: "desk", labels: [
    "desk: tree",
    "desk: select wire",
    "desk: alt wire",
  ] },
  "desk-2": { part: "desk", labels: [
    "desk: wire policy",
  ] },
  "desk-3": { part: "desk", labels: [
    "desk: thread",
    "desk: activity",
  ] },
  "desk-4": { part: "desk", labels: [
    "desk: reader on a note",
    "desk: reader thread panel",
    "drawer: pulled up",
  ] },
  "readers": { part: "readers", labels: [
    "message reader",
    "home base",
    "home base, an outline missing",
    "library",
    "library: one property",
    "library: grids",
    "library: every combination",
    "echonet: messages",
  ] },
  "readers-2": { part: "readers", labels: [
    "echonet: a message read",
    "reader: notebook",
    "reader: notebook on an element",
  ] },
  "readers-3": { part: "readers", labels: [
    "reader: notebook with a fold picked",
    "reader: whiteboard",
    "reader: recipe",
    "reader: shed",
    "reader: brief",
    "reader: a rule note's settings card",
    "reader: a rule note's settings card on its third field",
    "reader: a view's settings card",
    "reader: a view that is an EchoNet area: a two-section card",
  ] },
  "screens": { part: "screens", labels: [
    "main menu",
    "N",
    "J",
    "K",
    "R",
    "W",
    "L",
    "F",
    "S",
    "Q",
    "B",
  ] },
  "screens-2": { part: "screens", labels: [
    "D",
    "T",
    "O",
    "C",
    "I",
    "A",
    "M",
  ] },
  "showcase": { part: "showcase", labels: [
    "X",
  ] },
  "showcase-2": { part: "showcase", labels: [
    "showcase: section 3",
  ] },
  "showcase-3": { part: "showcase", labels: [
    "showcase: section 3 tried",
  ] },
} as const;
