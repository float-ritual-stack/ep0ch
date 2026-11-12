//! The command bar's own actions: open it on a source, move its lit row, pick a row, narrow a query, put it away.
//! What the bar lists is `crate::bar`'s (its sources and their rows); a pick runs the row's own act line.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, draft, word};
use crate::actline::Args;
use crate::bar;

static OPEN: ActionRow = ActionRow::new("bar.open", Touches::Nothing, "the command bar: one palette over the window. It lists the actions there are (with their keys) and, typed, the outline's notes by the service's search; scope=actions|notes|query lists one source (query: the views' grammar, with the facets its matches carry). The person's opens it; an agent's answers the rows for its own query= and scope= and opens nothing")
    .args(&[
        ("query", ArgSpec::text("what's typed in it").optional()),
        ("scope", ArgSpec::text("one source: actions, notes or query; all (the default) lists actions, then notes").optional()),
    ])
    .keys(&[
        KeyRow::keys("mod+k", "open the bar on everything"),
        KeyRow::with("mod+l", None, "open the bar on a query", &[("scope", Scalar::Text("query"))]),
        KeyRow::via("a press on a chip of a note, which opens the bar on every note that carries it"),
    ])
    .menu(&[
        MenuRow::new("Find", "Bar", Some("mod+k")),
        MenuRow::with("Query", "Bar", Some("mod+l"), &[("scope", Scalar::Text("query"))]),
    ])
    .examples(&[Example { act: "bar.open scope=query query=\"type=bed NOT stage=done\"", does: "opens the bar on the beds not done yet", safe: Some(true) }]);

static CLOSE: ActionRow = ActionRow::new("bar.close", Touches::Nothing, "put the command bar away, nothing picked. The person's: an agent never closes the bar the person has open")
    .keys(&[KeyRow::on("escape", "bar", "put the bar away")])
    .menu(&[MenuRow::new("Close", "Bar", Some("escape"))]);

static PICK: ActionRow = ActionRow::new("bar.pick", Touches::Nothing, "pick a row of the command bar (n= from 1, default the lit one; or source= and key=): a note opens, an action runs, one that needs arguments is put on the line to finish. The person's picks from their open bar and puts it away; an agent's names the row (source= key=) and runs it as itself")
    .args(&[
        ("n", ArgSpec::number("the row, from 1").optional()),
        ("source", ArgSpec::text("with key=: the row by its source and key, whatever its number now").optional()),
        ("key", ArgSpec::text("with source=: the row's key").optional()),
    ])
    .keys(&[KeyRow::on("enter", "bar", "pick the lit row"), KeyRow::via("a press on a row of the bar")])
    .examples(&[Example { act: "bar.pick source=actions key=note.new", does: "runs the bar's note.new row", safe: None }]);

