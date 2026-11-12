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
//! - `live.rs`: the same window against a real scratch host (ignored unless asked for).
mod actline;
mod contract;
mod control;
mod garden;
mod lists;
mod live;
mod one_owner;
mod owners;
mod parity;
mod parts;
mod shell;
mod store;
mod support;
mod window;
