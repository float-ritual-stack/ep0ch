//! The `list` drawer: one list, whatever it is of (`lists.read`). A tree, a question's matches, lanes, a note's
//! links and its properties, facets, the screens, who is here: the service says what the rows are and how they are
//! arranged, and this draws that. Nothing here knows a source, a kind or a property: a row's label, chips and act
//! line are the row's own, a table's columns the list's, and a pick runs the row's act line from this tile.
//!
//! - **Arranged by the list's own word** (`arrange`): `tree` (rows indented, a folder a press folds), `lanes` (a
//!   group a lane, side by side), `table` (a cell a column, a header that sorts by its property), else rows under
//!   their groups' headers. What the tile's spec or the person chose (`list.layout`) is asked of the service; the
//!   answer says what came.
//! - **Virtualised**: only the rows in view are built (`crate::list`), in a tree, in a table and in each lane.
//! - **Narrowed by chips**: the facets the listed notes carry and the chips on a row are presses that narrow the
//!   tile's question by that property (`facets.set`); what it is narrowed by is a chip that takes it back.
use std::borrow::Cow;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use rune::{El, Icon, ScrollSpec, col, el, row, text};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, ControlSize, Kit, glyphs};
use serde_json::{Value, json};

use super::prim::{self, PrimCx};
use super::{Drawer, TileCx};
use crate::actions::{App, word};
use crate::list::{self, Rows};
use crate::page::{ListAnswer, ListGroup, ListRow, ListView, Section};
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "list", about: "one list, whatever it is of: a tree, rows under their groups, a table or lanes, as the list says", notes: false, lists: true, asks, draw, facts, takes_keys: false, version, over: None };

static DOT: Icon = Icon { name: "ep0ch-dot", view: 16.0, body: r#"<circle cx="8" cy="8" r="1.6" fill="currentColor"/>"# };

/// A row's height: one line in a tree and a table, two where a row has its detail under it.
const LINE: f32 = 28.0;
const TWO: f32 = 44.0;
const HEAD: f32 = 26.0;
/// The room between a list tile's strip (its title, chips and column header) and the line its rows scroll under.
const HEAD_ROOM: f32 = 4.0;
/// The most facet values a list's header offers as chips; the rest are the facets list's own.
const FACETS: usize = 12;

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.list_ask(cx.id).map(|ask| ("list", ask)).into_iter().collect() }

fn facts(cx: &TileCx) -> Value {
    let answer = cx.app.list_of(cx.id);
    json!({
        "from": answer.map(|a| a.from.clone()), "arrange": answer.map(|a| a.list.arrange.clone()), "title": answer.and_then(|a| a.list.title.clone()),
        // (A row's own presses are its cells that carry an act line; what it shows under itself is said by its type.)
        "rows": answer.map(|a| a.list.rows.iter().map(|r| json!({ "id": r.id, "label": r.label, "detail": r.detail, "depth": r.depth, "group": r.group, "act": r.act, "folds": r.folds, "open": r.open, "cells": r.cells, "shows": r.view.as_ref().map(crate::parts::ty) })).collect::<Vec<_>>()),
        "groups": answer.map(|a| a.list.groups.iter().map(|g| json!({ "name": g.name, "label": g.label, "count": g.count })).collect::<Vec<_>>()),
        "columns": answer.map(|a| a.list.columns.clone()), "facets": answer.map(|a| a.facets.iter().map(|f| f.key.clone()).collect::<Vec<_>>()),
        "hint": answer.and_then(|a| a.hint.clone()), "truncated": answer.is_some_and(|a| a.truncated), "sort": answer.and_then(|a| a.sort.clone()), "group": answer.and_then(|a| a.group.clone()),
        "question": cx.app.question_of(cx.id), "narrowed": cx.ui.narrowed, "chosen": cx.ui.chosen, "unfolded": cx.ui.unfolded,
        "follows": cx.app.source_of(cx.id).map(|source| cx.app.layout.name(&source)), "selected": cx.app.home_note(cx.id),
    })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.unfolded, &cx.ui.narrowed, &cx.ui.chosen, cx.app.home_note(cx.id), cx.app.question_of(cx.id)).hash(&mut h);
    h.finish()
}

