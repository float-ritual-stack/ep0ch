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
use rune_kit::{Badge, BadgeVariant, Kit, glyphs};
use serde_json::{Value, json};

use super::{Drawer, TileCx};
use crate::actions::{Actor, App, word};
use crate::list::{self, Rows};
use crate::page::{ListAnswer, ListGroup, ListRow, Section};
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "list", about: "one list, whatever it is of: a tree, rows under their groups, a table or lanes, as the list says", notes: false, lists: true, asks, draw, facts, takes_keys: false, version };

static DOT: Icon = Icon { name: "ep0ch-dot", view: 16.0, body: r#"<circle cx="8" cy="8" r="1.6" fill="currentColor"/>"# };

/// A row's height: one line in a tree and a table, two where a row has its detail under it.
const LINE: f32 = 28.0;
const TWO: f32 = 44.0;
const HEAD: f32 = 26.0;
/// The most facet values a list's header offers as chips; the rest are the facets list's own.
const FACETS: usize = 12;

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.list_ask(cx.id).map(|ask| ("list", ask)).into_iter().collect() }

fn facts(cx: &TileCx) -> Value {
    let answer = cx.app.list_of(cx.id);
    json!({
        "from": answer.map(|a| a.from.clone()), "arrange": answer.map(|a| a.list.arrange.clone()), "title": answer.and_then(|a| a.list.title.clone()),
        "rows": answer.map(|a| a.list.rows.iter().map(|r| json!({ "id": r.id, "label": r.label, "detail": r.detail, "depth": r.depth, "group": r.group, "act": r.act, "open": r.open })).collect::<Vec<_>>()),
        "groups": answer.map(|a| a.list.groups.iter().map(|g| json!({ "name": g.name, "label": g.label, "count": g.count })).collect::<Vec<_>>()),
        "columns": answer.map(|a| a.list.columns.clone()), "facets": answer.map(|a| a.facets.iter().map(|f| f.key.clone()).collect::<Vec<_>>()),
        "hint": answer.and_then(|a| a.hint.clone()), "truncated": answer.is_some_and(|a| a.truncated), "sort": answer.and_then(|a| a.sort.clone()), "group": answer.and_then(|a| a.group.clone()),
        "question": cx.app.question_of(cx.id), "narrowed": cx.ui.narrowed, "chosen": cx.ui.chosen, "unfolded": cx.ui.unfolded,
        "follows": cx.app.source_of(cx.id).map(|source| cx.app.layout.name(&source)), "selected": cx.app.selected_in(cx.id),
    })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.unfolded, &cx.ui.narrowed, &cx.ui.chosen, cx.app.selected_in(cx.id), cx.app.question_of(cx.id)).hash(&mut h);
    h.finish()
}

/// What a press on a row runs: in a tree the tree's own pick (which folds the open note's row), else the row's act line.
fn pick(cx: &TileCx, tree: bool, r: &ListRow) -> Option<impl Fn(&mut App) + Clone + 'static> {
    r.act.as_ref()?;
    let line = cx.line(if tree { format!("tree.pick id={}", word(&r.id)) } else { format!("list.pick id={}", word(&r.id)) });
    Some(move |s: &mut App| { s.act(&line, Actor::Person); })
}

/// A chip that narrows this tile's question by a property and one of its values.
fn chip(cx: &TileCx, key: &str, value: &str, said: String, on: bool, part: &str, k: &Kit) -> El {
    k.interactive(Badge::new(said).variant(if on { BadgeVariant::Accent } else { BadgeVariant::Subtle }).build(k))
        .key(cx.key(format!("{part}/{key}/{value}")))
        .help(if on { format!("Stop narrowing by {key}={value}") } else { format!("Only the notes with {key}={value}") })
        .on_press(cx.act(format!("facets.set key={} value={}", word(key), word(value))))
}

