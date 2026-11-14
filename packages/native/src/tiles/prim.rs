//! The primitive registry: one builder a primitive type, and nothing else draws a primitive.
//!
//! `PRIMS` has an entry for every type the service answers (outline-core's primitive.ts, and the five a page adds
//! in note-page.ts, a change among them, built in `diff.rs`: `outline-core/fixtures/primitives.json` lists them, and a test holds this table to it). An entry
//! says its type, how it is drawn here (`describe`: what `actions` over the control socket and the coverage table
//! print) and the function that builds it. A drawer hands a primitive to `build` and reads none of it itself: no
//! figure name, no component name, no property key is matched anywhere under `tiles/`.
//!
//! A builder speaks as a drawer does, by act lines: a primitive's `act` (the service's word on what a press runs:
//! a row's, a card's, a cell's, a text's) runs through the dispatcher from the page's tile, and a note's own button
//! is `button.press` (its steps may be the service's to run). No builder reads an activation or writes a line for one.
//! A type nobody has a builder for is drawn as its data, never hidden; nothing here panics on a shape it didn't
//! expect: a missing field is an empty one.
use rune::{El, SurfaceFit, TextStyle, col, el, row, text};
use rune_kit::markdown::Highlight;
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, Kit, Markdown};
use serde_json::Value;

use super::TileCx;
use super::picture::Shown;
use crate::actions::{Actor, App, CELL, word};
use crate::keys;
use crate::page::Picture;
use crate::parts::{self, list, words};

/// One primitive type: what it is called, how this window draws it, and the builder.
pub struct Prim {
    pub ty: &'static str,
    pub describe: &'static str,
    /// It takes the room a row gives it (a stat, a box); a control keeps its own width.
    pub fills: bool,
    pub build: fn(&Value, &PrimCx, &Kit) -> El,
}

pub static PRIMS: &[Prim] = &[
    Prim { ty: "part", describe: "a component's frame: its name, title, the question it asks (a press opens it as a query) or how fresh its answer is, the service's word on what is wrong, then its view; prose and a picture have no frame", fills: true, build: part },
    Prim { ty: "markdown", describe: "prose, by the kit's Markdown: headings, lists, tables, code fences, callouts as quotes with a bold lead; a link opens its note", fills: true, build: markdown },
    Prim { ty: "blockdown", describe: "Blockdown read as Markdown: what the two share draws; a property, a reference or a component inside it stays as written", fills: true, build: markdown },
    Prim { ty: "source", describe: "lines as they were written, in the code face: a component with no answer or no drawing", fills: true, build: source },
    Prim { ty: "picture", describe: "a picture where it stands, at its own size up to the reading measure or the height its note gives; a header image as a band, cropped and dimmed as asked; what's wrong said under it", fills: true, build: picture },
    Prim { ty: "image", describe: "a view's picture, drawn as a note's: its file read from the host, or its own svg", fills: true, build: picture },
    Prim { ty: "text", describe: "a line of words in its tone, strong when asked; a press when it carries an act line or a link", fills: true, build: words_el },
    Prim { ty: "badge", describe: "a small label; a press when it carries an act line", fills: false, build: badge },
    Prim { ty: "button", describe: "a labelled press with its keycap from the key table: an act line this window has runs here, a note's button with steps or a script is the service's to run", fills: false, build: button },
    Prim { ty: "stat", describe: "a tile: the value large over its label, in its tone", fills: true, build: stat },
    Prim { ty: "bar", describe: "a label, its value of the most, and a track filled that far", fills: true, build: bar },
    Prim { ty: "table", describe: "a header row and rows of equal columns; a row or a cell that opens a note or runs an act line is a press", fills: true, build: table },
    Prim { ty: "checklist", describe: "a box a row, filled when done; read-only here", fills: true, build: checklist },
    Prim { ty: "sparkline", describe: "a column a value, the tallest the largest", fills: true, build: sparkline },
    Prim { ty: "card", describe: "a bordered card: title, subtitle, badge, then its children; a press when it carries a link or an act line", fills: true, build: card },
    Prim { ty: "box", describe: "a bordered box, its title when it has one, then its children in order", fills: true, build: boxed },
    Prim { ty: "stack", describe: "its children, one under the other", fills: true, build: stack },
    Prim { ty: "row", describe: "its children side by side, wrapping when the tile is narrow; a child that fills shares the width, a control keeps its own", fills: true, build: beside },
    Prim { ty: "band", describe: "a heading, sized by its level; the glyph tracks of a heading style aren't drawn", fills: true, build: band },
    Prim { ty: "track", describe: "a ruled line; a heading style's glyph pattern isn't drawn", fills: true, build: track },
    Prim { ty: "diff", describe: "a change to a text as the service found it: the two sides named, how many lines each way, then each line in the code face, written lines and lines taken out marked and tinted, a long run both sides share said in words; nothing is compared here", fills: true, build: super::diff::build },
    Prim { ty: "list", describe: "the one list, drawn as a list tile draws it: rows under their group headers (a table's as cells under its columns, lanes side by side), built only where they are in view; a row with an act line is a press, its cells as badges, its chips questions for the bar, its detail under it; no filter, selection or preview pane here", fills: true, build: listed },
];

