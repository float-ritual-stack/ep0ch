//! The `pty` drawer: a program's screen in a terminal tile. It draws the model's grid (`crate::pty`), whatever runs
//! the program: herdr-core, tmux or a plain pty behind the `pty` feature, a scripted host in a scene, and nothing
//! at all in a window built without its terminal, where the tile says so in its kind's own words.
//!
//! - **A row is cut where a wide character sits** (`pty::cut`, PROBES §7): each stretch of one-column cells is one
//!   mono text in a box as wide as its cells, each wide character a box two cells wide, each run of ground a rect
//!   behind them. Whatever a glyph measures, the piece after it starts on its own column.
//! - **A row is drawn again only when its cells change**: its memo's version is the row itself (and the cursor,
//!   when it is on it). The grid lands at once, never eased: a scroll moves every row.
//! - **The tile says what keeps its program**, before anybody relies on it: what runs it, whether that outlives
//!   the window, what the program reports of itself, and whose the keys are. The words are the program's record
//!   (`pty::Shown`); the keycaps are the key table's, the labels the actions' rows.
//! - **It decides nothing.** A size is `terminal.fit`, the wheel `terminal.scroll`, a press `tile.enter`: act lines,
//!   as every drawer's presses are. Keys reach the program through the key table (`keys.rs`, the `program` layer).
//!
//! Not drawn: a line struck through (the cell's text is drawn plain), and a cursor's shape (it is a block).
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;

use rune::{Color, El, Family, Span, TextStyle, Tx, WheelEvent, col, el, memo, row, text};
use rune_kit::{Button, ButtonVariant, Kit};
use serde_json::{Value, json};

use super::{Drawer, TileCx};
use crate::actions::{self, Actor, App};
use crate::keys;
use crate::pty::{self, Cut, Grid, Ink, Look, Shown, Stands};
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "pty", about: "a program's screen in a terminal: rows cut where a wide character sits, each drawn again only when its cells change; every key but the one that leaves goes to the program while the person is in it", notes: false, lists: false, asks, draw, facts, takes_keys: true, version, over: None };