/// One row: its mark and label, the properties it carries as chips, and its detail under it (or beside it, in a tree).
fn row_el(cx: &TileCx, r: &ListRow, tree: bool, selected: bool, k: &Kit) -> El {
    let c = &k.c;
    let label = text(r.label.clone()).font(k.ty.ui).color(if r.act.is_some() { c.text_base } else { c.text_muted }).truncate().grow(1.0).min_w(0.0);
    let mut line = row().w_full().gap(6.0).center_y();
    if tree {
        let icon = if !r.folds { &DOT } else if r.open { &glyphs::TRIANGLE_DOWN } else { &glyphs::TRIANGLE_RIGHT };
        line = line.child(el().w(r.depth.min(12) as f32 * 14.0)).child(rune::icon(icon, 14.0).color(c.text_faint));
    }
    if let Some(mark) = &r.mark { line = line.child(text(mark.clone()).font(k.ty.small).color(c.text_faint)) }
    line = line.child(label);
    for chip_ in r.chips.iter().take(3) { line = line.child(chip(cx, &chip_.key, &chip_.value, chip_.value.clone(), cx.ui.narrowed.iter().any(|(key, value)| *key == chip_.key && *value == chip_.value), &format!("row/{}/chip", r.id), k)) }
    let body = match r.detail.as_deref().filter(|d| !d.is_empty() && !tree) {
        Some(detail) => col().w_full().gap(1.0).child(line).child(text(detail.to_string()).font(k.ty.small).color(c.text_faint).truncate()),
        None => line,
    };
    let fill = if selected { c.surface_hover } else if r.tone.is_some() { c.layer_02 } else { rune::Color::TRANSPARENT };
    let shaped = body.px(8.0).py(if tree { 0.0 } else { 4.0 }).h(height(r, tree)).radius(k.radius.sm).fill(fill).key(cx.key(format!("row/{}", r.id)));
    match pick(cx, tree, r) {
        Some(run) => k.interactive(shaped).role(if tree { "treeitem" } else { "option" }).on_press(run),
        None => shaped,
    }
}

fn height(r: &ListRow, tree: bool) -> f32 { if tree || r.detail.as_deref().is_none_or(str::is_empty) { LINE } else { TWO } }

/// A table's row: a cell a column, the first its label when the list gives no cell for it.
fn table_row(cx: &TileCx, r: &ListRow, columns: usize, selected: bool, k: &Kit) -> El {
    let c = &k.c;
    let mut line = row().w_full().h(LINE).gap(8.0).center_y().px(8.0).radius(k.radius.sm).fill(if selected { c.surface_hover } else { rune::Color::TRANSPARENT }).key(cx.key(format!("row/{}", r.id)));
    for i in 0..columns.max(1) {
        let words = r.cells.get(i).map(ListRow::cell).unwrap_or_else(|| if i == 0 { r.label.clone() } else { String::new() });
        line = line.child(text(words).font(k.ty.ui).color(if i == 0 { c.text_base } else { c.text_muted }).truncate().grow(1.0).min_w(0.0));
    }
    match pick(cx, false, r) {
        Some(run) => k.interactive(line).role("row").on_press(run),
        None => line,
    }
}

/// A group's header: its name and how many it holds.
fn head_el(cx: &TileCx, g: &ListGroup, k: &Kit) -> El {
    let said = match &g.glyph { Some(glyph) => format!("{glyph} {}", g.label), None => g.label.clone() };
    let mut line = row().w_full().h(HEAD).gap(6.0).center_y().px(8.0).key(cx.key(format!("group/{}", g.name)))
        .child(text(said.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint).truncate())
        .child(text(g.count.to_string()).font(k.ty.small).color(k.c.text_faint));
    if let Some(note) = &g.note { line = line.child(text(note.clone()).font(k.ty.small).color(k.c.text_faint).truncate()) }
    line
}

/// What a list draws, in order: a group's header, or a row by its place among the list's rows.
#[derive(Clone)]
enum Item { Head(ListGroup), Row(usize) }

fn items(sections: &[Section]) -> Vec<Item> {
    sections.iter().flat_map(|section| section.head.iter().cloned().map(Item::Head).chain(section.rows.iter().copied().map(Item::Row)).collect::<Vec<_>>()).collect()
}