pub fn find(ty: &str) -> Option<&'static Prim> { PRIMS.iter().find(|prim| prim.ty == ty) }

/// The registry as `actions` over the control socket lists it: each type as its own entry says it.
pub fn described() -> Value { PRIMS.iter().map(|prim| serde_json::json!({ "type": prim.ty, "describe": prim.describe, "fills": prim.fills })).collect() }

/// How deep a view may nest before it is cut (the service caps a view at 8).
const DEEPEST: usize = 16;

/// Where a primitive is being built: the tile, the element key it is found under, and the part it is the view of.
pub struct PrimCx<'a> {
    pub tile: &'a TileCx<'a>,
    key: String,
    /// The part whose own view this is: a button there is the note's button, pressed by its line.
    own: Option<&'a Value>,
    depth: usize,
    /// It is under a row of a list (what the row shows under itself): a list here is built whole, since rows built
    /// only in view can't hold rows built only in view.
    in_row: bool,
    /// What stands inside the part being built here, at a place in its own text: handed to the part's own view.
    inset: Option<&'a Inset<'a>>,
}

/// Something that stands inside a part of prose, at a place in the text its view is drawn from: a part is as long
/// as its run of prose, so what is written about words in the middle of one stands under the block they end in,
/// not a screen below. The page drawer asks whether it can (`inset`: where that text may be cut for the place) and
/// hands it over with the part; the one builder of prose draws the text in two pieces with it between them.
pub struct Inset<'a> {
    /// Where the part's text is cut, in bytes: the start of a line.
    cut: usize,
    /// What stands there, built when the builder of prose reaches the place.
    stands: &'a dyn Fn() -> Option<El>,
}

/// Something to stand inside `part` at `place` of the text its view is drawn from (where an anchor ends there,
/// UTF-16, as the service said it). None: the part is drawn from no text, the place is in its last block (nothing
/// of it would stand underneath), or nothing near says where a cut is safe. It then stands under the part whole.
pub fn inset<'a>(part: &Value, place: usize, stands: &'a dyn Fn() -> Option<El>) -> Option<Inset<'a>> {
    let view = &part["view"];
    if parts::ty(view) != "markdown" { return None }
    let source = parts::text(view, "text")?;
    Some(Inset { cut: cut_after(source, crate::draft::byte_of(source, place)?)?, stands })
}

