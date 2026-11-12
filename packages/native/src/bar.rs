//! The command bar: one line over the window, and the rows its source lists for what is typed.
//!
//! A source says what it is (`SOURCES`) and lists rows; every row carries the act line a pick runs, so the bar
//! decides nothing about notes or actions. An action's row here is its `ActionRow` read out: its label is the
//! row's menu label (else its name), its words the row's summary, its keycap the key table's. Notes come from the
//! service's search, a query's rows and facets from `blocks.query`: both are asks in the store like any tile's.
use std::borrow::Cow;
use std::rc::Rc;

use rune::{El, Icon, col, el, row, text};
use rune_kit::{Badge, BadgeVariant, Dialog, Keybind, Kit, glyphs};
use serde::Deserialize;
use serde_json::json;

use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Field, word};
use crate::keys::{self, Layer};
use crate::list::{self, Rows};
use crate::page::Facet;
use crate::store::Ask;

static FILTER: Icon = Icon { name: "ep0ch-filter", view: 16.0, body: r#"<path d="M3 4.5H13M5 8H11M7 11.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"# };

/// One thing the bar can list, as it says of itself.
pub struct Source {
    pub id: &'static str,
    /// Its name over the line.
    pub about: &'static str,
    pub placeholder: &'static str,
    /// A character that, typed first on the line of `all`, lists this source alone.
    pub prefix: Option<char>,
    pub icon: &'static Icon,
    /// The source of its rows this window lists itself, asking the service nothing: what an agent's `bar.open`
    /// answers at once. None: every row is the service's answer (its search, a query), which comes later.
    pub here: Option<&'static str>,
}

pub static SOURCES: &[Source] = &[
    Source { id: "all", about: "Actions and notes", placeholder: "An action, or words in a note · > for actions alone", prefix: None, icon: &glyphs::SEARCH, here: Some("actions") },
    Source { id: "actions", about: "Actions", placeholder: "An action's name or what it does; a whole act line runs as written", prefix: Some('>'), icon: &glyphs::SEARCH, here: Some("actions") },
    Source { id: "notes", about: "Notes", placeholder: "Words in a title or a note", prefix: None, icon: &glyphs::SEARCH, here: None },
    Source { id: "query", about: "Query", placeholder: "type=letter mail=waiting · any property, as views read it", prefix: None, icon: &FILTER, here: None },
];

pub fn source(id: &str) -> Option<&'static Source> { SOURCES.iter().find(|source| source.id == id) }

/// One row of the bar: what it shows, and the act line a pick runs.
#[derive(Clone, Debug, PartialEq)]
pub struct BarRow {
    pub source: &'static str,
    /// What names it within its source: an action's line, a note's id.
    pub key: String,
    pub label: String,
    pub detail: String,
    pub keycap: Option<String>,
    pub line: String,
    /// It can't run as it is (an action that needs arguments): a pick puts its line on the bar's line to finish.
    pub fill: bool,
}

/// A found row's height in the bar: two lines of text and its padding.
const ROW: f32 = 46.0;

/// The element a row is, by its source and key.
pub fn row_key(row: &BarRow) -> String { format!("bar/row/{}/{}", row.source, row.key) }

/// The source the open bar lists and the words for it: `all` with its prefix typed is that source alone.
fn reading(app: &App) -> (&'static Source, String) {
    let (scope, text) = (source(&app.bar.scope).unwrap_or(&SOURCES[0]), app.bar.edit.text.clone());
    if scope.id == "all" && let Some(first) = text.chars().next() && let Some(prefixed) = SOURCES.iter().find(|s| s.prefix == Some(first)) {
        return (prefixed, text[first.len_utf8()..].trim_start().to_string());
    }
    (scope, text)
}

fn search(app: &App, words: &str) -> Ask { Ask::read(&app.at, "tree.search", json!({ "query": words, "limit": 30, "semantic": false })) }

fn query(app: &App, words: &str) -> Ask {
    Ask::watched(&app.at, "blocks.query", json!({ "query": { "where": words, "limit": 200, "facets": true, "facetValues": 8 }, "fields": ["title", "hasChildren", "timestamps"] }))
}

/// What the bar asks of the service for a source and its words.
fn asks_for(app: &App, scope: &str, words: &str) -> Vec<Ask> {
    match scope {
        "query" => vec![query(app, words)],
        "notes" | "all" if !words.trim().is_empty() => vec![search(app, words)],
        _ => Vec::new(),
    }
}

/// What the open bar wants answered now. Words typed on before an answer came are another ask: the old one's
/// answer has its own slot, and never shows under the new words.
pub fn asks(app: &App) -> Vec<Ask> {
    if !app.bar.open { return Vec::new() }
    let (scope, words) = reading(app);
    asks_for(app, scope.id, &words)
}

#[derive(Deserialize)]
struct Hits {
    #[serde(default)]
    matches: Vec<Hit>,
}

#[derive(Deserialize)]
struct Hit {
    block: HitBlock,
    #[serde(default)]
    title: String,
    #[serde(default)]
    path: String,
}

#[derive(Deserialize)]
struct HitBlock {
    id: String,
}

#[derive(Deserialize)]
struct Matches {
    #[serde(default)]
    blocks: Vec<Match>,
    #[serde(default)]
    facets: Vec<Facet>,
    #[serde(default)]
    hint: String,
}

#[derive(Deserialize)]
struct Match {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(rename = "updatedAt", default)]
    updated: String,
}

