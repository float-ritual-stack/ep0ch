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
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, Dialog, Keybind, Kit, glyphs};
use serde_json::json;

use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Field, FormUi, word};
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
    /// Its answer carries the facets its matches have: a facet picked anywhere is a term of its question.
    pub facets: bool,
}

/// The two sources this window lists itself.
pub const ALL: &str = "all";
pub const ACTIONS: &str = "actions";

fn own() -> [Source; 2] {
    [
        Source { id: ALL.into(), about: "Everything".into(), placeholder: "An action, or words in a note · > for actions alone".into(), prefix: None, served: false, main: false, facets: false },
        Source { id: ACTIONS.into(), about: "Actions".into(), placeholder: "An action's name or what it does; a whole act line runs as written".into(), prefix: Some('>'), served: false, main: false, facets: false },
    ]
}

/// Every source the bar has: this window's two, then the ones the service says a bar lists, each as its own row says it.
pub fn sources(app: &App) -> Vec<Source> {
    let served = app.sources().into_iter().flatten().filter_map(|source| source.bar.as_ref().map(|bar| Source {
        id: source.from.clone(), about: source.about.clone(), placeholder: source.placeholder.clone().unwrap_or_default(), prefix: None, served: true, main: bar.main, facets: bar.facets,
    }));
    own().into_iter().chain(served).collect()
}

/// The source a question in the views' grammar is asked of: the one the service says carries facets. None: it
/// lists none, and nothing here opens a question.
pub fn questions(app: &App) -> Option<Source> { sources(app).into_iter().find(|source| source.facets) }

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
    let (all, text) = (sources(app), app.bar.edit.words().to_string());
    let scope = all.iter().find(|s| s.id == app.bar.scope).or_else(|| all.first()).cloned().unwrap_or_else(|| own()[0].clone());
    if scope.id == ALL && let Some(first) = text.chars().next() && let Some(prefixed) = all.iter().find(|s| s.prefix == Some(first)) {
        return (prefixed.clone(), text[first.len_utf8()..].trim_start().to_string());
    }
    (scope, text)
}

/// The parameter of a list's request the bar's words are (outline-core's `ListsRequest`).
const WORDS: &str = "query";

/// What a served source is asked for some words: one list, asked as a tile's is (`App::ask_of`: the parameters the
/// source says it reads, the bar's words for its question). A source on the main list is read as typed; one opened
/// alone is watched, so its rows follow the outline while it is open. None: the sources haven't come.
pub fn ask(app: &App, source: &Source, words: &str) -> Option<Ask> { app.ask_of(&source.id, !source.main, |name| (name == WORDS).then(|| json!(words))) }

/// What the bar asks of the service for a source and its words: the source's own list, or under `all` each main
/// source's once there are words.
fn asks_for(app: &App, scope: &Source, words: &str) -> Vec<Ask> {
    if scope.served { return if scope.main && words.trim().is_empty() { Vec::new() } else { ask(app, scope, words).into_iter().collect() } }
    if scope.id != ALL || words.trim().is_empty() { return Vec::new() }
    sources(app).iter().filter(|source| source.main).filter_map(|source| ask(app, source, words)).collect()
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

/// A button for an act line: its label is the action's, its keycap the key table's.
fn button(line: &'static str, variant: ButtonVariant, k: &Kit) -> El {
    let b = Button::new(actions::label(line)).variant(variant).on_press(move |s: &mut App| { s.act(line, Actor::Person); });
    match keys::cap(line) { Some(cap) => b.shortcut(cap), None => b }.build(k)
}

/// The act lines a form's two buttons run; what each is called is its action's row.
const FORM_SAVE: &str = "form.save";
const FORM_CLOSE: &str = "form.close";
/// The form over the window: an extension's settings, a field each. What a field is called, what it means, what it
/// takes and what it does when left empty are its schema's words (`ext::SettingField`, as the service lists them),
/// read each time; the form itself holds only what is typed. A secret is said, never typed here: where its value
/// comes from is a reference on the host.
fn form(s: &App, form: &FormUi, k: &Kit, layer: &mut Vec<El>) {
    let c = &k.c;
    let settings = s.settings_of(&form.extension);
    let name = s.extensions().map_or(form.extension.as_str(), |listed| listed.named(&form.extension)).to_string();
    let mut body = col().w_full().px(16.0).pb(16.0).gap(12.0);
    for field in &form.fields {
        let said = settings.and_then(|settings| settings.fields.iter().find(|f| f.name == field.name));
        let input = keys::input(&field.edit, Field::Form(field.name.clone())).label(field.name.clone()).placeholder(said.and_then(|f| f.default.as_ref()).map(crate::ext::shown).unwrap_or_default()).width(None).build(k).key(format!("form/field/{}", field.name));
        // The field is called what its schema calls it, over the field.
        let mut one = col().w_full().gap(4.0).child(text(field.name.clone()).key(format!("form/name/{}", field.name)).font(k.ty.ui_medium).color(c.text_base)).child(input);
        if let Some(about) = said.map(|f| f.about()).filter(|about| !about.is_empty()) { one = one.child(text(about).key(format!("form/about/{}", field.name)).font(k.ty.small).color(c.text_faint).wrap()) }
        body = body.child(one);
    }
    for secret in settings.into_iter().flat_map(|settings| settings.secrets.iter()) {
        let stands = [secret.reference.clone().unwrap_or_default(), secret.state.clone(), secret.description.clone().unwrap_or_default()].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" · ");
        body = body.child(text(format!("{}: {stands}", secret.name)).key(format!("form/secret/{}", secret.name)).font(k.ty.small).color(c.text_muted).wrap());
    }
    // Why the last save was refused, in the service's words: every word typed is still in its field.
    if let Some(said) = form.said.as_ref().or(settings.and_then(|settings| settings.error.as_ref())) { body = body.child(text(said.clone()).key("form/said").font(k.ty.small).color(c.danger.fg).wrap()) }
    let hints = keys::hints(Layer::Form).into_iter().fold(row().key("form/keys").gap(12.0).center_y().grow(1.0).min_w(0.0), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(c.text_faint)))
    });
    body = body.child(row().w_full().gap(8.0).center_y().child(hints).child(button(FORM_CLOSE, ButtonVariant::Ghost, k).key("form/close")).child(button(FORM_SAVE, ButtonVariant::Submit, k).key("form/save")));
    Dialog::new("form", format!("{} · {name}", form.title)).open(true).width(560.0).fit().child(body).on_close(|s: &mut App| { s.act(FORM_CLOSE, Actor::Person); }).build(k, layer);
}

/// The bar, over the window, when it is open; else a form, while one is.
pub fn view(s: &App, k: &Kit, layer: &mut Vec<El>) {
    if !s.bar.open { if let Some(open) = &s.form { form(s, open, k, layer) } return }
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
            let said = if asking(s) { "Asking…".to_string() } else { empty(s).unwrap_or_else(|| if s.bar.edit.words().trim().is_empty() { "Type to search.".to_string() } else { "Nothing matches.".to_string() }) };
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