impl<'a> PrimCx<'a> {
    pub fn of(tile: &'a TileCx<'a>) -> PrimCx<'a> { PrimCx { tile, key: String::new(), own: None, depth: 0, in_row: false, inset: None } }
    /// The same place, under another key of the tile.
    pub fn at(&self, key: impl Into<String>) -> PrimCx<'a> { PrimCx { tile: self.tile, key: key.into(), own: None, depth: self.depth, in_row: self.in_row, inset: None } }
    /// The same place, as what a list's row shows under itself.
    pub fn in_row(mut self) -> PrimCx<'a> { self.in_row = true; self }
    /// The same place, with something to stand inside the part built there.
    pub fn taking(mut self, inset: &'a Inset<'a>) -> PrimCx<'a> { self.inset = Some(inset); self }
    fn under(&self, n: impl std::fmt::Display) -> PrimCx<'a> { PrimCx { tile: self.tile, key: format!("{}/{n}", self.key), own: None, depth: self.depth + 1, in_row: self.in_row, inset: None } }
    fn view_of<'b>(&'b self, part: &'b Value) -> PrimCx<'b> where 'a: 'b { PrimCx { tile: self.tile, key: self.key.clone(), own: Some(part), depth: self.depth + 1, in_row: self.in_row, inset: self.inset } }
    /// The key of what is being built: a part's own view is `<part>/view`, under its frame; what it holds is keyed
    /// under the part (`sub`), so a row of a part's list is `part/<n>/<id>`.
    pub(super) fn key(&self) -> String { if self.own.is_some() { self.sub("view") } else { self.tile.key(&self.key) } }
    fn frame(&self) -> String { self.tile.key(&self.key) }
    pub(super) fn sub(&self, part: impl std::fmt::Display) -> String { self.tile.key(format!("{}/{part}", self.key)) }
}

/// Builds one primitive by its type. One nobody has a builder for is its data.
pub fn build(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    if cx.depth > DEEPEST { return quiet("…", k) }
    let keyed;
    let cx = match parts::text(prim, "key") { Some(key) => { keyed = PrimCx { own: cx.own, inset: cx.inset, ..cx.at(key) }; &keyed } None => cx };
    match find(parts::ty(prim)) {
        Some(found) => (found.build)(prim, cx, k),
        None => col().key(cx.key()).w_full().gap(4.0)
            .child(quiet(&format!("This window draws no {} primitive: its data, as it came.", if parts::ty(prim).is_empty() { "untyped" } else { parts::ty(prim) }), k))
            .child(text(serde_json::to_string_pretty(prim).unwrap_or_default()).font(k.ty.mono).color(k.c.text_muted).wrap().selectable(true)),
    }
}

fn children(prim: &Value, cx: &PrimCx, k: &Kit) -> Vec<El> { list(prim, "children").iter().enumerate().map(|(n, child)| stood(child, build(child, &cx.under(n), k))).collect() }

/// `built` where a column holds it: a primitive that fills takes the column's width, a control stands at its own.
fn stood(prim: &Value, built: El) -> El { if find(parts::ty(prim)).is_none_or(|entry| entry.fills) { built } else { row().w_full().child(built) } }

fn sized(base: TextStyle, size: f32, line: f32) -> TextStyle { TextStyle { size, line_height: line, ..base } }
fn quiet(said: &str, k: &Kit) -> El { text(said.to_string()).font(k.ty.small).color(k.c.text_faint).wrap() }

/// A tone's colour: a theme role, never a colour of its own.
fn tone(v: &Value, k: &Kit) -> rune::Color {
    match v["tone"].as_str() { Some("good") => k.c.success.fg, Some("warn") => k.c.warning.fg, Some("bad") => k.c.danger.fg, Some("dim") => k.c.text_faint, Some("accent") => k.c.text_accent, _ => k.c.text_base }
}

/// `shown` as a press, when `v` carries the act line a press runs.
fn pressable(shown: El, v: &Value, cx: &PrimCx, k: &Kit) -> El {
    match parts::act(v) {
        Some(line) => k.interactive(shown).role("button").focusable(true).on_press(cx.tile.act(line)),
        None => shown,
    }
}

/// A box `[x, y, w, h]` holds a point.
fn holds(r: &[f32; 4], [x, y]: [f32; 2]) -> bool { x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3] }

/// The key a mark's words are found under on a page: the thing, the part, and which of the lines it covers there.
pub fn mark_key(tile: &TileCx, mark: &parts::Mark, line: usize) -> String { tile.key(format!("mark/{}/{}/{line}", mark.id, mark.at.part)) }