static MOVE: ActionRow = ActionRow::new("bar.move", Touches::Nothing, "move the command bar's lit row down (by=1) or up (by=-1), round again")
    .args(&[("by", ArgSpec::number("how many rows down; negative is up"))])
    .keys(&[
        KeyRow::with("down", Some("bar"), "the next row", &[("by", Scalar::Whole(1))]),
        KeyRow::with("up", Some("bar"), "the row before", &[("by", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "bar.move by=1", does: "lights the next row", safe: Some(true) }]);

static NARROW: ActionRow = ActionRow::new("bar.narrow", Touches::Nothing, "narrow the bar's query by a property the matches carry: the query gains key=value, in the views' grammar (picked twice is still once)")
    .args(&[("key", ArgSpec::text("the property's key").kind("key")), ("value", ArgSpec::text("the value to keep"))])
    .keys(&[KeyRow::via("a press on a facet of the bar's query")])
    .examples(&[Example { act: "bar.narrow key=stage value=sown", does: "keeps the matches whose stage is sown", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open }, Action { row: &CLOSE, run: close }, Action { row: &PICK, run: pick }, Action { row: &MOVE, run: step }, Action { row: &NARROW, run: narrow }];

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let scope = args.text("scope").unwrap_or("all");
    let Some(source) = bar::source(scope) else {
        return Outcome::refused(format!("the bar has no source {scope}: {}", bar::SOURCES.iter().map(|s| s.id).collect::<Vec<_>>().join(", ")));
    };
    if !by.is_person() {
        // An agent's is a question, not the person's bar: the rows its words list, from what is already known here.
        let rows = bar::rows_for(app, source.id, args.text("query").unwrap_or(""));
        return Outcome::answer(json!({ "scope": source.id, "rows": rows.iter().enumerate().map(|(i, row)| json!({ "n": i + 1, "source": row.source, "key": row.key, "label": row.label, "act": row.line })).collect::<Vec<_>>() }));
    }
    // Opened again on the same source with nothing said, the words typed stay.
    let text = args.text("query").map(str::to_string).unwrap_or_else(|| if app.bar.open && app.bar.scope == source.id { app.bar.edit.text.clone() } else { String::new() });
    app.st.bar.open = true;
    app.st.bar.scope = source.id.to_string();
    app.st.bar.edit = draft::focused(&text);
    app.st.bar.cursor = 0;
    Outcome::done()
}

fn close(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    if !by.is_person() { return Outcome::refused("the bar is the person's: an agent never closes the bar the person has open") }
    if !app.bar.open { return Outcome::refused("the bar isn't open") }
    app.st.bar.open = false;
    Outcome::done()
}

fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let named = args.text("source").zip(args.text("key"));
    let rows = if by.is_person() {
        if !app.bar.open { return Outcome::refused("the bar isn't open") }
        bar::rows(app)
    } else {
        let Some((source, _)) = named else { return Outcome::refused("an agent's pick names its row: source= and key= (bar.open answers them)") };
        bar::rows_for(app, source, "")
    };
    let row = match (named, args.number("n")) {
        (Some((source, key)), _) => rows.iter().find(|row| row.source == source && row.key == key),
        (None, Some(n)) => rows.get((n.max(1.0) as usize) - 1),
        (None, None) => rows.get(app.bar.cursor),
    };
    let Some(row) = row.cloned() else { return Outcome::refused("the bar has no such row") };
    if row.fill {
        // It can't run without arguments: its line goes on the bar's own line, for the person to finish.
        if !by.is_person() { return Outcome::refused(format!("{} needs arguments: run it yourself, with them", row.key)) }
        app.st.bar.scope = "actions".into();
        app.st.bar.edit = draft::focused(&format!("{} ", row.line));
        app.st.bar.cursor = 0;
        return Outcome::done();
    }
    // The bar is put away first: what the row runs lands on the window, not on the bar.
    if by.is_person() { app.st.bar.open = false }
    let ran = app.act(&row.line, by.clone());
    Outcome { answer: json!({ "ran": row.line, "answer": ran.answer }), ..ran }
}

fn step(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    if !by.is_person() { return Outcome::refused("the bar's lit row is the person's selection: an agent never moves it") }
    if !app.bar.open { return Outcome::refused("the bar isn't open") }
    let rows = bar::rows(app);
    if rows.is_empty() { return Outcome::done() }
    let at = (app.bar.cursor as i64 + args.number("by").unwrap_or(1.0) as i64).rem_euclid(rows.len() as i64) as usize;
    app.st.bar.cursor = at;
    app.st.reveal = Some(bar::row_key(&rows[at]));
    Outcome::done()
}

/// A facet value picked: the query gains `key=value`, in the views' grammar.
fn narrow(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    if !by.is_person() { return Outcome::refused("the bar is the person's: an agent asks its own query with bar.open scope=query query=…") }
    let (key, value) = (args.text("key").unwrap_or(""), args.text("value").unwrap_or(""));
    let term = format!("{key}={}", word(value));
    let now = if app.bar.open && app.bar.scope == "query" { app.bar.edit.text.trim().to_string() } else { String::new() };
    if app.bar.open && now.split_whitespace().any(|w| w == term) { return Outcome::done() }
    app.st.bar.open = true;
    app.st.bar.scope = "query".into();
    app.st.bar.edit = draft::focused(&if now.is_empty() { term } else { format!("{now} {term}") });
    app.st.bar.cursor = 0;
    Outcome::done()
}