fn asks(_: &TileCx) -> Vec<(&'static str, Ask)> { Vec::new() }

/// The text a cell is set in: the kit's mono size and line, in the platform's own monospaced face (SF Mono,
/// fontconfig's `monospace`): a grid needs every one-column glyph the same width, which the kit's mono slot only
/// has where the app registered a face for it.
pub fn style(k: &Kit) -> TextStyle { k.ty.mono.family(Family::SystemMono) }

/// A cell in points: the mono face's own advance (measured over a long run, so rounding to a point is a
/// hundredth of it) and the style's line. Measured once a size: the face doesn't change under a window.
pub fn cell(style: TextStyle) -> (f32, f32) {
    static CELL: OnceLock<std::sync::Mutex<Vec<(u32, (f32, f32))>>> = OnceLock::new();
    let known = CELL.get_or_init(Default::default);
    let size = style.size.to_bits();
    if let Some((_, cell)) = known.lock().unwrap().iter().find(|(theirs, _)| *theirs == size) { return *cell }
    let (wide, high) = rune::text::measure(&"M".repeat(200), &[], style, None);
    let cell = ((wide / 200.0).max(1.0), high.max(style.line_height).max(1.0));
    known.lock().unwrap().push((size, cell));
    cell
}

fn ink(ink: Ink, or: Color) -> Color { match ink { Ink::Default => or, Ink::Rgb(r, g, b) => rune::color::hex(&format!("#{r:02x}{g:02x}{b:02x}")).unwrap_or(or) } }

fn spans(looks: &[(usize, usize, Look)], base: Color) -> Vec<Span> {
    looks.iter().filter(|(_, _, look)| *look != Look::default()).map(|(from, till, look)| {
        let color = ink(look.fg, base);
        let mut span = Span::new(*from, *till).color(color);
        if look.bold { span = span.bold() }
        if look.italic { span = span.italic() }
        if look.underline { span = span.underline(color) }
        span
    }).collect()
}

/// One row, cut: its grounds as rects, then each piece in a box as wide as its cells, then the cursor when it is
/// on this row (a block where the person types, an outline where the keys are elsewhere).
fn row_of(cut: &Cut, cols: u16, cursor: Option<(u16, bool)>, (cw, ch): (f32, f32), key: &str, k: &Kit) -> El {
    let mut line = el().key(key.to_string()).w(f32::from(cols) * cw).h(ch);
    for ground in &cut.grounds {
        let (r, g, b) = ground.ink;
        line = line.child(el().key(format!("{key}/ground/{}", ground.col)).absolute(f32::from(ground.col) * cw, 0.0).w(f32::from(ground.cols) * cw).h(ch).fill(ink(Ink::Rgb(r, g, b), k.c.surface_base)));
    }
    if let Some((at, typing)) = cursor {
        let block = el().key(format!("{key}/cursor")).absolute(f32::from(at) * cw, 0.0).w(cw).h(ch);
        line = line.child(if typing { block.fill(k.c.text_base.alpha(0.45)) } else { block.border(1.0, k.c.text_muted) });
    }
    for stretch in &cut.stretches {
        let words = text(stretch.text.clone()).font(style(k)).color(k.c.text_base).spans(spans(&stretch.looks, k.c.text_base)).selectable(true);
        line = line.child(el().key(format!("{key}/at/{}", stretch.col)).absolute(f32::from(stretch.col) * cw, 0.0).w(f32::from(stretch.cols) * cw).h(ch).child(words));
    }
    line
}

/// The grid: a memo a row, versioned by the row's own cells.
fn grid_of(cx: &TileCx, grid: &Grid, typing: bool, k: &Kit) -> El {
    let cell = cell(style(k));
    let mut rows = Vec::with_capacity(usize::from(grid.rows));
    for r in 0..grid.rows {
        let cursor = grid.cursor.filter(|(_, row)| *row == r).map(|(col, _)| (col, typing));
        let key = cx.key(format!("row/{r}"));
        let cells = grid.row(r);
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (cells, cursor, grid.cols, k.c.text_base.hex(), k.c.surface_base.hex()).hash(&mut h);
        rows.push(memo(key.clone(), h.finish(), || row_of(&pty::cut(cells), grid.cols, cursor, cell, &key, k)));
    }
    col().key(cx.key("grid")).w(f32::from(grid.cols) * cell.0).h(f32::from(grid.rows) * cell.1).instant_changes().children(rows)
}

/// A button for an act line run from this tile: its label the action's, its keycap the key table's.
fn button(cx: &TileCx, line: &str, k: &Kit) -> El {
    let b = Button::new(actions::label(line)).variant(ButtonVariant::Ghost).on_press(cx.act(line));
    match keys::cap(line) { Some(cap) => b.shortcut(cap), None => b }.build(k).key(cx.key(format!("do/{line}")))
}

/// What the tile says of its program, over its screen: what keeps it and for how long, how it stands and what it
/// reports of itself, and whose the keys are with the key that changes that.
fn strip(cx: &TileCx, shown: &Shown, typing: bool, k: &Kit) -> El {
    let c = &k.c;
    let say = |words: String, part: &str, color: Color| text(words).key(cx.key(part)).font(k.ty.small).color(color).truncate();
    // What keeps it, on a line of its own: read before anything is relied on.
    let mut kept = row().w_full().gap(10.0).center_y().child(say(shown.kept_said(), "kept", if shown.keeps { c.text_muted } else { c.warning.fg }));
    if shown.attached { kept = kept.child(say(pty::FOUND.to_string(), "found", c.text_faint)) }
    // Then how it stands, in its own word where it reports one, and whose the keys are: the act that changes
    // that, by its own label and key.
    let mut stands = row().w_full().gap(8.0).center_y();
    if let Some(report) = &shown.report { stands = stands.child(say(if report.msg.is_empty() { report.state.clone() } else { format!("{} · {}", report.state, report.msg) }, "report", c.text_base).grow(1.0).min_w(0.0)) }
    if !shown.stands.running() { stands = stands.child(say(shown.stands.word().to_string(), "state", c.danger.fg)) }
    if shown.report.is_none() { stands = stands.child(el().grow(1.0)) }
    stands = stands.child(button(cx, if !shown.stands.running() { "tile.restart" } else if typing { "tile.leave" } else { "tile.enter" }, k)).child(button(cx, "terminal.detach", k));
    col().key(cx.key("said")).w_full().px(8.0).py(3.0).gap(1.0).fill(c.layer_01).child(kept).child(stands)
}

/// A tile with no screen to draw: what its kind is, in the kind's own words (which say how a window gets its
/// terminal), and why nothing runs in it.
fn unstarted(cx: &TileCx, why: &str, k: &Kit) -> El {
    let said = text(why.to_string()).key(cx.key("why")).font(k.ty.small).color(k.c.danger.fg).wrap().max_w(460.0);
    super::waiting(cx, Some(col().gap(8.0).center().child(said).child(button(cx, "tile.restart", k))), k)
}

/// The size in cells a screen `r` points wide and high holds (less its padding), as the act that fits its program
/// to it: None while that is the size the program has.
fn fitted(r: [f32; 4], (cw, ch): (f32, f32), sized: (u16, u16)) -> Option<String> {
    let fits = (((r[2] - 2.0 * PAD) / cw).floor().clamp(2.0, 500.0) as u16, ((r[3] - 2.0 * PAD) / ch).floor().clamp(1.0, 300.0) as u16);
    (fits != sized).then(|| format!("terminal.fit cols={} rows={} cw={} ch={}", fits.0, fits.1, cw.round(), ch.round()))
}

/// The wheel over a screen, as the act that moves through what scrolled off: a line a cell's height of travel.
fn wheeled(e: &WheelEvent, ch: f32) -> Option<String> {
    let lines = (-e.dy / ch).round() as i32;
    (lines != 0).then(|| format!("terminal.scroll lines={lines}"))
}

/// The room around a screen's grid, in points.
const PAD: f32 = 4.0;

fn draw(cx: &TileCx, k: &Kit) -> El {
    let Some(shown) = cx.app.program_of(cx.id) else { return super::waiting(cx, None, k) };
    if let Stands::Failed(why) = &shown.stands { return unstarted(cx, why, k) }
    let typing = cx.app.in_program().as_deref() == Some(cx.id);
    let (cw, ch) = cell(style(k));
    let (from, sized) = (cx.name.clone(), (shown.grid.cols, shown.grid.rows));
    let over = cx.name.clone();
    // The screen fills what the tile gives it: a size in cells is said as an act when it is another than the
    // program's (the tile's own `terminal.fit`), and the wheel moves through what scrolled off.
    let screen = el().key(cx.key("screen")).w_full().grow(1.0).min_h(0.0).clip_rounded(0.0).fill(k.c.surface_base).padding(PAD)
        .on_layout(move |s: &mut App, r: [f32; 4]| if let Some(fit) = fitted(r, (cw, ch), sized) { s.act_in(&fit, &from, Actor::Person); })
        .on_wheel(move |s: &mut App, e: WheelEvent, tx: &mut Tx| { if let Some(scroll) = wheeled(&e, ch) { s.act_in(&scroll, &over, Actor::Person); tx.instant(); } true })
        .on_press(cx.act("tile.enter"))
        .child(grid_of(cx, &shown.grid, typing, k));
    col().key(cx.key("term")).w_full().h_full().min_h(0.0).child(strip(cx, &shown, typing, k)).child(screen)
}

fn facts(cx: &TileCx) -> Value {
    let Some(shown) = cx.app.program_of(cx.id) else { return json!({ "program": null }) };
    json!({
        "program": shown.key, "name": shown.name, "command": shown.command, "backend": shown.backend, "keeps": shown.keeps, "kept": shown.kept_said(),
        "attached": shown.attached, "state": shown.stands.word(), "status": shown.report.as_ref().map(|report| report.state.clone()), "says": shown.report.as_ref().map(|report| report.msg.clone()),
        "typing": cx.app.in_program().as_deref() == Some(cx.id), "cols": shown.grid.cols, "rows": shown.grid.rows, "cursor": shown.grid.cursor, "lines": shown.grid.lines(),
    })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    let shown = cx.app.program_of(cx.id);
    (shown.as_ref().map(|shown| (shown.moved, &shown.stands, &shown.report, &shown.backend, shown.keeps, shown.attached)), cx.app.in_program().as_deref() == Some(cx.id)).hash(&mut h);
    h.finish()
}