/// The room between the pieces of a part cut in two, and what stands between them: the room between a page's parts.
const BETWEEN: f32 = 14.0;
/// How many lines past a place a safe cut is looked for: a block longer than this keeps what is written about it
/// under the part.
const CUT_LINES: usize = 32;

/// Where a text of prose may be cut in two at or after byte `at`, so that the two pieces are drawn as the whole is:
/// the start of the first line past `at` where the kit's own reading of the pieces, one after the other, is its
/// reading of the whole (never inside a paragraph, a list, a quote or a table: nothing here reads Markdown to
/// say so). None: `at` is in the last block, so nothing of the text would stand under the cut; or no such line is near.
fn cut_after(source: &str, at: usize) -> Option<usize> {
    use rune_kit::markdown::parse_cached;
    let whole = parse_cached(source);
    let mut from = at;
    for _ in 0..CUT_LINES {
        let line = from + source.get(from..)?.find('\n')? + 1;
        if source[line..].trim().is_empty() { return None }
        let (head, rest) = (parse_cached(&source[..line]), parse_cached(&source[line..]));
        if !head.is_empty() && !rest.is_empty() && head.len() + rest.len() == whole.len() && head.iter().chain(rest.iter()).eq(whole.iter()) { return Some(line) }
        from = line;
    }
    None
}

fn markdown(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let source = parts::text(prim, "text").unwrap_or("");
    // What is attached to these words (the marks of the part this is the view of): each range tinted where its
    // words are drawn, a line of the text a mark of its own, the one whose thing is shown whole beside it stronger.
    // The ranges are the service's, in this text: nothing here reads what the words were written as.
    let marks: Vec<parts::Mark> = cx.own.map(parts::marks).unwrap_or_default().into_iter().filter(|mark| mark.at.range.is_some()).collect();
    let mut lit: Vec<(std::ops::Range<usize>, Highlight)> = Vec::new();
    let mut spots: Vec<(String, String)> = Vec::new();
    for mark in &marks {
        let open = cx.tile.ui.unfolded.contains(&mark.id);
        for (n, line) in parts::lines_of(source, mark.at.range.unwrap_or_default()).into_iter().enumerate() {
            let key = mark_key(cx.tile, mark, n);
            if let Some(act) = &mark.act { spots.push((key.clone(), act.clone())) }
            lit.push((line, if open { Highlight::current() } else { Highlight::new() }.key(key)));
        }
    }
    // A press on marked words runs the mark's own act. A highlight is paint, with no press of its own: where the
    // pointer is, is kept as it moves (nothing is drawn again for it), and a press is asked which mark's words, as
    // they were last laid out, it is on. (A drag that selects is no press, and a link's press is the link's.)
    let boxes: std::rc::Rc<Vec<([f32; 4], String)>> = std::rc::Rc::new(spots.into_iter().filter_map(|(key, act)| rune::memo::layout(&key).map(|at| (at, act))).collect());
    let pointer = std::rc::Rc::new(std::cell::Cell::new([f32::MIN; 2]));
    // One piece of the text, drawn: the whole of it, or what is over and under something that stands inside it.
    let piece = |text: &str, lit: Vec<(std::ops::Range<usize>, Highlight)>, key: String| -> El {
        let (tile, from) = (word(&cx.tile.name), cx.tile.name.clone());
        let shown = Markdown::new(text).selectable(true).tasks_read_only()
            .on_link_tx(move |s: &mut App, href: &str, _| { s.act(&format!("link.follow ref={} tile={tile}", word(href)), Actor::Person); })
            // A right-click on a link: the tile's menu, about the link first.
            .on_link_secondary(move |s: &mut App, href: &str, press: rune::PointerPress, _| for line in crate::shell::menu_lines(Some(&format!("link={}", word(href))), press) { s.act_in(&line, &from, Actor::Person); });
        if lit.is_empty() { return shown.build(k).key(key) }
        let (moved, at, boxes, from) = (pointer.clone(), pointer.clone(), boxes.clone(), cx.tile.name.clone());
        shown.highlights(lit).build(k).key(key)
            .on_pointer_move_any(move |pointer, tx| { moved.set([pointer.window_x, pointer.window_y]); tx.live_only(); })
            .on_press(move |s: &mut App| if let Some((_, act)) = boxes.iter().find(|(r, _)| holds(r, at.get())) { s.act_in(act, &from, Actor::Person); })
    };
    // Something stands inside this part, at a place in this text (`Inset`): under the block that holds the place,
    // with the rest of the text under it.
    let stands = cx.inset.filter(|inset| inset.cut < source.len() && source.is_char_boundary(inset.cut)).and_then(|inset| Some((inset.cut, (inset.stands)()?)));
    let Some((cut, standing)) = stands else { return piece(source, lit, cx.key()) };
    let (over, under): (Vec<_>, Vec<_>) = lit.into_iter().partition(|(range, _)| range.start < cut);
    let under = under.into_iter().map(|(range, lit)| (range.start - cut..range.end - cut, lit)).collect();
    col().key(cx.key()).w_full().gap(BETWEEN).child(piece(&source[..cut], over, cx.sub("over"))).child(standing).child(piece(&source[cut..], under, cx.sub("rest")))
}

