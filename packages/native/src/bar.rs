//! The command bar: one line over the window, and the rows its source lists for what is typed.
//!
//! A source says what it is and lists rows; every row carries the act line a pick runs, so the bar decides nothing
//! about notes, screens or actions. Two sources are this window's own: its actions (each its `ActionRow` read out:
//! its label the row's menu label, its words the row's summary, its keycap the key table's) and `all`, the actions
//! and then whatever the service says belongs on the main list. Every other source is the service's: a producer of
//! `lists.read` that says a bar lists it (`from: sources`), whose rows, facets and hint come as one list answer, an
//! ask in the store like any tile's. The bar maps no answer to rows itself.
use std::borrow::Cow;
use std::rc::Rc;

use rune::{El, col, el, row, text};
use rune_kit::{Badge, BadgeVariant, Dialog, Keybind, Kit, glyphs};
use serde_json::json;

use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Field, word};
use crate::keys::{self, Layer};
use crate::list::{self, Rows};
use crate::page::{Facet, ListAnswer};
use crate::store::Ask;

/// One thing the bar can list, as it says of itself.
#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    pub id: String,
    /// Its name over the line.
    pub about: String,
    pub placeholder: String,
    /// A character that, typed first on the line of `all`, lists this source alone.
    pub prefix: Option<char>,
    /// The service lists it (`lists.read from=<id>`); else this window does, asking nothing.
    pub served: bool,
    /// Its rows are on the main list too, under the actions, once words are typed.
    pub main: bool,
}

/// The two sources this window lists itself.
pub const ALL: &str = "all";
pub const ACTIONS: &str = "actions";

fn own() -> [Source; 2] {
    [
        Source { id: ALL.into(), about: "Everything".into(), placeholder: "An action, or words in a note · > for actions alone".into(), prefix: None, served: false, main: false },
        Source { id: ACTIONS.into(), about: "Actions".into(), placeholder: "An action's name or what it does; a whole act line runs as written".into(), prefix: Some('>'), served: false, main: false },
    ]
}

/// Every source the bar has: this window's two, then the ones the service says a bar lists, each as its own row says it.
pub fn sources(app: &App) -> Vec<Source> {
    let served = app.store().read::<ListAnswer>(&app.sources_ask()).map(|answer| answer.list.rows.iter().filter(|row| row.group.as_deref() == Some("bar")).map(|row| Source {
        id: row.id.clone(), about: row.label.clone(), placeholder: row.detail.clone().unwrap_or_default(), prefix: None, served: true, main: row.mark.as_deref() == Some("main"),
    }).collect::<Vec<_>>()).unwrap_or_default();
    own().into_iter().chain(served).collect()
}

pub fn source(app: &App, id: &str) -> Option<Source> { sources(app).into_iter().find(|source| source.id == id) }

/// One row of the bar: what it shows, and the act line a pick runs.
#[derive(Clone, Debug, PartialEq)]
pub struct BarRow {
    /// The source that lists it (`line`: a whole act line typed).
    pub source: String,
    /// What names it within its source: an action's line, a list row's id.
    pub key: String,
    pub label: String,
    pub detail: String,
    pub keycap: Option<String>,
    pub line: String,
    /// It can't run as it is (an action that needs arguments): a pick puts its line on the bar's line to finish.
    pub fill: bool,
}

/// The rows as an agent and `peek` are answered them: numbered from 1, each with its source, key and the act line a
/// pick runs. The one place a bar row is written out as data.
pub fn described(rows: &[BarRow]) -> Vec<serde_json::Value> {
    rows.iter().enumerate().map(|(i, row)| json!({ "n": i + 1, "source": row.source, "key": row.key, "label": row.label, "detail": row.detail, "act": row.line })).collect()
}

/// A found row's height in the bar: two lines of text and its padding.
const ROW: f32 = 46.0;

/// The element a row is, by its source and key.
pub fn row_key(row: &BarRow) -> String { format!("bar/row/{}/{}", row.source, row.key) }

/// The source the open bar lists and the words for it: `all` with a source's prefix typed is that source alone.
fn reading(app: &App) -> (Source, String) {
    let (all, text) = (sources(app), app.bar.edit.text.clone());
    let scope = all.iter().find(|s| s.id == app.bar.scope).or_else(|| all.first()).cloned().unwrap_or_else(|| own()[0].clone());
    if scope.id == ALL && let Some(first) = text.chars().next() && let Some(prefixed) = all.iter().find(|s| s.prefix == Some(first)) {
        return (prefixed.clone(), text[first.len_utf8()..].trim_start().to_string());
    }
    (scope, text)
}

/// What a served source is asked for some words: one list. A source on the main list is read as typed; one opened
/// alone is watched, so its rows follow the outline while it is open.
pub fn ask(app: &App, source: &Source, words: &str) -> Ask {
    let params = json!({ "from": source.id, "query": words, "drawers": crate::tiles::drawers(), "kinds": [] });
    if source.main { Ask::read(&app.at, "lists.read", params) } else { Ask::watched(&app.at, "lists.read", params) }
}

