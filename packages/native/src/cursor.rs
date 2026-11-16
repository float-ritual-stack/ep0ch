//! Where the keys move a cursor: one row of a list, one tile of a screen. No Rune and no state: each function is
//! the one port of a rule of outline-core's `list-cursor.ts`, which the terminal door's lists and desk ask too, and
//! `fixtures/core-contract.json` holds each to it row for row (`steps`, `parents`, `tabStops`).
//!
//! - **A list's cursor is a row by its id** (`TileUi.cursor`), never by its place: the rows change under it (a
//!   folder opens, a question is narrowed) and it stays on its note. Where a step lands is `stepped`, asked with
//!   the place its row has now.
//! - **Tab stops are the layout's**, in reading order: `tab_stops` says which tiles are one stop together (a
//!   board's lanes, a dock), and `next_stop` goes round the ends.

/// One step of a list's cursor: a number of rows, a page up or down, or an end (outline-core's `CursorStep`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Step { By(i64), Page(i64), First, Last }

/// Rows a page moves: the view's rows less one, so the row at the edge stays in sight; at least one.
pub fn page_rows(room: f64) -> i64 { (room.floor() as i64 - 1).max(1) }

/// Where a step moves a cursor: `at` of `n` rows (-1: on no row yet), in a view of `room` rows. Kept within the
/// rows there are; a list with none leaves it where it was.
pub fn stepped(step: Step, at: i64, n: usize, room: f64) -> i64 {
    if n == 0 { return at }
    let last = n as i64 - 1;
    match step {
        Step::By(by) => at.saturating_add(by).clamp(0, last),
        Step::Page(pages) => at.saturating_add(pages.saturating_mul(page_rows(room))).clamp(0, last),
        Step::First => 0,
        Step::Last => last,
    }
}

/// The row a tree's row is under: the nearest row above it that is less deep.
pub fn parent_row(depths: &[usize], at: usize) -> Option<usize> {
    let depth = depths.get(at).copied().unwrap_or(0);
    (0..at.min(depths.len())).rev().find(|i| depths[*i] < depth)
}

/// A tile shown, and the container it is one stop with: the set of columns or the dock it is in, by its id.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown { pub id: String, pub within: Option<String>, pub columns: bool }

/// Where Tab stops, in reading order: each tile shown, then the floats. A set of columns is one stop (the tile with
/// the keys when it is in them, else the one last used there, else their first), and so is a dock (the tile with the
/// keys, else its first).
pub fn tab_stops(shown: &[Shown], focus: &str, last: impl Fn(&str) -> Option<String>, floats: &[String]) -> Vec<String> {
    let (mut out, mut seen): (Vec<String>, Vec<&str>) = (Vec::new(), Vec::new());
    for tile in shown {
        let Some(within) = tile.within.as_deref() else { out.push(tile.id.clone()); continue };
        if seen.contains(&within) { continue }
        seen.push(within);
        let ids: Vec<&str> = shown.iter().filter(|other| other.within.as_deref() == Some(within)).map(|other| other.id.as_str()).collect();
        let at = if tile.columns { last(within) } else { None };
        out.push(if ids.contains(&focus) { focus.to_string() } else { at.filter(|at| ids.contains(&at.as_str())).unwrap_or_else(|| ids[0].to_string()) });
    }
    out.extend(floats.iter().cloned());
    out
}

/// The stop `by` stops on from `at`, round the ends. A tile that is no stop counts from before the first.
pub fn next_stop(stops: &[String], at: &str, by: i64) -> Option<String> {
    if stops.is_empty() { return None }
    let (n, i) = (stops.len() as i64, stops.iter().position(|stop| stop == at).map_or(-1, |i| i as i64));
    stops.get((i + by).rem_euclid(n) as usize).cloned()
}