/// Rows in view only, built by their place: a tree's, a table's, a lane's and plain rows alike.
fn listed(cx: &TileCx, key: String, answer: &Rc<ListAnswer>, items: Vec<Item>, k: &Kit) -> El {
    let tree = answer.list.arrange == "tree";
    let table = answer.list.arrange == "table";
    let columns = answer.list.columns.len();
    let selected = cx.app.selected_in(cx.id);
    let (items, keyed, kit) = (Rc::new(items), answer.clone(), k.clone());
    let (held, built, tile, name) = (items.clone(), answer.clone(), cx.id.to_string(), cx.name.clone());
    let estimate = if tree || table { LINE } else { TWO };
    list::rows(key, Rows::new(items.len(), estimate, move |_: &App, i: usize| Cow::Owned(match &items[i] { Item::Head(g) => format!("tile/{name}/group/{}", g.name), Item::Row(at) => format!("tile/{name}/row/{}", keyed.list.rows[*at].id) }), move |s: &App, i: usize| {
        // The row is drawn from the tile as it stands now: a tile closed since draws nothing.
        let Some(cx) = s.cx(&tile) else { return el() };
        match &held[i] {
            Item::Head(g) => head_el(&cx, g, &kit),
            Item::Row(at) => {
                let r = &built.list.rows[*at];
                let lit = selected.as_deref() == Some(r.id.as_str());
                if table { table_row(&cx, r, columns, lit, &kit) } else { row_el(&cx, r, tree, lit, &kit) }
            }
        }
    }))
}

/// The strip over a list: what the service says of its question, what it is narrowed by, and the facets to narrow by.
fn header(cx: &TileCx, answer: &ListAnswer, k: &Kit) -> Option<El> {
    let c = &k.c;
    let mut strip = col().key(cx.key("head")).w_full().px(8.0).pt(6.0).gap(4.0);
    let mut any = false;
    if let Some(title) = &answer.list.title { strip = strip.child(text(title.to_uppercase()).key(cx.key("title")).font(k.ty.text_xsmall_medium).color(c.text_faint).truncate()); any = true }
    if let Some(hint) = answer.hint.as_ref().filter(|hint| !hint.is_empty()) { strip = strip.child(text(hint.clone()).key(cx.key("hint")).font(k.ty.small).color(c.warning.fg).wrap()); any = true }
    if answer.truncated { strip = strip.child(text(match answer.total { Some(total) => format!("The first {} of {total}.", answer.list.rows.len()), None => format!("The first {}: there are more.", answer.list.rows.len()) }).key(cx.key("more")).font(k.ty.small).color(c.text_faint)); any = true }
    let narrowed = &cx.ui.narrowed;
    let on = |key: &str, value: &str| narrowed.iter().any(|(k_, v)| k_ == key && v == value);
    let mut chips = row().key(cx.key("chips")).w_full().gap(6.0).flex_wrap();
    let mut shown = 0;
    // What it is narrowed by first: each a chip that takes it back.
    for (key, value) in narrowed { chips = chips.child(chip(cx, key, value, format!("{key}={value} ×"), true, "narrowed", k)); shown += 1 }
    for facet in &answer.facets {
        for value in &facet.values {
            if shown >= FACETS + narrowed.len() || on(&facet.key, &value.value) { continue }
            chips = chips.child(chip(cx, &facet.key, &value.value, format!("{}={} · {}", facet.key, value.value, value.count), false, "facet", k));
            shown += 1;
        }
    }
    if shown > 0 { strip = strip.child(chips); any = true }
    // A table's header: a column a property, a press sorts by it.
    if answer.list.arrange == "table" && !answer.list.headers.is_empty() {
        // (Inset as the rows under it are, so a header sits over its column.)
        let mut heads = row().key(cx.key("columns")).w_full().h(HEAD).gap(8.0).center_y().px(4.0);
        for (i, head) in answer.list.headers.iter().enumerate() {
            let column = answer.list.columns.get(i).unwrap_or(head);
            let sorted = answer.sort.as_deref().is_some_and(|sort| sort.split_whitespace().next() == Some(column.as_str()));
            let down = answer.sort.as_deref().is_some_and(|sort| sort.ends_with(" desc"));
            let next = if sorted && !down { "desc" } else { "asc" };
            heads = heads.child(k.interactive(text(format!("{}{}", head.to_uppercase(), if !sorted { "" } else if down { " ↓" } else { " ↑" })).font(k.ty.text_xsmall_medium).color(if sorted { c.text_base } else { c.text_faint }).truncate().grow(1.0).min_w(0.0))
                .key(cx.key(format!("column/{column}"))).help(format!("Sort by {column}")).on_press(cx.act(format!("list.sort by={} order={next}", word(column)))));
        }
        strip = strip.child(heads);
        any = true;
    }
    any.then_some(strip)
}

