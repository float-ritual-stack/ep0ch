// Whether this door draws frames (App.paint): a tile that isn't in them lately is off the screen, and can wait to read
// what changed (PIE-1413, src/desk/query.ts). Until a first frame (a test's door, an agent's headless one) every tile
// counts as shown.
let painted = false;

/** A frame was drawn (`false`: as if none ever was, for a test). */
export function framePainted(drawn = true): void { painted = drawn; }

/** Whether a frame has ever been drawn. */
export function framesDrawn(): boolean { return painted; }