/// Where a list is drawn, and what a press in it runs there. One list, two places: a list tile (its own answer,
/// `lists.read`) and a part of a page (a `list` primitive of a note: a view, its links, the notes under it). The
/// rows, their sections and their headers are drawn by the same functions in both; what differs is said here once.
#[derive(Clone)]
pub struct Place {
    /// The tile it is drawn in.
    tile: String,
    /// What its elements are keyed under, in that tile: nothing in a list tile (`row/<id>`, `group/<name>`), a
    /// part's own key on a page (`part/3/<id>`, `part/3/group/<name>`).
    under: String,
    /// It is a part of a page: a press runs the row's own act line from the tile, and a chip asks the bar.
    page: bool,
}

impl Place {
    /// A list tile's own list.
    fn tile(cx: &TileCx) -> Place { Place { tile: cx.id.to_string(), under: String::new(), page: false } }
    /// A `list` primitive on a page, keyed under `under` in the page's tile.
    fn page(cx: &TileCx, under: &str) -> Place { Place { tile: cx.id.to_string(), under: format!("{under}/"), page: true } }
    fn key(&self, cx: &TileCx, part: impl AsRef<str>) -> String { cx.key(format!("{}{}", self.under, part.as_ref())) }
    /// A row's element: what a test, a script and an agent press it by.
    fn row_key(&self, cx: &TileCx, id: &str) -> String { if self.page { self.key(cx, id) } else { self.key(cx, format!("row/{id}")) } }
    /// What a press on a row runs. In a list tile, the tile's pick of it (`list.pick`, which runs the row's own act
    /// line, folds a folder's row that is already open, and opens or folds a row that only folds); on a page, the
    /// row's own act line, from the page's tile. A row with no act line that folds nothing is words.
    fn pick(&self, cx: &TileCx, r: &ListRow) -> Option<impl Fn(&mut App) + Clone + 'static> {
        let line = match (&r.act, self.page) {
            (Some(act), true) => act.clone(),
            (Some(_), false) => format!("list.pick id={}", word(&r.id)),
            (None, false) if r.folds && self.unfolds(cx) => format!("list.pick id={}", word(&r.id)),
            (None, _) => return None,
        };
        Some(cx.act(line))
    }
    /// What a press on a chip (a property and one of its values) runs: a list tile's question is narrowed by it
    /// (`facets.set`); on a page it is a question of its own, in the bar (`bar.narrow`, as the page's own chips are).
    fn chip(&self, cx: &TileCx, key: &str, value: &str) -> impl Fn(&mut App) + Clone + 'static {
        cx.act(format!("{} key={} value={}", if self.page { "bar.narrow" } else { "facets.set" }, word(key), word(value)))
    }
    fn narrowed(&self, cx: &TileCx, key: &str, value: &str) -> bool { !self.page && cx.ui.narrowed.iter().any(|(k, v)| k == key && v == value) }
    /// Its rows open: a list tile whose source says it reads which are (a tree's folders, a revision's change).
    fn unfolds(&self, cx: &TileCx) -> bool { !self.page && cx.app.unfolds(cx.id) }
}

/// A chip that narrows by a property and one of its values.
fn chip(cx: &TileCx, at: &Place, key: &str, value: &str, said: String, on: bool, part: &str, k: &Kit) -> El {
    k.interactive(Badge::new(said).variant(if on { BadgeVariant::Accent } else { BadgeVariant::Subtle }).build(k))
        .key(at.key(cx, format!("{part}/{key}/{value}")))
        .help(if on { format!("Stop narrowing by {key}={value}") } else { format!("Only the notes with {key}={value}") })
        .on_press(at.chip(cx, key, value))
}

