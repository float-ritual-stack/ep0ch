//! The command bar's own actions: open it on a source, move its lit row, pick a row, narrow a query, put it away.
//! What the bar lists is `crate::bar`'s (its sources and their rows); a pick runs the row's own act line.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, About, draft};
use crate::actline::Args;
use crate::bar;

static OPEN: ActionRow = ActionRow::new("bar.open", Touches::Nothing, "the command bar: one palette over the window. It lists the actions there are (with their keys) and, typed, whatever the service lists on a bar's main list (the outline's notes by its search); scope= lists one source: actions, or one the service says a bar lists (query: the views' grammar, with the facets its matches carry; screens: the screens to open; extensions: what is installed and what can be; outlines: the outlines there are to switch to). The person's opens it; an agent's opens nothing: it answers the rows for its own query=, the actions at once and a served source's as the store holds them, with the ask that lists them")
    .args(&[
        ("query", ArgSpec::text("what's typed in it").optional()),
        ("scope", ArgSpec::text("one source: actions, or one the service lists for a bar (search, query, screens, extensions, outlines); all (the default) lists actions, then the main list").optional()),
    ])
    .keys(&[
        KeyRow::keys("mod+k", "open the bar on everything"),
        KeyRow::with("mod+l", None, "open the bar on a query", &[("scope", Scalar::Text("query"))]),
        KeyRow::via("a press on a chip of a note, which opens the bar on every note that carries it"),
    ])
    .menu(&[
        MenuRow::new("Find", "Bar", Some("mod+k")),
        MenuRow::with("Query", "Bar", Some("mod+l"), &[("scope", Scalar::Text("query"))]),
        MenuRow::with("Screens", "Bar", None, &[("scope", Scalar::Text("screens"))]),
        MenuRow::with("Extensions", "Bar", None, &[("scope", Scalar::Text("extensions"))]),
        MenuRow::with("Outlines", "Bar", None, &[("scope", Scalar::Text("outlines"))]),
    ])
    .examples(&[Example { act: "bar.open scope=query query=\"type=bed NOT stage=done\"", does: "opens the bar on the beds not done yet", safe: Some(true) }]);

static CLOSE: ActionRow = ActionRow::new("bar.close", Touches::Nothing, "put the command bar away, nothing picked. The person's: an agent never closes the bar the person has open")
    .person("the bar is the person's: an agent never closes the bar the person has open")
    .keys(&[KeyRow::on("escape", "bar", "put the bar away")])
    .menu(&[MenuRow::new("Close", "Bar", Some("escape"))]);

static PICK: ActionRow = ActionRow::new("bar.pick", Touches::Nothing, "pick a row of the command bar (n= from 1, default the lit one; or source= and key=): a note opens, an action runs, one that needs arguments is put on the line to finish. The person's picks from their open bar and puts it away; an agent's names an action's row (source=actions key=) and runs it as itself")
    .args(&[
        ("n", ArgSpec::number("the row, from 1").optional()),
        ("source", ArgSpec::text("with key=: the row by its source and key, whatever its number now").optional()),
        ("key", ArgSpec::text("with source=: the row's key").optional()),
    ])
    .keys(&[KeyRow::on("enter", "bar", "pick the lit row"), KeyRow::via("a press on a row of the bar")])
    .examples(&[Example { act: "bar.pick source=actions key=note.new", does: "runs the bar's note.new row", safe: None }]);