fn said(cx: &TileCx, words: &str, k: &Kit) -> El { col().key(cx.key("empty")).w_full().padding(12.0).child(text(words.to_string()).font(k.ty.small).color(k.c.text_faint).wrap()) }

fn scroll(cx: &TileCx, part: &str, body: El, k: &Kit) -> El { k.scroll_bar(col().key(cx.key(part)).w_full().h_full().min_h(0.0).padding(4.0).scroll(ScrollSpec { stick_bottom: false }).child(body)) }

fn draw(cx: &TileCx, k: &Kit) -> El {
    let ask = cx.app.list_ask(cx.id);
    // Why there is no list: the service's own words when it refused, else what the tile is waiting for.
    if let Some(refusal) = ask.as_ref().and_then(|ask| cx.store().refusal(ask)) { return col().key(cx.key("refused")).w_full().padding(12.0).child(text(refusal.error.clone()).font(k.ty.small).color(k.c.warning.fg).wrap()) }
    let Some(answer) = cx.app.list_of(cx.id) else {
        // A list about the note another tile shows has nothing to ask while no note is open there.
        let waiting = if ask.is_none() && cx.app.follows(cx.id) && cx.app.followed_by(cx.id).is_none() { "Nothing is open to list anything about." } else if cx.app.online { "Calling the outline…" } else { "Offline: nothing is listed." };
        return said(cx, waiting, k);
    };
    let answer = Rc::new(answer.clone());
    let mut body = col().w_full().h_full().min_h(0.0);
    if let Some(head) = header(cx, &answer, k) { body = body.child(head) }
    if answer.list.rows.is_empty() {
        return body.child(said(cx, answer.list.empty.as_deref().unwrap_or("Nothing is listed."), k));
    }
    let sections = answer.list.sections();
    if answer.list.arrange == "lanes" {
        // A lane a group, side by side: each scrolls by itself and builds only its rows in view.
        let mut lanes = row().key(cx.key("lanes")).w_full().grow(1.0).min_h(0.0).gap(6.0).padding(6.0);
        for section in &sections {
            let group = section.head.clone().unwrap_or_else(|| ListGroup { name: String::new(), label: "ungrouped".into(), count: section.rows.len() as u64, ..ListGroup::default() });
            let rows = listed(cx, cx.key(format!("lane/{}/rows", group.name)), &answer, section.rows.iter().copied().map(Item::Row).collect(), k);
            lanes = lanes.child(col().key(cx.key(format!("lane/{}", group.name))).role("group").label(group.label.clone()).grow(1.0).min_w(0.0).h_full().min_h(0.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted)
                .child(head_el(cx, &group, k))
                .child(el().w_full().grow(1.0).min_h(0.0).child(scroll(cx, &format!("lane/{}/scroll", group.name), rows, k))));
        }
        return body.child(lanes);
    }
    let rows = listed(cx, cx.key("rows"), &answer, items(&sections), k);
    body.child(el().w_full().grow(1.0).min_h(0.0).child(scroll(cx, "scroll", rows, k)))
}