/// One row: its mark and label, the properties it carries as chips, and its detail under it (or beside it, in a
/// tree). A cell that carries an act line is a press of its own on the row (the service's word on what it runs), and
/// what the row shows under itself (`view`) is a primitive, built by the registry as any is: a change, a thread's
/// replies, an example. A row that folds, in a list whose rows open, shows which way it is.
fn row_el(cx: &TileCx, at: &Place, r: &ListRow, tree: bool, selected: bool, k: &Kit) -> El {
    let c = &k.c;
    let tall = r.tall();
    let label = text(r.label.clone()).font(k.ty.ui).color(if r.act.is_some() || tall { c.text_base } else { c.text_muted }).truncate().grow(1.0).min_w(0.0);
    let mut line = row().w_full().gap(6.0).center_y();
    // The fold's mark is the row's own word (`folds`, the service's: in a list of notes, that a note is under it), so
    // a mark drawn always opens onto something; a row that folds nothing has a dot in a tree, and nothing elsewhere.
    let fold = || rune::icon(if r.open { &glyphs::TRIANGLE_DOWN } else { &glyphs::TRIANGLE_RIGHT }, 14.0).color(c.text_faint).key(format!("{}/fold", at.row_key(cx, &r.id)));
    if tree {
        line = line.child(el().w(r.depth.min(12) as f32 * 14.0)).child(if r.folds { fold() } else { rune::icon(&DOT, 14.0).color(c.text_faint) });
    } else if r.folds && at.unfolds(cx) {
        line = line.child(fold());
    }
    if let Some(mark) = &r.mark { line = line.child(text(mark.clone()).font(k.ty.small).color(c.text_faint)) }
    line = line.child(label);
    // A list with no columns of its own shows a row's cells after its label: words, or a press of its own.
    for (n, cell) in r.cells.iter().enumerate() {
        let words = ListRow::cell(cell);
        if words.is_empty() { continue }
        line = line.child(match ListRow::cell_act(cell) {
            Some(act) => Button::new(words).variant(ButtonVariant::Outline).control_size(ControlSize::Small).on_press(cx.act(act)).build(k).key(format!("{}/press/{n}", at.row_key(cx, &r.id))),
            None => Badge::new(words).variant(BadgeVariant::Subtle).build(k),
        });
    }
    for chip_ in r.chips.iter().take(3) { line = line.child(chip(cx, at, &chip_.key, &chip_.value, chip_.value.clone(), at.narrowed(cx, &chip_.key, &chip_.value), &format!("row/{}/chip", r.id), k)) }
    let detail = r.detail.as_deref().filter(|d| !d.is_empty() && !tree).map(|detail| { let said = text(detail.to_string()).font(k.ty.small).color(c.text_faint); if tall { said.wrap() } else { said.truncate() } });
    let head = match detail { Some(detail) => col().w_full().gap(1.0).child(line).child(detail), None => line };
    let fill = if selected { c.surface_hover } else if r.tone.is_some() { c.layer_02 } else { rune::Color::TRANSPARENT };
    let head = head.px(8.0).py(if tree { 0.0 } else { 4.0 }).radius(k.radius.sm).fill(fill);
    let head = match at.pick(cx, r) {
        Some(run) => k.interactive(head).role(if tree { "treeitem" } else { "option" }).focusable(at.page).on_press(run),
        None => head,
    };
    if !tall { return head.h(height(r, tree)).key(at.row_key(cx, &r.id)) }
    // (Its line is keyed by itself under the row: what a press on the row means once something is drawn under it.)
    let mut whole = col().w_full().gap(4.0).pb(6.0).key(at.row_key(cx, &r.id)).child(head.key(format!("{}/head", at.row_key(cx, &r.id))));
    if let Some(view) = &r.view { whole = whole.child(el().w_full().px(8.0).child(prim::build(view, &PrimCx::of(cx).at(format!("{}row/{}/view", at.under, r.id)).in_row(), k))) }
    whole
}

