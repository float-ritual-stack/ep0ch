//! The window's tests. `garden` is the made-up outline they share and the stand-in link that answers for its
//! host; each file under here is one kind of test:
//!
//! - `garden.rs`: what the window asks and what it does with the answers, asserting the wire.
//! - `window.rs`: the window drawn, pressed and typed in.
//! - `parity.rs`: every action by its chord, by its bar row pressed and by its act line, leaving one step record.
//! - `store.rs`: one slot an ask, the watch budget, what the service dropped.
//! - `contract.rs`: every row of the door's layout and place tables, asked of `layout::apply` and `layout::place`.
//! - `shell.rs`: tiles and screens: one test a container kind, where opens land, a screen saved, broken and reset.
//! - `lists.rs`: one list, whatever it is of: lanes, a table, facets as chips, the shipped screens opened from the bar.
//! - `actline.rs`: the act-line grammar and the action rows against outline-core's fixtures.
//! - `parts.rs`: a page's parts through the primitive registry: every type has a builder, a button runs here or is
//!   the service's, a script's act is run and answered, and every component's own example is drawn (the coverage table).
//! - `control.rs`: an agent over the control socket.
//! - `one_owner.rs`: the source itself, scanned for a second place that decides.
//! - `owners.rs`: the same, by what the window does: each test is a failure a second decider caused.
//! - `sweep2.rs`: the second sweep's, the same way: one test a decider folded.
//! - `sweep3.rs`: the third sweep's: who a script's act runs as, which reader a list speaks for, what a close leaves
//!   of its note, what a refusal says the way out is.
//! - `drafts.rs`: a block written in place, as a person works: typed in, completed from the service's list, saved;
//!   held on the service, read and patched under the caret; kept as typed and found back after the window ended.
//! - `ext.rs`: extensions and outlines: one installed from the bar's row, used, configured by its form and removed;
//!   a switch of outline and back to a block as it was being written; a tile torn into a second window over the
//!   same store, a link an outline, and the control socket naming the window an act is for.
//! - `review.rs`: about the note: the tiles that follow the reader, a comment on a selection, a reply and a thread
//!   resolved, a proposal applied and dismissed, a revision opened and put back, the keys and library screens.
//! - `live.rs`: the same window against a real scratch host (ignored unless asked for).
mod actline;
mod contract;
mod control;
mod drafts;
mod ext;
mod garden;
mod lists;
mod live;
mod one_owner;
mod owners;
mod parity;
mod parts;
mod review;
mod shell;
mod store;
mod support;
mod sweep2;
mod sweep3;
mod ways;
mod window;
