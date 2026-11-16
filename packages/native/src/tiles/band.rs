//! A heading style's band and a track, drawn: the `band` and `track` primitives' builders (`prim.rs` registers
//! them). Which cell holds what is the model's (`crate::band`, the door's rule); here each cell is a small box in
//! the theme's own quiet ink, never a colour of its own. One drawing wherever the service answers the primitive:
//! a completion row's sample, the card of the lit row, and a page once it serves a styled heading as a band.
use rune::{El, col, el, row, text};
use rune_kit::Kit;
use serde_json::Value;

use super::prim::PrimCx;
use crate::band::{self, Ink};
use crate::parts::words;

/// A cell's size, in points: a track is one row of them.
const CELL: (f32, f32) = (6.0, 12.0);
/// The cells built for one side of a band's row, at most: what is past the element's edge is clipped.
const MOST: usize = 72;
/// The rows a band has when its primitive says none (a heading style's default).
const ROWS: usize = 3;

fn painted(ink: Ink, k: &Kit) -> El {
    let cell = el().w(CELL.0).min_w(CELL.0).h(CELL.1);
    let dim = |alpha: f32| k.alpha(k.c.text_faint, alpha);
    let dot = |size: f32, color: rune::Color| cell.clone().center().child(el().w(size).h(size).radius(size / 2.0).fill(color));
    match ink {
        Ink::Blank => cell,
        Ink::Shade(n) => cell.fill(dim(match n { 1 => 0.28, 2 => 0.5, _ => 0.78 })),
        Ink::Dot => dot(2.0, dim(0.7)),
        Ink::Mark => dot(3.0, k.c.text_base),
        Ink::Line => cell.center_y().child(el().w_full().h(1.0).fill(dim(0.7))),
        Ink::Double => cell.center_y().child(col().w_full().gap(2.0).child(el().w_full().h(1.0).fill(dim(0.7))).child(el().w_full().h(1.0).fill(dim(0.7)))),
    }
}

/// The cells of a row from the edge it fades from, as wide as it is given and clipped there. `mirrored`: the edge
/// is its right one.
fn side(cells: Vec<Ink>, mirrored: bool, k: &Kit) -> El {
    let strip = if mirrored { cells.into_iter().rev().fold(row().justify_end(), |strip, ink| strip.child(painted(ink, k))) } else { cells.into_iter().fold(row(), |strip, ink| strip.child(painted(ink, k))) };
    strip.h(CELL.1).grow(1.0).min_w(0.0).clip_soft(0.0)
}

/// How many cells across the element keyed `key` was when it was last laid out (before that: a guess).
fn across(key: &str, guess: usize) -> usize { rune::memo::layout_with(key, |at| (at[2] / CELL.0) as usize).filter(|cols| *cols > 0).unwrap_or(guess) }

/// A track: one row of a pattern's cells, fading from its left edge, as wide as it is given.
pub fn track(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let pattern = prim["pattern"].as_str().unwrap_or("rule");
    let room = across(&cx.key(), 16);
    side(band::strip(pattern, 1, 0, room.min(MOST), room, 2, band::seed_of(pattern)), false, k).key(cx.key()).w_full().role("img").label(pattern.to_string())
}

/// A band: a heading on a row of its pattern's rows. Centred, the words stand in the middle with a track fading in
/// from either edge; at the left or the right, the track is heaviest by the words and fades out to the other edge.
pub fn band(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let said = words(prim);
    let level = prim["level"].as_u64().unwrap_or(2);
    let Some(pattern) = prim["pattern"].as_str() else { return heading(&said, level, prim, k).key(cx.key()).wrap() };
    let (align, rows) = (prim["align"].as_str().unwrap_or("center"), prim["rows"].as_u64().map_or(ROWS, |rows| rows.clamp(1, 3) as usize));
    let on = match prim["row"].as_str() { Some("top") => 0, Some("bottom") => rows - 1, _ => (rows - 1) / 2 };
    let seed = band::seed_of(&said);
    let centred = align == "center";
    let room = across(&cx.key(), 96) / if centred { 2 } else { 1 };
    let cells = |r: usize| band::strip(pattern, rows, r, room.min(MOST), room, level, seed);
    let mut out = col().key(cx.key()).w_full().role("heading").label(said.clone());
    for r in 0..rows {
        let label = (r == on && !said.is_empty()).then(|| heading(&said, level, prim, k).px(CELL.0 * 2.0));
        let mut line = row().w_full().center_y().min_h(CELL.1);
        // The edge a row fades from: both for a centred band, the heading's own side otherwise (heaviest by the words).
        match align {
            "left" => line = line.children(label).child(side(cells(r), false, k)),
            "right" => line = line.child(side(cells(r), true, k)).children(label),
            _ => line = line.child(side(cells(r), false, k)).children(label).child(side(cells(r), true, k)),
        }
        out = out.child(line);
    }
    out
}

/// A heading's words, sized by its level, in its tone.
fn heading(said: &str, level: u64, prim: &Value, k: &Kit) -> El {
    let (size, line) = match level { 1 => (26.0, 32.0), 3 => (16.0, 22.0), _ => (20.0, 26.0) };
    text(said.to_string()).font(rune::TextStyle { size, line_height: line, ..k.ty.body_medium }).color(super::prim::tone(prim, k)).selectable(true)
}