fn height(r: &ListRow, tree: bool) -> f32 { if tree || r.detail.as_deref().is_none_or(str::is_empty) { LINE } else { TWO } }

/// A table's row: a cell a column, the first its label when the list gives no cell for it.
fn table_row(cx: &TileCx, at: &Place, r: &ListRow, columns: usize, selected: bool, k: &Kit) -> El {
    let c = &k.c;
    let mut line = row().w_full().h(LINE).gap(8.0).center_y().px(8.0).radius(k.radius.sm).fill(if selected { c.surface_hover } else { rune::Color::TRANSPARENT }).key(at.row_key(cx, &r.id));
    for i in 0..columns.max(1) {
        let words = r.cells.get(i).map(ListRow::cell).unwrap_or_else(|| if i == 0 { r.label.clone() } else { String::new() });
        line = line.child(text(words).font(k.ty.ui).color(if i == 0 { c.text_base } else { c.text_muted }).truncate().grow(1.0).min_w(0.0));
    }
    match at.pick(cx, r) {
        Some(run) => k.interactive(line).role("row").focusable(at.page).on_press(run),
        None => line,
    }
}

/// A group's header: its name and, when the list counted it, how many it holds.
fn head_el(cx: &TileCx, at: &Place, g: &ListGroup, k: &Kit) -> El {
    let said = match &g.glyph { Some(glyph) => format!("{glyph} {}", g.label), None => g.label.clone() };
    let mut line = row().w_full().h(HEAD).gap(6.0).center_y().px(8.0).key(at.key(cx, format!("group/{}", g.name)))
        .child(text(said.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint).truncate());
    if g.counted { line = line.child(text(g.count.to_string()).font(k.ty.small).color(k.c.text_faint)) }
    // What a group with nothing in it says of itself.
    if let Some(note) = &g.note { line = line.child(text(note.clone()).font(k.ty.small).color(k.c.text_faint).truncate()) }
    line
}

/// What a list draws, in order: a group's header, or a row by its place among the list's rows.
#[derive(Clone)]
enum Item { Head(ListGroup), Row(usize) }

fn items(sections: &[Section]) -> Vec<Item> {
    sections.iter().flat_map(|section| section.head.iter().cloned().map(Item::Head).chain(section.rows.iter().copied().map(Item::Row)).collect::<Vec<_>>()).collect()
}

/// Rows in view only, built by their place: a tree's, a table's, a lane's and plain rows alike, in a tile and on a page.
fn listed(cx: &TileCx, at: &Place, view: &Rc<ListView>, items: Vec<Item>, k: &Kit) -> Listed {
    let tree = view.arrange == TREE;
    let table = view.arrange == TABLE;
    let columns = view.columns.len();
    let selected = if at.page { None } else { cx.app.home_note(cx.id) };
    let (items, keyed, kit) = (Rc::new(items), view.clone(), k.clone());
    let (held, built, name) = (items.clone(), view.clone(), cx.name.clone());
    let (keys, place) = (at.clone(), at.clone());
    let estimate = if tree || table { LINE } else { TWO };
    let count = items.len();
    let key: Box<dyn for<'a> Fn(&'a App, usize) -> Cow<'a, str>> = Box::new(move |_: &App, i: usize| Cow::Owned(match &items[i] {
        Item::Head(g) => format!("tile/{name}/{}group/{}", keys.under, g.name),
        Item::Row(at) => if keys.page { format!("tile/{name}/{}{}", keys.under, keyed.rows[*at].id) } else { format!("tile/{name}/row/{}", keyed.rows[*at].id) },
    }));
    let build: Box<dyn Fn(&App, usize) -> El> = Box::new(move |s: &App, i: usize| {
        // The row is drawn from the tile as it stands now: a tile closed since draws nothing.
        let Some(cx) = s.cx(&place.tile) else { return el() };
        match &held[i] {
            Item::Head(g) => head_el(&cx, &place, g, &kit),
            Item::Row(n) => {
                let r = &built.rows[*n];
                let lit = selected.as_deref() == Some(r.id.as_str());
                if table { table_row(&cx, &place, r, columns, lit, &kit) } else { row_el(&cx, &place, r, tree, lit, &kit) }
            }
        }
    });
    Rows::new(count, estimate, key, build)
}