fn source(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    text(parts::text(prim, "text").unwrap_or("").to_string()).key(cx.key()).font(k.ty.mono).color(k.c.text_muted).wrap().selectable(true)
}

fn words_el(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let shown = text(words(prim)).key(cx.key()).font(if prim["strong"] == true { k.ty.ui_medium } else { k.ty.ui }).color(tone(prim, k)).wrap();
    pressable(shown, prim, cx, k)
}

fn badge(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let variant = if prim["tone"] == "accent" { BadgeVariant::Accent } else { BadgeVariant::Subtle };
    let shown = Badge::new(parts::text(prim, "label").unwrap_or("")).variant(variant).standard().build(k).key(cx.key());
    match parts::act(prim) { Some(line) => pressable(shown, prim, cx, k).help(line.to_string()), None => shown }
}

/// A labelled press. A note's own button is pressed by its line (`button.press`): the dispatcher runs its act line
/// here or hands it to the service. Any other is its act line, as written.
fn button(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let act = parts::text(prim, "act").unwrap_or("");
    let line = match cx.own.and_then(|part| Some((parts::text(part, "block")?, parts::line_of(part)?))) {
        Some((block, line)) => format!("button.press note={} line={line}", word(block)),
        None => act.to_string(),
    };
    let variant = match prim["tone"].as_str() { Some("accent" | "good") => ButtonVariant::Contrast, Some("bad") => ButtonVariant::Danger, Some("warn") => ButtonVariant::Warning, _ => ButtonVariant::Neutral };
    let made = Button::new(parts::text(prim, "label").unwrap_or(act)).variant(variant).on_press(cx.tile.act(line));
    match keys::cap(act) { Some(cap) => made.shortcut(cap), None => made }.build(k).key(cx.key())
}

fn stat(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let lit = prim["tone"] == "accent";
    let value = [words(&prim["value"]), words(&prim["unit"])].into_iter().filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ");
    col().key(cx.key()).min_w(120.0).padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_02).border(1.0, if lit { k.c.border_focus } else { k.c.border_muted })
        .child(text(value).font(sized(k.ty.body_medium, 24.0, 30.0)).color(tone(prim, k)))
        .child(text(words(&prim["label"])).font(k.ty.small).color(k.c.text_muted).wrap())
}

fn bar(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let (value, max) = (prim["value"].as_f64().unwrap_or(0.0), prim["max"].as_f64().unwrap_or(0.0));
    let part = if max > 0.0 { (value / max).clamp(0.0, 1.0) as f32 } else { 0.0 };
    let fill = if prim["tone"].is_string() { tone(prim, k) } else { k.c.text_muted };
    col().key(cx.key()).w_full().gap(3.0)
        .child(row().w_full().gap(8.0).center_y()
            .child(text(words(&prim["label"])).font(k.ty.small).color(k.c.text_base).truncate().grow(1.0))
            .child(text(format!("{} / {}", words(&prim["value"]), words(&prim["max"]))).font(k.ty.small).color(k.c.text_faint)))
        .child(el().w_full().h(6.0).radius(3.0).fill(k.c.layer_02).child(el().w_frac(part).h(6.0).radius(3.0).fill(fill)))
}