static MOVE: ActionRow = ActionRow::new("bar.move", Touches::Nothing, "move the command bar's lit row down (by=1) or up (by=-1), round again. The person's: the lit row is their selection")
    .person("the bar's lit row is the person's selection: an agent never moves it")
    .args(&[("by", ArgSpec::number("how many rows down; negative is up"))])
    .keys(&[
        KeyRow::with("down", Some("bar"), "the next row", &[("by", Scalar::Whole(1))]),
        KeyRow::with("up", Some("bar"), "the row before", &[("by", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "bar.move by=1", does: "lights the next row", safe: Some(true) }]);

static NARROW: ActionRow = ActionRow::new("bar.narrow", Touches::Nothing, "narrow the bar's query by a property the matches carry: the query gains key=value, in the views' grammar (picked twice is still once). The person's: an agent asks a query of its own")
    .person("the bar is the person's: an agent asks its own query with bar.open scope=query query=…")
    .args(&[("key", ArgSpec::text("the property's key").kind("key")), ("value", ArgSpec::text("the value to keep"))])
    .keys(&[KeyRow::via("a press on a facet of the bar's query")])
    .examples(&[Example { act: "bar.narrow key=stage value=sown", does: "keeps the matches whose stage is sown", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open, about: About::Nothing }, Action { row: &CLOSE, run: close, about: About::Nothing }, Action { row: &PICK, run: pick, about: About::Nothing }, Action { row: &MOVE, run: step, about: About::Nothing }, Action { row: &NARROW, run: narrow, about: About::Nothing }];

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let scope = args.text("scope").unwrap_or(bar::ALL);
    let Some(source) = bar::source(app, scope) else {
        return Outcome::refused(format!("the bar has no source {scope}: {}", bar::sources(app).iter().map(|s| s.id.clone()).collect::<Vec<_>>().join(", ")));
    };
    if !app.stands(by) {
        // An agent's is a question, not the person's bar, and an act answers at once. The rows this window lists
        // itself are answered whole. A served source's are the service's answer: the ones the store holds now are
        // answered with the ask that lists them, so the agent asks the service the same thing and maps nothing.
        let words = args.text("query").unwrap_or("");
        if source.served {
            let Some(ask) = bar::ask(app, &source, words) else { return Outcome::refused("the list sources haven't come yet: ask again") };
            let held = app.store.read::<crate::page::ListAnswer>(&ask).is_some();
            let rows = bar::rows_for(app, &source, words);
            let mut request = ask.params.clone();
            request["action"] = json!(ask.action);
            return Outcome::answer(json!({ "scope": source.id, "rows": bar::described(&rows), "answered": held, "ask": request }));
        }
        let here = bar::source(app, bar::ACTIONS).unwrap_or(source);
        return Outcome::answer(json!({ "scope": here.id, "rows": bar::described(&bar::rows_for(app, &here, words)), "answered": true }));
    }
    // Opened again on the same source with nothing said, the words typed stay.
    let text = args.text("query").map(str::to_string).unwrap_or_else(|| if app.bar.open && app.bar.scope == source.id { app.bar.edit.words().to_string() } else { String::new() });
    app.st.bar.open = true;
    app.st.bar.scope = source.id.clone();
    app.st.bar.edit = draft::focused(&text);
    app.st.bar.cursor = 0;
    Outcome::done()
}

fn close(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    if !app.bar.open { return Outcome::refused("the bar isn't open") }
    app.st.bar.open = false;
    app.unselect();
    Outcome::done()
}

fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let named = args.text("source").zip(args.text("key"));
    let rows = if app.stands(by) {
        if !app.bar.open { return Outcome::refused("the bar isn't open") }
        bar::rows(app)
    } else {
        let Some((source, _)) = named else { return Outcome::refused("an agent's pick names its row: source= and key= (bar.open answers them)") };
        let Some(source) = bar::source(app, source) else { return Outcome::refused(format!("the bar has no source {source}")) };
        bar::rows_for(app, &source, "")
    };
    let row = match (named, args.number("n")) {
        (Some((source, key)), _) => rows.iter().find(|row| row.source == source && row.key == key),
        (None, Some(n)) => rows.get((n.max(1.0) as usize) - 1),
        (None, None) => rows.get(app.bar.cursor),
    };
    let Some(row) = row.cloned() else { return Outcome::refused("the bar has no such row") };
    if row.fill {
        // It can't run without arguments: its line goes on the bar's own line, for the person to finish.
        if !app.stands(by) { return Outcome::refused(format!("{} needs arguments: run it yourself, with them", row.key)) }
        app.st.bar.scope = bar::ACTIONS.into();
        app.st.bar.edit = draft::focused(&format!("{} ", row.line));
        app.st.bar.cursor = 0;
        return Outcome::done();
    }
    // The bar is put away first: what the row runs lands on the window, not on the bar.
    if app.stands(by) { app.st.bar.open = false }
    let ran = app.act(&row.line, by.clone());
    // (The words selected in a reader when the bar opened were the row's to use: a comment took them.)
    if app.stands(by) { app.unselect() }
    Outcome { answer: json!({ "ran": row.line, "answer": ran.answer }), ..ran }
}

fn step(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    if !app.bar.open { return Outcome::refused("the bar isn't open") }
    let rows = bar::rows(app);
    if rows.is_empty() { return Outcome::done() }
    let at = (app.bar.cursor as i64 + args.number("by").unwrap_or(1.0) as i64).rem_euclid(rows.len() as i64) as usize;
    app.st.bar.cursor = at;
    app.st.reveal = Some(bar::row_key(&rows[at]));
    Outcome::done()
}

/// A facet value picked: the bar's question is narrowed by it, written by the one writer of a picked value as a
/// term (`query::narrowed`). The question is the bar's own when its list carries facets; else it is opened on the
/// source the service says takes one (`bar::questions`).
fn narrow(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let pick = (args.text("key").unwrap_or("").to_string(), args.text("value").unwrap_or("").to_string());
    let here = app.bar.open && !bar::facets(app).is_empty();
    let on = if here { app.bar.scope.clone() } else { match bar::questions(app) { Some(source) => source.id, None => return Outcome::refused("nothing here takes a question: the service lists no source that carries facets") } };
    let now = if app.bar.open && app.bar.scope == on { app.bar.edit.words().trim().to_string() } else { String::new() };
    // Picked twice is still once.
    let term = crate::query::term(&pick.0, &pick.1);
    if app.bar.open && now.split_whitespace().any(|w| w == term) { return Outcome::done() }
    app.st.bar.open = true;
    app.st.bar.scope = on;
    app.st.bar.edit = draft::focused(&crate::query::narrowed(&now, &[pick]));
    app.st.bar.cursor = 0;
    Outcome::done()
}