/// An ISO time's day, which is all a list row has room for.
fn day(iso: &str) -> String { iso.get(..10).unwrap_or(iso).to_string() }

fn open_line(id: &str) -> String { format!("open id={}", word(id)) }

/// Every way to run an action, as rows: the action alone, then each of its keys' and menu rows' arguments.
fn action_rows(typed: &str) -> Vec<BarRow> {
    let typed = typed.trim();
    let mut rows: Vec<BarRow> = Vec::new();
    // A whole act line typed runs as written.
    if let Some(action) = typed.split_whitespace().next().and_then(actions::find) && typed.split_whitespace().count() > 1 {
        rows.push(BarRow { source: "line", key: typed.to_string(), label: typed.to_string(), detail: action.row.summary.to_string(), keycap: None, line: typed.to_string(), fill: false });
    }
    let words: Vec<String> = typed.to_lowercase().split_whitespace().map(str::to_string).collect();
    for action in actions::all() {
        let r = action.row;
        let mut lines: Vec<(String, &str)> = vec![(r.id.to_string(), r.summary)];
        let with = |args: &actions::row::Pairs<actions::row::Scalar>| std::iter::once(r.id.to_string()).chain(args.iter().map(|(k, v)| format!("{k}={}", word(&v.word())))).collect::<Vec<_>>().join(" ");
        for key in r.key_rows() {
            if let KeyRow::Keys { args, does, .. } = key && !args.is_empty() && !lines.iter().any(|(line, _)| *line == with(args)) { lines.push((with(args), does)) }
        }
        for menu in r.menu.iter().filter(|menu| !menu.args().is_empty()) {
            if !lines.iter().any(|(line, _)| *line == with(&menu.args())) { lines.push((with(&menu.args()), r.summary)) }
        }
        for (line, does) in lines {
            let label = actions::label(&line);
            let detail = if label == line { does.to_string() } else { format!("{line} · {does}") };
            let hay = format!("{label} {line} {}", r.summary).to_lowercase();
            if !words.iter().all(|w| hay.contains(w.as_str())) { continue }
            let fill = line == r.id && r.required().next().is_some();
            rows.push(BarRow { source: "actions", key: line.clone(), label, detail, keycap: keys::cap(&line), line, fill });
        }
    }
    // What was typed names it: those first, in the order the actions list themselves.
    let lower = typed.to_lowercase();
    let named = |row: &BarRow| row.source != "line" && !lower.is_empty() && !(row.line.to_lowercase().contains(&lower) || row.label.to_lowercase().contains(&lower));
    rows.sort_by_key(named);
    rows
}

fn note_rows(app: &App, words: &str) -> Vec<BarRow> {
    if words.trim().is_empty() { return Vec::new() }
    let Some(hits) = app.store().read::<Hits>(&search(app, words)) else { return Vec::new() };
    hits.matches.iter().map(|m| BarRow { source: "notes", key: m.block.id.clone(), label: m.title.clone(), detail: m.path.clone(), keycap: None, line: open_line(&m.block.id), fill: false }).collect()
}

fn query_rows(app: &App, words: &str) -> Vec<BarRow> {
    let Some(found) = app.store().read::<Matches>(&query(app, words)) else { return Vec::new() };
    found.blocks.iter().map(|b| BarRow { source: "query", key: b.id.clone(), label: b.title.clone(), detail: day(&b.updated), keycap: None, line: open_line(&b.id), fill: false }).collect()
}

/// The rows a source lists for some words, from what the store holds now.
pub fn rows_for(app: &App, scope: &str, words: &str) -> Vec<BarRow> {
    match scope {
        "actions" => action_rows(words),
        "notes" => note_rows(app, words),
        "query" => query_rows(app, words),
        _ => action_rows(words).into_iter().chain(note_rows(app, words)).collect(),
    }
}

/// The open bar's rows.
pub fn rows(app: &App) -> Vec<BarRow> {
    let (scope, words) = reading(app);
    rows_for(app, scope.id, &words)
}