fn table(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let (columns, body) = (list(prim, "columns"), list(prim, "rows"));
    let wide = columns.len().max(body.iter().map(|r| r.as_array().map_or(0, Vec::len)).max().unwrap_or(0)).max(1);
    let share = 1.0 / wide as f32;
    let mut out = col().key(cx.key()).w_full().gap(2.0);
    if columns.iter().any(|c| !words(c).is_empty()) {
        out = out.child(columns.iter().fold(row().w_full().px(10.0).py(4.0), |line, c| line.child(text(words(c)).font(k.ty.text_xsmall_medium).color(k.c.text_faint).truncate().w_frac(share))));
    }
    for (n, cells) in body.iter().enumerate() {
        let mut line = row().key(cx.sub(n)).w_full().px(10.0).py(5.0).radius(k.radius.sm);
        for (c, cell) in cells.as_array().map_or(&[][..], Vec::as_slice).iter().enumerate() {
            let shown = text(words(cell)).font(k.ty.ui).color(tone(cell, k)).truncate();
            line = line.child(el().w_frac(share).child(if cell.is_object() { pressable(shown.key(cx.sub(format!("{n}/{c}"))), cell, cx, k) } else { shown }));
        }
        // The row's own press: the act line the table says for it (`acts`).
        out = out.child(pressable(line, &serde_json::json!({ "act": prim["acts"][n] }), cx, k));
    }
    out
}

fn checklist(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    list(prim, "items").iter().enumerate().fold(col().key(cx.key()).w_full().gap(6.0), |out, (n, item)| {
        let done = item["done"] == true;
        let mark = el().w(14.0).h(14.0).radius(3.0).border(1.0, if done { k.c.text_accent } else { k.c.border_strong });
        out.child(row().key(cx.sub(n)).role("checkbox").label(words(&item["label"])).w_full().gap(8.0).center_y()
            .child(if done { mark.fill(k.c.text_accent) } else { mark })
            .child(text(words(&item["label"])).font(k.ty.ui).color(if done { k.c.text_muted } else { k.c.text_base }).wrap().grow(1.0)))
    })
}

fn sparkline(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    const TALL: f32 = 36.0;
    let values: Vec<f64> = list(prim, "values").iter().filter_map(Value::as_f64).collect();
    let most = values.iter().cloned().fold(0.0, f64::max);
    let columns = values.iter().fold(row().h(TALL).gap(2.0).items_end(), |line, v| {
        line.child(el().w(5.0).h(if most > 0.0 { ((v / most) as f32 * TALL).max(2.0) } else { 2.0 }).radius(1.0).fill(k.c.text_accent))
    });
    let mut out = col().key(cx.key()).w_full().gap(4.0);
    if let Some(label) = parts::text(prim, "label") { out = out.child(text(label.to_string()).font(k.ty.small).color(k.c.text_muted)) }
    out.child(columns)
}

fn framed(cx: &PrimCx, k: &Kit) -> El { col().key(cx.key()).w_full().padding(12.0).gap(8.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted) }

fn card(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let mut head = row().key(cx.sub("head")).w_full().gap(8.0).center_y().child(text(words(&prim["title"])).font(k.ty.ui_medium).color(k.c.text_base).wrap().grow(1.0));
    if prim["badge"].is_object() { head = head.child(Badge::new(words(&prim["badge"]["label"])).variant(if prim["badge"]["tone"] == "accent" { BadgeVariant::Accent } else { BadgeVariant::Subtle }).build(k)) }
    let mut out = framed(cx, k).child(pressable(head, prim, cx, k));
    if let Some(subtitle) = parts::text(prim, "subtitle") { out = out.child(text(subtitle.to_string()).font(k.ty.small).color(k.c.text_muted).wrap()) }
    children(prim, cx, k).into_iter().fold(out, El::child)
}

