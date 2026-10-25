// A resize going on (PIE-623): a border or a float's corner being dragged, or the terminal being resized. While it
// lasts, the work that only the size it ends at needs waits: no image is scaled (media.ts draws what's ready, the
// terminal scaling it), and the desk reflows only the tiles a frame has time for (the others keep their last view a
// frame or two). Each report of it holds it RESIZE_HOLD_MS more, so a resize whose end never came ends by itself;
// `resizeEnded` ends it at once. Either way the frame after it lays everything out at the size it ended at.
//
// A drag is different from a terminal being resized: the person's button is down, and its reports come at the pace of
// the link. A link that stalls for half a second (a wifi dropout is seconds) stops them with the button still down, and
// the drag has not ended: laying out every tile and uploading images then pushes the big frames onto the link that
// just stalled (PIE-1163). A held drag (`resizeHeld`) holds RESIZE_HELD_MS instead, the timer only for a release that
// never came (the pointer let go outside the window).

/** How long a resize's report holds it: a drag paused that long is laid out and scaled for where it is. */
export const RESIZE_HOLD_MS = 500;
/** How long a drag's report holds it while the button is down: the ceiling for a release that never comes. */
export const RESIZE_HELD_MS = 30_000;

let until = 0, endedAt = -Infinity;
let timer: ReturnType<typeof setTimeout> | null = null;
const ended = new Set<() => void>();

/** A resize is going on: for `ms` more, unless another report says it again or it's ended. */
export function resizing(ms = RESIZE_HOLD_MS): void {
  if (timer) clearTimeout(timer);
  until = Date.now() + ms;
  timer = setTimeout(end, ms);
  timer.unref?.();
}

/** A border or a float's corner is being dragged, the button down: held until it's let go (`resizeEnded`), not until the reports pause. */
export function resizeHeld(): void { resizing(RESIZE_HELD_MS); }

/** The resize ended (the border let go). */
export function resizeEnded(): void { if (until) end(); }

/** Whether a resize is going on. */
export const inResize = (): boolean => until > 0 && Date.now() < until;

/**
 * Whether a resize is going on or ended within `ms`: what it left to make (an image for the size it ended at) may
 * still be on its way, and what was drawn during it stands in meanwhile.
 */
export const resizedWithin = (ms: number): boolean => inResize() || Date.now() - endedAt < ms;

/** Call `fn` when a resize ends (the door redraws: what waited is laid out and scaled now). */
export function onResizeEnd(fn: () => void): () => void { ended.add(fn); return () => ended.delete(fn); }

function end() {
  if (timer) { clearTimeout(timer); timer = null; }
  until = 0;
  endedAt = Date.now();
  for (const fn of ended) fn();
}