/// The facets the open bar's query matches carry, counted by the service.
pub fn facets(app: &App) -> &[Facet] {
    let (scope, words) = reading(app);
    if scope.id != "query" { return &[] }
    app.store().read::<Matches>(&query(app, &words)).map_or(&[], |found| &found.facets)
}

/// What the service says of the bar's question where rows would be: its hint, or why it can't read it.
pub fn hint(app: &App) -> Option<String> {
    let (scope, words) = reading(app);
    let ask = asks_for(app, scope.id, &words).into_iter().next()?;
    if let Some(refusal) = app.store().refusal(&ask) { return Some(refusal.error.clone()) }
    app.store().read::<Matches>(&ask).map(|found| found.hint.clone()).filter(|hint| scope.id == "query" && !hint.is_empty())
}

/// The bar's question is out and nothing has answered it yet.
fn asking(app: &App) -> bool { asks(app).iter().any(|ask| app.store().waiting(ask)) }

fn row_el(row: &BarRow, lit: bool, k: &Kit) -> El {
    let c = &k.c;
    let words = col().gap(1.0).grow(1.0).min_w(0.0)
        .child(text(row.label.clone()).font(k.ty.ui_medium).color(c.text_base).truncate())
        .child(text(row.detail.clone()).font(k.ty.small).color(c.text_faint).truncate());
    let mut line = rune::row().w_full().gap(10.0).center_y().child(words);
    if let Some(cap) = &row.keycap { line = line.child(Keybind::new(&[cap.as_str()]).build(k)) }
    let pick = format!("bar.pick source={} key={}", row.source, word(&row.key));
    k.interactive(line.px(10.0).py(6.0).h(ROW).radius(k.radius.sm).fill(if lit { c.surface_hover } else { rune::Color::TRANSPARENT }))
        .key(row_key(row))
        .role("option")
        .on_press(move |s: &mut App| { s.act(&pick, Actor::Person); })
}

/// The bar, over the window, when it is open.
pub fn view(s: &App, k: &Kit, layer: &mut Vec<El>) {
    if !s.bar.open { return }
    let c = &k.c;
    let (source, _) = reading(s);
    let field = keys::input(&s.bar.edit, Field::Bar).label(source.about).placeholder(source.placeholder).leading_icon(source.icon).width(None).build(k).key("bar/field");
    let mut body = col().w_full().px(16.0).pb(16.0).gap(10.0).child(field);
    let facets = facets(s);
    if !facets.is_empty() {
        // The facets the matches carry: each value narrows the query.
        let mut strip = row().key("bar/facets").w_full().gap(6.0).flex_wrap();
        for f in facets {
            for v in &f.values {
                let narrow = format!("bar.narrow key={} value={}", word(&f.key), word(&v.value));
                strip = strip.child(
                    k.interactive(Badge::new(format!("{}={} · {}", f.key, v.value, v.count)).variant(BadgeVariant::Subtle).build(k))
                        .key(format!("bar/facet/{}/{}", f.key, v.value))
                        .on_press(move |s: &mut App| { s.act(&narrow, Actor::Person); }),
                );
            }
        }
        body = body.child(strip);
    }
    let hint = hint(s);
    if let Some(hint) = &hint { body = body.child(text(hint.clone()).key("bar/hint").font(k.ty.small).color(c.warning.fg).wrap()) }
    let rows = Rc::new(rows(s));
    if rows.is_empty() {
        if hint.is_none() {
            let said = if asking(s) { "Asking…" } else if s.bar.edit.text.trim().is_empty() { "Type to search." } else { "Nothing matches." };
            body = body.child(text(said).key("bar/empty").font(k.ty.small).color(c.text_faint).px(10.0).py(6.0));
        }
    } else {
        let (keyed, built, kit, cursor) = (rows.clone(), rows.clone(), k.clone(), s.bar.cursor);
        // The kit's dialog doesn't bound a scroll in its body, so the list bounds itself: seven rows at most.
        body = body.child(list::bounded("bar/rows", 7, k, Rows::new(rows.len(), ROW, move |_: &App, i: usize| Cow::Owned(row_key(&keyed[i])), move |_: &App, i: usize| row_el(&built[i], i == cursor, &kit))));
    }
    // What the bar's own keys do, from the table.
    let hints = keys::hints(Layer::Bar).into_iter().fold(row().key("bar/keys").w_full().gap(12.0).flex_wrap(), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(c.text_faint)))
    });
    body = body.child(el().h(2.0)).child(hints);
    Dialog::new("bar", source.about).open(true).width(620.0).fit().child(body).on_close(|s: &mut App| { s.act("bar.close", Actor::Person); }).build(k, layer);
}