fn boxed(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let mut out = framed(cx, k);
    if let Some(title) = parts::text(prim, "title") { out = out.child(text(title.to_string()).font(k.ty.ui_medium).color(k.c.text_base).wrap()) }
    children(prim, cx, k).into_iter().fold(out, El::child)
}

fn stack(prim: &Value, cx: &PrimCx, k: &Kit) -> El { children(prim, cx, k).into_iter().fold(col().key(cx.key()).w_full().gap(8.0), El::child) }

fn beside(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    // The narrowest a child that fills may be, in characters: narrower, the row wraps it under the others.
    let least = prim["minWidth"].as_f64().unwrap_or(12.0) as f32 * CELL.0;
    list(prim, "children").iter().enumerate().fold(row().key(cx.key()).w_full().gap(8.0).center_y().flex_wrap(), |line, (n, child)| {
        let built = build(child, &cx.under(n), k);
        line.child(if find(parts::ty(child)).is_none_or(|prim| prim.fills) { built.min_w(least).grow(1.0) } else { built })
    })
}

fn band(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let (size, line) = match prim["level"].as_u64() { Some(1) => (26.0, 32.0), Some(3) => (16.0, 22.0), _ => (20.0, 26.0) };
    text(words(prim)).key(cx.key()).font(sized(k.ty.body_medium, size, line)).color(tone(prim, k)).wrap().selectable(true)
}

fn track(_: &Value, cx: &PrimCx, k: &Kit) -> El { el().key(cx.key()).w_full().h(1.0).fill(k.c.border_muted) }

/// A list: the list drawer's own (`tiles/list.rs`), so a view in a note, its links and the notes under it draw as
/// a list tile draws the same rows.
fn listed(prim: &Value, cx: &PrimCx, k: &Kit) -> El { super::list::on_page(prim, cx.tile, cx.key(), &cx.key, cx.in_row, k) }

/// A terminal row in points: a note gives a picture's height in rows, as the door reads it.
const ROW_POINTS: f32 = 20.0;
/// A header image's height when the note names none.
const HERO_POINTS: f32 = 220.0;

/// What stands where a picture will be, or would have been: its alt text and why it isn't drawn.
fn no_picture(shown: &Picture, why: &str, key: &str, k: &Kit) -> El {
    let name = shown.alt.clone().or_else(|| shown.path.clone()).unwrap_or_else(|| "picture".into());
    col().key(key.to_string()).w_full().padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted)
        .child(text(name).font(k.ty.ui).color(k.c.text_muted))
        .child(quiet(why, k))
}

/// A picture where it stands: at its own size up to the reading measure (`full`: the width there is), or the
/// height the note gives it. A header image (`band`) is a band, cropped to fill it (`contain`: shown whole).
fn picture(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let key = cx.key();
    let Some(shown) = Picture::of(prim) else { return no_picture(&Picture::default(), "it names no file and holds no drawing", &key, k) };
    let band = prim["band"] == true;
    let (image, points) = match cx.tile.app.picture(&shown) {
        Some(Shown::Ready { image, points }) => (image, *points),
        // A header that isn't there yet takes no room: the title doesn't jump when it comes.
        _ if band => return el().key(key),
        Some(Shown::Failed(why)) => return no_picture(&shown, why, &key, k),
        Some(Shown::Asked) | None => return no_picture(&shown, "on its way…", &key, k),
    };
    let Some([width, _]) = image.size() else {
        if band { return el().key(key) }
        return match image.error() { Some(e) => no_picture(&shown, &format!("{e:?}"), &key, k), None => no_picture(&shown, "decoding…", &key, k) };
    };
    if band {
        let fit = if shown.fit.as_deref() == Some("contain") { SurfaceFit::Fit } else { SurfaceFit::Fill };
        let drawn = el().key(key).role("image").label(shown.alt.clone().unwrap_or_else(|| "Header image".into())).w_full()
            .h(shown.height.map_or(HERO_POINTS, |rows| rows * ROW_POINTS)).radius(10.0).pixels_fit(image.pixels(), fit);
        return match shown.dim.filter(|dim| *dim > 0.0) {
            Some(dim) => drawn.child(el().w_full().h_full().radius(10.0).fill(k.alpha(k.c.black, dim.min(1.0)))),
            None => drawn,
        };
    }
    let mut drawn = el().key(key).role("image").label(shown.alt.clone().unwrap_or_else(|| "Picture".into())).w_full().radius(6.0);
    drawn = match shown.height {
        // The note says how tall: the picture is shown whole inside that band.
        Some(rows) => drawn.h(rows * ROW_POINTS).pixels_fit(image.pixels(), SurfaceFit::Fit),
        None => drawn.pixels(image.pixels()),
    };
    if shown.width != "full" && shown.height.is_none() { drawn = drawn.max_w(width as f32 / points) }
    let mut body = col().w_full().gap(4.0).child(drawn);
    // What's written on its line that isn't a layout value is said under it, as the door's caption does.
    for problem in &shown.problems { body = body.child(text(problem.clone()).font(k.ty.small).color(k.c.warning.fg).wrap()) }
    body
}

