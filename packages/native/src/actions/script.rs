//! Buttons and the scripts behind them.
//!
//! - **A press is `button.press`**, whoever presses: a click on the button, a key, an agent's act line. It finds the
//!   button on the page the tile shows (`parts::button`: the service found it and said what it runs) and runs it.
//! - **Where it runs is the button's to say.** One act line this window has an action for runs here, through the
//!   dispatcher, as whoever pressed. A button with several steps or a script, or a line whose head is no action
//!   here, is the service's to run (`scripts.sequence`, recorded as whoever pressed): it runs the steps, and each
//!   act it has for a window comes back to this one as a call.
//! - **A call is answered** (`scripts.answer`): the dispatcher runs the action the script asked for as the script,
//!   always, and the service hears what it answered or why it didn't run. Nothing a script asks for goes round the
//!   actor rule.
//! - **A press invites the run it starts** (the door's `surface/invite.ts`): the person's press mints an invitation,
//!   the service passes it on with every act of that run, and while a call carries it the script stands as the
//!   person (`App::stands`), so their own button may open their editor or move their keys. Its step and its writes
//!   are the script's all the same. Who the service says asked for a run is never read for this; an agent's press
//!   mints nothing; the invitation is one run's and is spent when the run ends.
//! - **What a press did is said on the tile**, on the part that was pressed.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome, Said, About};
use crate::actline::{self, Args};
use crate::parts;
use crate::store::{Call, OutlineAt, Reply};

/// An invitation the person's press minted: the token the run carries, the run it is bound to once its first act
/// came, the tile it was pressed in (where the run's acts come from, when they name none) and when it was minted.
#[derive(Clone, Debug, PartialEq)]
pub struct Invite { id: String, run: Option<String>, tile: String, minted: std::time::Instant }

/// How long an invitation lasts when its run never says it ended (the door's ten minutes).
const LAPSE: std::time::Duration = std::time::Duration::from_secs(600);

impl App {
    /// The person's press, in a tile, mints an invitation for the run it starts.
    fn invite(&mut self, tile: &str) -> String {
        self.st.invites.retain(|invite| invite.minted.elapsed() < LAPSE);
        let id = crate::store::fresh();
        self.st.invites.push(Invite { id: id.clone(), run: None, tile: tile.to_string(), minted: std::time::Instant::now() });
        id
    }

    /// The invitation a call carries, when it is one of this window's, still open and its run's: the tile its press
    /// was made in. One run's: it is bound to the first run that carries it, and a call of another run with the same
    /// token is not invited.
    fn invited(&mut self, call: &Call) -> Option<String> {
        let invite = call.invitation.as_ref().and_then(|id| self.st.invites.iter_mut().find(|invite| invite.id == *id)).filter(|invite| invite.minted.elapsed() < LAPSE)?;
        let theirs = match (&invite.run, &call.run) {
            (None, run) => { invite.run = run.clone(); true }
            (Some(bound), Some(run)) => bound == run,
            (Some(_), None) => false,
        };
        theirs.then(|| invite.tile.clone())
    }

    /// A run ended: the invitation it carried is spent.
    fn spend(&mut self, run: &str) { self.st.invites.retain(|invite| invite.run.as_deref() != Some(run)) }
}