/// A list's rows as the one virtual list takes them: a key and a builder a row.
type Listed = Rows<Box<dyn for<'a> Fn(&'a App, usize) -> Cow<'a, str>>, Box<dyn Fn(&App, usize) -> El>>;

/// A list's arrangements, as the list says them (outline-core's `ListPrimitive.arrange`): any other word is rows.
const TREE: &str = "tree";
const TABLE: &str = "table";
const LANES: &str = "lanes";

/// A table's header: a column a property. In a list tile a press sorts by it (`list.sort`); on a page it is words.
fn columns_el(cx: &TileCx, at: &Place, view: &ListView, sort: Option<&str>, k: &Kit) -> Option<El> {
    if view.arrange != TABLE || view.headers.is_empty() { return None }
    let c = &k.c;
    // (Inset as the rows under it are, so a header sits over its column.)
    let mut heads = row().key(at.key(cx, "columns")).w_full().h(HEAD).gap(8.0).center_y().px(4.0);
    for (i, head) in view.headers.iter().enumerate() {
        let column = view.columns.get(i).unwrap_or(head);
        // What it is sorted by is the answer's own word: `<property>[ asc|desc]`, as it was asked.
        let (by, order) = sort.map(|sort| sort.split_once(' ').unwrap_or((sort, ""))).unwrap_or(("", ""));
        let (sorted, down) = (by == column.as_str(), order.trim() == "desc");
        let said = text(format!("{}{}", head.to_uppercase(), if !sorted { "" } else if down { " ↓" } else { " ↑" })).font(k.ty.text_xsmall_medium).color(if sorted { c.text_base } else { c.text_faint }).truncate().grow(1.0).min_w(0.0);
        heads = heads.child(if at.page { said } else {
            let next = if sorted && !down { "desc" } else { "asc" };
            k.interactive(said).key(at.key(cx, format!("column/{column}"))).help(format!("Sort by {column}")).on_press(cx.act(format!("list.sort by={} order={next}", word(column))))
        });
    }
    Some(heads)
}

/// Lanes: a group a lane, side by side. `scrolled` gives a lane's rows their scroll (the whole lane's height in a
/// tile, a few rows on a page).
fn lanes_el(cx: &TileCx, at: &Place, view: &Rc<ListView>, sections: &[Section], scrolled: &dyn Fn(String, Listed) -> El, k: &Kit) -> El {
    let mut lanes = row().key(at.key(cx, "lanes")).w_full().min_h(0.0).gap(6.0).padding(6.0);
    for section in sections {
        let group = section.head.clone().unwrap_or_else(|| ListGroup { name: String::new(), label: "ungrouped".into(), count: section.rows.len() as u64, counted: true, ..ListGroup::default() });
        let rows = listed(cx, at, view, section.rows.iter().copied().map(Item::Row).collect(), k);
        lanes = lanes.child(col().key(at.key(cx, format!("lane/{}", group.name))).role("group").label(group.label.clone()).grow(1.0).min_w(0.0).min_h(0.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted)
            .child(head_el(cx, at, &group, k))
            .child(scrolled(format!("lane/{}", group.name), rows)));
    }
    lanes
}