/// A part: the frame the service put around a view. Prose and a picture have none; a component has its name, its
/// title, its question or how fresh its answer is, what is wrong, its view, and what a press of it last did.
fn part(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let c = &k.c;
    let view = stood(&prim["view"], build(&prim["view"], &cx.view_of(prim), k));
    // Something attached to the part whole (a thread on a figure's own lines): a rule around it, in the mark's tint.
    let whole = parts::marks(prim).iter().any(|mark| mark.at.range.is_none());
    let view = if whole { col().key(cx.sub("marked")).w_full().padding(6.0).radius(k.radius.md).border(1.0, k.alpha(c.warning.icon, 0.55)).child(view) } else { view };
    let Some(name) = parts::text(prim, "name") else { return view.key(cx.frame()) };
    let mut head = row().w_full().gap(8.0).center_y().child(Badge::new(name).variant(BadgeVariant::Accent).build(k));
    if let Some(title) = parts::text(prim, "title") { head = head.child(text(title.to_string()).font(k.ty.ui_medium).color(c.text_base)) }
    head = head.child(el().grow(1.0));
    if let Some(q) = parts::text(prim, "query") {
        // The question it asks, opened in the bar on the source the service says takes one (`bar::questions`); with
        // none listed it is words.
        let shown = text(q.to_string()).font(k.ty.mono).color(c.text_muted).truncate();
        head = head.child(match crate::bar::questions(cx.tile.app) {
            Some(source) => k.interactive(shown).key(cx.sub("query")).help(format!("Open this in {}", source.about)).on_press(cx.tile.act(format!("bar.open scope={} query={}", word(&source.id), word(q)))),
            None => shown.key(cx.sub("query")),
        });
    } else if let Some(status) = parts::text(prim, "status") {
        head = head.child(text(status.to_string()).font(k.ty.small).color(c.text_faint));
    }
    let mut out = col().key(cx.frame()).w_full().padding(12.0).gap(6.0).radius(k.radius.md).fill(c.layer_01).border(1.0, c.border_muted).child(head);
    // The service's words on what is wrong, with whatever it could still answer under them.
    if let Some(e) = parts::text(prim, "error") { out = out.child(text(e.to_string()).key(cx.sub("error")).font(k.ty.small).color(c.danger.fg).wrap()) }
    out = out.child(view);
    if prim["truncated"] == true { out = out.child(quiet("More match than are shown: open the query for all of them.", k)) }
    // What a press here last did, said where it was pressed.
    if let Some(said) = cx.tile.ui.said.as_ref().filter(|said| Some(said.block.as_str()) == parts::text(prim, "block") && Some(said.line) == prim["line"].as_u64()) {
        out = out.child(text(said.words.clone()).key(cx.sub("said")).font(k.ty.small).color(if said.ok { c.text_muted } else { c.danger.fg }).wrap());
    }
    out
}