static PRESS: ActionRow = ActionRow::new("button.press", Touches::Nothing, "press a button of the note a tile shows, by the line it is written on (or by its label): an act line this window has an action for runs here, as whoever pressed; a button with several steps or a script is the service's to run, and each act it sends back is run here and answered. What it did is said on the tile, under the button")
    .args(&[
        ("line", ArgSpec::number("the line of the note (from 1, as the door's button.press counts) the button is written on, as peek lists it").optional()),
        ("label", ArgSpec::text("what the button says, when the note has one button that says it").optional()),
        ("note", ArgSpec::text("the note the button is in (a block id): refused when the tile shows another").optional().kind("note")),
    ])
    .keys(&[KeyRow::via("a press on the button, where the note shows it")])
    .examples(&[Example { act: "button.press label=\"Sow the peas\"", does: "presses the open note's button labelled Sow the peas", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &PRESS, run: press, about: About::Notes }];

fn press(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("no tile here shows a note to press a button in") };
    let name = app.layout.name(&tile);
    let Some(page) = app.shown_of(&tile) else { return Outcome::refused(format!("{name} shows no note yet")) };
    if let Some(note) = args.text("note").filter(|note| *note != page.id) { return Outcome::refused(format!("{name} shows another note ({}), not {note}: open it there first", page.id)) }
    // A line is named as the door names one, from 1; the wire's (a part's `line`, `scripts.sequence`) is from 0.
    let named = match args.number("line") { Some(n) if n < 1.0 => return Outcome::refused("line= counts from 1, as the door's button.press does: the note's first line is line=1"), Some(n) => Some(n as u64 - 1), None => None };
    let part = match parts::button(page, named, args.text("label")) { Ok(part) => part.clone(), Err(why) => return Outcome::refused(why) };
    let (view, block, line) = (&part["view"], parts::text(&part, "block").unwrap_or(&page.id).to_string(), part["line"].as_u64().unwrap_or(0));
    let (label, act) = (parts::words(&view["label"]), parts::text(view, "act").unwrap_or("").to_string());
    // A button whose line leaves a slot empty has nothing to run yet (the part says what it `needs`): the service's
    // word on it is said, and nothing runs. Its word on anything else (a look it doesn't read) stops no press.
    let needs: Vec<&str> = parts::list(&part, "needs").iter().filter_map(Value::as_str).collect();
    if !needs.is_empty() {
        let wrong = parts::text(&part, "error").map(str::to_string).unwrap_or_else(|| format!("no {} yet", needs.join(" or ")));
        say(app, &tile, &block, line, format!("{label}: {wrong}"), false);
        return Outcome::refused(format!("{label} can't run as written: {wrong}"));
    }
    let read = actline::parse(&act).ok();
    let here = part["sequence"] != true && read.as_ref().is_some_and(|req| super::find(&req.action).is_some());
    if let Some(request) = read.filter(|_| here) {
        // Its act line as the request it reads as, from the tile it was pressed in: about that tile when its action
        // acts in a tile of that sort, unless it names one itself (`App::act_from`).
        let outcome = app.act_from(request, &name, by.clone());
        let did = if outcome.ok { format!("{label} ran {act}{}, as {}", if outcome.said.is_empty() { String::new() } else { format!(": {}", outcome.said) }, by.label()) } else { format!("{label} didn't run {act}: {}", outcome.said) };
        say(app, &tile, &block, line, did, outcome.ok);
        return Outcome { answer: json!({ "ran": "here", "act": act, "ok": outcome.ok, "answer": outcome.answer }), ..outcome };
    }
    let (at, client) = (app.at.clone(), app.store.client().to_string());
    // The run answers when it has ended, and its acts come back here meanwhile: its answer is never waited for in
    // place, even by a window that waits for every other (a headless render), or the run would wait on this window.
    let waits = app.blocking;
    app.store.set_blocking(false);
    app.store.pressing(&at);
    // The person's press invites the run (and so does a press made on an invitation of theirs); an agent's invites nothing.
    let mut run = json!({ "blockId": block, "line": line, "clientId": client });
    if app.stands(by) { run["invitation"] = json!(app.invite(&name)) }
    app.store.write(&at, "scripts.sequence", run, by, ran, json!({ "tile": tile, "block": block, "line": line, "label": label }));
    app.store.set_blocking(waits);
    say(app, &tile, &block, line, format!("{label}: running…"), true);
    Outcome::answer(json!({ "ran": "service", "block": block, "line": line }))
}

/// What a press did, kept on the tile it was pressed in: the part on that line says it.
fn say(app: &mut App, tile: &str, block: &str, line: u64, words: String, ok: bool) {
    app.ui_mut(tile).said = Some(Said { block: block.to_string(), line, words, ok, run: None });
}

