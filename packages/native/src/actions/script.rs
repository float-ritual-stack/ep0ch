//! Buttons and the scripts behind them.
//!
//! - **A press is `button.press`**, whoever presses: a click on the button, a key, an agent's act line. It finds the
//!   button on the page the tile shows (`parts::button`: the service found it and said what it runs) and runs it.
//! - **Where it runs is the button's to say.** One act line this window has an action for runs here, through the
//!   dispatcher, as whoever pressed. A button with several steps or a script, or a line whose head is no action
//!   here, is the service's to run (`scripts.sequence`, recorded as whoever pressed): it runs the steps, and each
//!   act it has for a window comes back to this one as a call.
//! - **A call is answered** (`scripts.answer`): the dispatcher runs the action the script asked for, as the person
//!   when the run is their press and as the script otherwise, and the service hears what it answered or why it
//!   didn't run. Nothing a script asks for goes round the actor rule.
//! - **What a press did is said on the tile**, on the part that was pressed.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome, Said, word};
use crate::actline::{self, Args};
use crate::parts;
use crate::store::{Call, OutlineAt, Reply};

static PRESS: ActionRow = ActionRow::new("button.press", Touches::Nothing, "press a button of the note a tile shows, by the line it is written on (or by its label): an act line this window has an action for runs here, as whoever pressed; a button with several steps or a script is the service's to run, and each act it sends back is run here and answered. What it did is said on the tile, under the button")
    .args(&[
        ("line", ArgSpec::number("the line of the note (from 0) the button is written on, as peek lists it").optional()),
        ("label", ArgSpec::text("what the button says, when the note has one button that says it").optional()),
        ("note", ArgSpec::text("the note the button is in (a block id): refused when the tile shows another").optional().kind("note")),
    ])
    .keys(&[KeyRow::via("a press on the button, where the note shows it")])
    .examples(&[Example { act: "button.press label=\"Sow the peas\"", does: "presses the open note's button labelled Sow the peas", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &PRESS, run: press }];

fn press(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(tile) = app.aimed.clone().or_else(|| app.reader()) else { return Outcome::refused("no tile here shows a note to press a button in") };
    let name = app.layout.name(&tile);
    let Some(page) = app.shown_of(&tile) else { return Outcome::refused(format!("{name} shows no note yet")) };
    if let Some(note) = args.text("note").filter(|note| *note != page.id) { return Outcome::refused(format!("{name} shows another note ({}), not {note}: open it there first", page.id)) }
    let part = match parts::button(page, args.number("line").map(|n| n as u64), args.text("label")) { Ok(part) => part.clone(), Err(why) => return Outcome::refused(why) };
    let (view, block, line) = (&part["view"], parts::text(&part, "block").unwrap_or(&page.id).to_string(), part["line"].as_u64().unwrap_or(0));
    let (label, act) = (parts::words(&view["label"]), parts::text(view, "act").unwrap_or("").to_string());
    // The service's word on a button that can't run as written: said, and nothing runs.
    if let Some(wrong) = parts::text(&part, "error") {
        say(app, &tile, &block, line, format!("{label}: {wrong}"), false);
        return Outcome::refused(format!("{label} can't run as written: {wrong}"));
    }
    let read = actline::parse(&act).ok();
    let here = part["sequence"] != true && read.as_ref().is_some_and(|req| super::find(&req.action).is_some());
    if here {
        // Its act line, aimed at the tile it was pressed in unless it names one itself.
        let aimed = if read.is_some_and(|req| req.tile.is_some()) { act.clone() } else { format!("{act} tile={}", word(&name)) };
        let outcome = app.act(&aimed, by.clone());
        let did = if outcome.ok { format!("{label} ran {act}{}, as {}", if outcome.said.is_empty() { String::new() } else { format!(": {}", outcome.said) }, by.label()) } else { format!("{label} didn't run {act}: {}", outcome.said) };
        say(app, &tile, &block, line, did, outcome.ok);
        return Outcome { answer: json!({ "ran": "here", "act": act, "ok": outcome.ok, "answer": outcome.answer }), ..outcome };
    }
    let (at, client) = (app.at.clone(), app.store.client().to_string());
    app.store.write(&at, "scripts.sequence", json!({ "blockId": block, "line": line, "clientId": client }), by, ran, json!({ "tile": tile, "block": block, "line": line, "label": label }));
    say(app, &tile, &block, line, format!("{label}: running…"), true);
    Outcome::answer(json!({ "ran": "service", "block": block, "line": line }))
}

/// What a press did, kept on the tile it was pressed in: the part on that line says it.
fn say(app: &mut App, tile: &str, block: &str, line: u64, words: String, ok: bool) {
    app.ui_mut(tile).said = Some(Said { block: block.to_string(), line, words, ok });
}

/// The service ran the button (or refused to): what it says of the run, on the tile.
fn ran(app: &mut App, reply: Reply) {
    let text = |key: &str| reply.ctx[key].as_str().unwrap_or("").to_string();
    let (tile, block, label, line) = (text("tile"), text("block"), text("label"), reply.ctx["line"].as_u64().unwrap_or(0));
    let (words, ok) = match &reply.result {
        Ok(result) if result["state"] == "failed" => (format!("{label} failed: {}", result["message"].as_str().unwrap_or("its run says no more")), false),
        Ok(result) => (format!("{label} ran, as {}{}", reply.by.label(), result["message"].as_str().filter(|m| !m.is_empty()).map_or(String::new(), |m| format!(": {m}"))), true),
        Err(refusal) => (format!("{label} didn't run: {}", refusal.error), false),
    };
    say(app, &tile, &block, line, words, ok);
    // What the run wrote is read now rather than when the watch says so.
    app.wrote(&[Some(block)]);
}

/// A script's act, sent to this window (the store read it off the wire): run through the dispatcher and answered.
/// A run the person's press started acts as the person (their press is the consent); any other acts as the script.
pub(in crate::actions) fn called(app: &mut App, at: &OutlineAt, call: &Call) {
    let by = if call.pressed { Actor::Person } else { Actor::Agent(call.script.clone()) };
    // A value that is no word of an act line (a list, an object) is the script's mistake, said back to it.
    let mut words = serde_json::Map::new();
    for (key, value) in &call.args {
        match value {
            Value::String(_) | Value::Number(_) | Value::Bool(_) => { words.insert(key.clone(), value.clone()); }
            Value::Null => {}
            _ => return app.store.answer(at, &call.request, Err(format!("{} {key}= takes one value here, not a list or an object", call.action))),
        }
    }
    let mut line = actline::line_of(&call.action, &words);
    if let Some(tile) = call.tile.as_deref().filter(|_| !words.contains_key("tile")) { line = format!("{line} tile={}", word(tile)) }
    let outcome = app.act(&line, by);
    app.st.agent_said = Some(if outcome.ok { format!("{} · {}", call.script, call.action) } else { format!("{} · {} refused: {}", call.script, call.action, outcome.said) });
    app.store.answer(at, &call.request, if outcome.ok { Ok(outcome.answer) } else { Err(outcome.said) });
}