/// A `list` primitive on a page (a view in a note, its links, the notes under it), drawn by the list drawer: the
/// same sections, headers and rows a list tile draws, built only where they are in view of the page's scroll. A
/// pick runs the row's own act line from the page's tile. `key`: the element the list is; `under`: what its rows
/// are keyed under. `in_row`: it is under a row of another list (an example drawn in the library), where its rows
/// are built whole, the first few of them: rows built only in view can't hold a list built only in view.
pub fn on_page(prim: &Value, cx: &TileCx, key: String, under: &str, in_row: bool, k: &Kit) -> El {
    let view: ListView = serde::Deserialize::deserialize(prim).unwrap_or_default();
    let (at, view) = (Place::page(cx, under), Rc::new(view));
    let mut out = col().key(key).w_full().gap(2.0);
    if let Some(title) = &view.title { out = out.child(text(title.to_uppercase()).key(at.key(cx, "title")).font(k.ty.text_xsmall_medium).color(k.c.text_faint)) }
    if view.rows.is_empty() && view.groups.is_empty() { return out.child(said_el(at.key(cx, "empty"), view.empty.as_deref().unwrap_or("Nothing here yet."), k)) }
    if let Some(heads) = columns_el(cx, &at, &view, None, k) { out = out.child(heads) }
    else if !view.headers.is_empty() { out = out.child(text(view.headers.join(" · ")).font(k.ty.text_xsmall_medium).color(k.c.text_faint).px(8.0)) }
    let sections = view.sections();
    if view.arrange == LANES {
        // A page has no height of its own to give a lane: each shows a few rows and scrolls the rest.
        let kit = k.clone();
        let (place, name) = (at.clone(), cx.name.clone());
        let app = cx.app;
        return out.child(lanes_el(cx, &at, &view, &sections, &move |part, rows| { let key = format!("tile/{name}/{}{part}/rows", place.under); if in_row { list::whole(key, app, PAGE_LANE, &kit, rows) } else { list::bounded(&key, PAGE_LANE, &kit, rows) } }, k));
    }
    // One section with one declared group needs no header of its own: the part's frame names it.
    let plain = sections.len() == 1 && view.groups.len() == 1 && !sections[0].rows.is_empty();
    let drawn = if plain { sections[0].rows.iter().copied().map(Item::Row).collect() } else { items(&sections) };
    let rows = listed(cx, &at, &view, drawn, k);
    out.child(if in_row { list::whole(at.key(cx, "rows"), cx.app, IN_ROW, k, rows) } else { list::rows(at.key(cx, "rows"), rows) })
}

/// The most rows of a list drawn under a row of another list.
const IN_ROW: usize = 24;

/// The most rows a lane shows on a page before it scrolls.
const PAGE_LANE: usize = 8;

/// The strip over a list tile: what the service says of its question, what it is narrowed by, and the facets to narrow by.
fn header(cx: &TileCx, at: &Place, answer: &ListAnswer, k: &Kit) -> Option<El> {
    let c = &k.c;
    let mut strip = col().key(cx.key("head")).w_full().px(8.0).pt(6.0).gap(4.0);
    let mut any = false;
    if let Some(title) = &answer.list.title { strip = strip.child(text(title.to_uppercase()).key(cx.key("title")).font(k.ty.text_xsmall_medium).color(c.text_faint).truncate()); any = true }
    if let Some(hint) = answer.hint.as_ref().filter(|hint| !hint.is_empty()) { strip = strip.child(text(hint.clone()).key(cx.key("hint")).font(k.ty.small).color(c.warning.fg).wrap()); any = true }
    if answer.truncated { strip = strip.child(text(match answer.total { Some(total) => format!("The first {} of {total}.", answer.list.rows.len()), None => format!("The first {}: there are more.", answer.list.rows.len()) }).key(cx.key("more")).font(k.ty.small).color(c.text_faint)); any = true }
    let narrowed = &cx.ui.narrowed;
    let mut chips = row().key(cx.key("chips")).w_full().gap(6.0).flex_wrap();
    let mut shown = 0;
    // What it is narrowed by first: each a chip that takes it back.
    for (key, value) in narrowed { chips = chips.child(chip(cx, at, key, value, format!("{key}={value} ×"), true, "narrowed", k)); shown += 1 }
    for facet in &answer.facets {
        for value in &facet.values {
            if shown >= FACETS + narrowed.len() || at.narrowed(cx, &facet.key, &value.value) { continue }
            chips = chips.child(chip(cx, at, &facet.key, &value.value, format!("{}={} · {}", facet.key, value.value, value.count), false, "facet", k));
            shown += 1;
        }
    }
    if shown > 0 { strip = strip.child(chips); any = true }
    if let Some(heads) = columns_el(cx, at, &answer.list, answer.sort.as_deref(), k) { strip = strip.child(heads); any = true }
    any.then_some(strip)
}