/// How a run went, in words: the service's last word on it when it has one.
fn went(label: &str, by: &Actor, reason: &str, message: &str) -> (String, bool) {
    let more = if message.is_empty() { String::new() } else { format!(": {message}") };
    match reason {
        "failed" => (format!("{label} failed{more}"), false),
        "stopped" => (format!("{label} was stopped{more}"), false),
        _ => (format!("{label} ran, as {}{more}", by.label()), true),
    }
}

/// The service took the button (or refused to): a run that has ended says how it went; one still running is waited
/// for, by its id, and its end says the rest (`ended`).
fn ran(app: &mut App, reply: Reply) {
    let text = |key: &str| reply.ctx[key].as_str().unwrap_or("").to_string();
    let (tile, block, label, line) = (text("tile"), text("block"), text("label"), reply.ctx["line"].as_u64().unwrap_or(0));
    match &reply.result {
        Ok(result) if result["state"] == "running" => {
            say(app, &tile, &block, line, format!("{label}: running…"), true);
            if let Some(said) = app.ui_mut(&tile).said.as_mut() { said.run = result["undo"].as_str().map(|run| (run.to_string(), label.clone(), reply.by.clone())) }
            return;
        }
        Ok(result) => { let (words, ok) = went(&label, &reply.by, result["state"].as_str().unwrap_or("done"), result["message"].as_str().unwrap_or("")); say(app, &tile, &block, line, words, ok) }
        Err(refusal) => say(app, &tile, &block, line, format!("{label} didn't run: {}", refusal.error), false),
    }
    // What the run wrote is read now rather than when the watch says so.
    app.wrote(&[Some(block)]);
}

/// A run ended: the tile that waits on it says how, under the button that started it.
pub(in crate::actions) fn ended(app: &mut App, run: &str, reason: &str, message: &str) {
    let waiting = app.tiles.iter().find_map(|(tile, ui)| ui.said.as_ref().and_then(|said| said.run.as_ref().filter(|(id, _, _)| id == run).map(|(_, label, by)| (tile.clone(), said.block.clone(), said.line, label.clone(), by.clone()))));
    app.spend(run);
    let Some((tile, block, line, label, by)) = waiting else { return };
    let (words, ok) = went(&label, &by, reason, message);
    say(app, &tile, &block, line, words, ok);
    app.wrote(&[Some(block)]);
}

/// A script's act, sent to this window (the store read it off the wire): run through the dispatcher and answered.
/// It runs as the script, whoever started the run; on the invitation of the press that started it, the script
/// stands as the person while it does (`App::act_invited`).
pub(in crate::actions) fn called(app: &mut App, at: &OutlineAt, call: &Call) {
    let (by, pressed_in) = (Actor::Agent(call.script.clone()), app.invited(call));
    // The call is a request already: it goes to the dispatcher as one (as the control socket's does), never written
    // as a line and read again. A value that is no argument of an act (a list, an object) is the script's mistake,
    // said back to it.
    let mut args = serde_json::Map::new();
    for (key, value) in &call.args {
        match value {
            Value::String(_) | Value::Number(_) | Value::Bool(_) => { args.insert(key.clone(), value.clone()); }
            Value::Null => {}
            _ => return app.store.answer(at, &call.request, Err(format!("{} {key}= takes one value here, not a list or an object", call.action))),
        }
    }
    // `tile` among its arguments names the tile, as `tile=` on a line does.
    let named = args.remove("tile").and_then(|tile| tile.as_str().map(str::to_string));
    // The tile the run was pressed in is where the call comes from, not a tile it names (`App::act_from`): the one
    // the service says an agent's press was asked from, else the one this window's own press was made in.
    let request = actline::Request { action: call.action.clone(), tile: named, by: None, args };
    let from = call.tile.clone().or_else(|| pressed_in.clone());
    let outcome = app.act_invited(request, from.as_deref(), by, pressed_in.is_some());
    app.st.agent_said = Some(if outcome.ok { format!("{} · {}", call.script, call.action) } else { format!("{} · {} refused: {}", call.script, call.action, outcome.said) });
    app.store.answer(at, &call.request, if outcome.ok { Ok(outcome.answer) } else { Err(outcome.said) });
}