/// What the bar asks of the service for a source and its words: the source's own list, or under `all` each main
/// source's once there are words.
fn asks_for(app: &App, scope: &Source, words: &str) -> Vec<Ask> {
    if scope.served { return if scope.main && words.trim().is_empty() { Vec::new() } else { vec![ask(app, scope, words)] } }
    if scope.id != ALL || words.trim().is_empty() { return Vec::new() }
    sources(app).iter().filter(|source| source.main).map(|source| ask(app, source, words)).collect()
}

/// What the open bar wants answered now. Words typed on before an answer came are another ask: the old one's
/// answer has its own slot, and never shows under the new words.
pub fn asks(app: &App) -> Vec<Ask> {
    if !app.bar.open { return Vec::new() }
    let (scope, words) = reading(app);
    asks_for(app, &scope, &words)
}

/// Every way to run an action, as rows: the action alone, then each of its keys' and menu rows' arguments.
fn action_rows(typed: &str) -> Vec<BarRow> {
    let typed = typed.trim();
    let mut rows: Vec<BarRow> = Vec::new();
    // A whole act line typed runs as written.
    if let Some(action) = typed.split_whitespace().next().and_then(actions::find) && typed.split_whitespace().count() > 1 {
        rows.push(BarRow { source: "line".into(), key: typed.to_string(), label: typed.to_string(), detail: action.row.summary.to_string(), keycap: None, line: typed.to_string(), fill: false });
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
            rows.push(BarRow { source: ACTIONS.into(), key: line.clone(), label, detail, keycap: keys::cap(&line), line, fill });
        }
    }
    // What was typed names it: those first, in the order the actions list themselves.
    let lower = typed.to_lowercase();
    let named = |row: &BarRow| row.source != "line" && !lower.is_empty() && !(row.line.to_lowercase().contains(&lower) || row.label.to_lowercase().contains(&lower));
    rows.sort_by_key(named);
    rows
}

/// A served source's rows for some words, from what the store holds now: each row as the service lists it, its act
/// line the one a pick runs.
fn served_rows(app: &App, source: &Source, words: &str) -> Vec<BarRow> {
    let Some(answer) = asks_for(app, source, words).first().and_then(|ask| app.store().read::<ListAnswer>(ask)) else { return Vec::new() };
    answer.list.rows.iter().filter_map(|r| r.act.as_ref().map(|line| BarRow { source: source.id.clone(), key: r.id.clone(), label: r.label.clone(), detail: r.detail.clone().unwrap_or_default(), keycap: keys::cap(line), line: line.clone(), fill: false })).collect()
}

/// The rows a source lists for some words, from what the store holds now.
pub fn rows_for(app: &App, scope: &Source, words: &str) -> Vec<BarRow> {
    if scope.served { return served_rows(app, scope, words) }
    let actions = action_rows(words);
    if scope.id != ALL { return actions }
    actions.into_iter().chain(sources(app).iter().filter(|source| source.main).flat_map(|source| served_rows(app, source, words))).collect()
}

/// The open bar's rows.
pub fn rows(app: &App) -> Vec<BarRow> {
    let (scope, words) = reading(app);
    rows_for(app, &scope, &words)
}

/// The open bar's own list answer, when its source is the service's.
fn answer(app: &App) -> Option<&ListAnswer> {
    let (scope, words) = reading(app);
    if !scope.served { return None }
    asks_for(app, &scope, &words).first().and_then(|ask| app.store().read::<ListAnswer>(ask))
}

/// The facets the open bar's list carries, counted by the service: chips that narrow its question.
pub fn facets(app: &App) -> &[Facet] { answer(app).map_or(&[], |answer| &answer.facets) }

/// What the service says of the bar's question where rows would be: its hint, or why it can't read it.
pub fn hint(app: &App) -> Option<String> {
    let (scope, words) = reading(app);
    let ask = asks_for(app, &scope, &words).into_iter().next()?;
    if let Some(refusal) = app.store().refusal(&ask) { return Some(refusal.error.clone()) }
    answer(app).and_then(|answer| answer.hint.clone()).filter(|hint| !hint.is_empty())
}

/// What an empty list says of itself, when its source is the service's.
fn empty(app: &App) -> Option<String> { answer(app).and_then(|answer| answer.list.empty.clone()) }

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
    let field = keys::input(&s.bar.edit, Field::Bar).label(source.about.clone()).placeholder(source.placeholder.clone()).leading_icon(&glyphs::SEARCH).width(None).build(k).key("bar/field");
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
            let said = if asking(s) { "Asking…".to_string() } else { empty(s).unwrap_or_else(|| if s.bar.edit.text.trim().is_empty() { "Type to search.".to_string() } else { "Nothing matches.".to_string() }) };
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
    Dialog::new("bar", source.about.clone()).open(true).width(620.0).fit().child(body).on_close(|s: &mut App| { s.act("bar.close", Actor::Person); }).build(k, layer);
}