fn said_el(key: String, words: &str, k: &Kit) -> El { col().key(key).w_full().padding(12.0).child(text(words.to_string()).font(k.ty.small).color(k.c.text_faint).wrap()) }

fn said(cx: &TileCx, words: &str, k: &Kit) -> El { said_el(cx.key("empty"), words, k) }

fn scroll(cx: &TileCx, part: &str, body: El, k: &Kit) -> El { k.scroll_bar(col().key(cx.key(part)).w_full().h_full().min_h(0.0).padding(4.0).scroll(ScrollSpec { stick_bottom: false }).child(body)) }

fn draw(cx: &TileCx, k: &Kit) -> El {
    let ask = cx.app.list_ask(cx.id);
    // Why there is no list: the service's own words when it refused, else what the tile is waiting for.
    if let Some(refusal) = ask.as_ref().and_then(|ask| cx.store().refusal(ask)) { return col().key(cx.key("refused")).w_full().padding(12.0).child(text(refusal.error.clone()).font(k.ty.small).color(k.c.warning.fg).wrap()) }
    let Some(answer) = cx.app.list_of(cx.id) else {
        // A list about the note another tile shows has nothing to ask while no note is open there: it says what it
        // is, in its kind's own words, as an empty reader does.
        if ask.is_none() && cx.app.waits_for_a_note(cx.id) && cx.app.subject_of(cx.id).is_none() { return super::waiting(cx, None, k) }
        return said(cx, if cx.app.online { "Calling the outline…" } else { "Offline: nothing is listed." }, k);
    };
    let at = Place::tile(cx);
    let view = Rc::new(answer.list.clone());
    let mut body = col().w_full().h_full().min_h(0.0);
    // The strip stays where it is while the rows scroll: a line and a little room under it say where they go, so a
    // row passing a table's column header is seen to leave and never read as words under the header's own.
    if let Some(head) = header(cx, &at, answer, k) { body = body.child(head.pb(HEAD_ROOM)).child(el().key(cx.key("head/edge")).w_full().h(1.0).fill(k.c.border_muted)) }
    if view.rows.is_empty() {
        return body.child(said(cx, view.empty.as_deref().unwrap_or("Nothing is listed."), k));
    }
    let sections = view.sections();
    if view.arrange == LANES {
        // A lane a group, side by side: each scrolls by itself and builds only its rows in view.
        let kit = k.clone();
        let name = cx.name.clone();
        let scrolled = move |part: String, rows: Listed| {
            el().w_full().grow(1.0).min_h(0.0).child(kit.scroll_bar(col().key(format!("tile/{name}/{part}/scroll")).w_full().h_full().min_h(0.0).padding(4.0).scroll(ScrollSpec { stick_bottom: false }).child(list::rows(format!("tile/{name}/{part}/rows"), rows))))
        };
        return body.child(lanes_el(cx, &at, &view, &sections, &scrolled, k).grow(1.0).h_full());
    }
    let rows = list::rows(cx.key("rows"), listed(cx, &at, &view, items(&sections), k));
    body.child(el().w_full().grow(1.0).min_h(0.0).child(scroll(cx, "scroll", rows, k)))
}
