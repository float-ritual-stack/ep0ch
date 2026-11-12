//! Outlines: this window opens another one. Which outlines there are is the service's to say (`outlines.known`:
//! this machine's and the ones on the machines it holds a forward to; the bar's Outlines lists them as rows whose
//! pick is `outline.switch`). How one is reached is the rule every client opens an outline by (`App::ways`, the
//! door's `resolveTarget` through `resolve.ts`): nothing here reads a folder, a setting or a socket.
//!
//! - **Nothing guesses, and nothing is made.** A switch asks the service which outlines there are and opens only
//!   one it lists: a name nobody has is refused with the ones there are and the command that makes one on purpose.
//! - **An outline left is kept as it was** (`Parked`): its arrangement, what each tile showed, the way back
//!   through both, and the blocks being written, every word as typed. Their holds are let go (nobody is in front
//!   of them now), and asked for again when the window comes back.
//! - **A link is one an outline**, kept by the store: a window that comes back to an outline, or a second window
//!   on it, uses the link that is there.
use serde_json::{Value, json};

use super::app::Parked;
use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{About, Action, Actor, App, Notice, Outcome, word};
use crate::actline::Args;
use crate::draft::Recovery;
use crate::screen::Screen;
use crate::store::{OutlineAt, Reply};

static SWITCH: ActionRow = ActionRow::new("outline.switch", Touches::Screen, "this window opens another outline: one this machine has, or one on a machine it holds a forward to (machine=, that machine's ssh name). Only an outline the service lists is opened: a name nobody has is refused with the ones there are, and nothing is made. The outline left keeps its arrangement, what each tile showed and the blocks being written, as typed; switched back to, it is as it was left")
    .args(&[("name", ArgSpec::text("the outline's name, as the bar's Outlines lists it")), ("machine", ArgSpec::text("the ssh name of the machine it is on, when that isn't this one").optional())])
    .keys(&[KeyRow::via("a press on its row in the bar's Outlines")])
    .examples(&[Example { act: "outline.switch name=allotment", does: "opens the allotment outline in this window, the one left kept as it was", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[Action { row: &SWITCH, run: switch, about: About::Nothing }];

fn switch(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    // Left unsaid, the machine is the one this window's outline is on (the list it picks from was that host's); said
    // empty, it is this machine.
    let to = OutlineAt { outline: args.text("name").unwrap_or("").trim().to_string(), machine: args.text("machine").map_or_else(|| app.at.machine.clone(), |machine| machine.trim().to_string()) };
    if to == app.at { return Outcome { said: format!("this window is on {} already", to.outline), ..Outcome::done() } }
    if app.ways.is_none() { return Outcome::refused("this window was given no way to another outline") }
    // One this window was on is there, as it was left: it is asked of nobody.
    if app.parked.contains_key(&to) { return match app.go(to.clone()) { Ok(()) => Outcome::answer(json!({ "outline": to.outline, "machine": to.machine })), Err(why) => Outcome::refused(why) } }
    if !app.online { return Outcome::refused("the outline's host isn't answering: which outlines there are is its to say") }
    // Which outlines there are is asked now, each time, of a host on the machine named: this outline's when it is on
    // that machine, else one this window left there, else this outline's (which lists its forwards' too).
    let via = if app.at.machine == to.machine { app.at.clone() } else { app.parked.keys().find(|at| at.machine == to.machine).cloned().unwrap_or_else(|| app.at.clone()) };
    app.store.request(&via, "outlines.known", json!({}), by, known, json!({ "name": to.outline, "machine": to.machine, "asked": via.machine }));
    Outcome::answer(json!({ "switching": to.outline, "machine": to.machine }))
}

/// The service said which outlines there are: the one asked for is opened when it is among them.
fn known(app: &mut App, reply: Reply) {
    let to = OutlineAt { outline: reply.ctx["name"].as_str().unwrap_or("").to_string(), machine: reply.ctx["machine"].as_str().unwrap_or("").to_string() };
    let listed = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(format!("Still on {}: {}", app.at.outline, refusal.error))); return } };
    let rows: Vec<&Value> = listed["outlines"].as_array().into_iter().flatten().collect();
    // A row that names no machine is on the machine of the host that listed it.
    let asked = reply.ctx["asked"].as_str().unwrap_or("").to_string();
    let machine_of = |row: &Value| row["machine"].as_str().map_or_else(|| asked.clone(), str::to_string);
    if !rows.iter().any(|row| row["name"] == to.outline.as_str() && machine_of(row) == to.machine) {
        let there: Vec<String> = rows.iter().map(|row| match machine_of(row).as_str() { "" => row["name"].as_str().unwrap_or("").to_string(), machine => format!("{} on {machine}", row["name"].as_str().unwrap_or("")) }).collect();
        let elsewhere: Vec<String> = rows.iter().filter(|row| row["name"] == to.outline.as_str()).map(|row| machine_of(row)).collect();
        let hint = match elsewhere.first() { Some(machine) => format!("{} has one by that name: say machine={}", if machine.is_empty() { "this machine" } else { machine.as_str() }, word(machine)), None => format!("ep0ch outline create {} makes one on purpose", to.outline) };
        app.st.notice = Some(Notice::problem(format!("No outline named {}{} here, and none is made by asking. There are: {}. ({hint}.)", to.outline, if to.machine.is_empty() { String::new() } else { format!(" on {}", to.machine) }, there.join(", "))));
        return;
    }
    if let Err(why) = app.go(to.clone()) { app.st.notice = Some(Notice::problem(format!("Still on {}: {why}", app.at.outline))) }
}

impl App {
    /// This window is on `to` from now: the outline it leaves is parked as it stands, and the one it comes to is as
    /// it was left here, else as its file kept it, else laid out on its start screen once the service lists one.
    fn go(&mut self, to: OutlineAt) -> Result<(), String> {
        let ways = self.ways.clone().ok_or("this window was given no way to another outline")?;
        // The way there first: nothing here changes until it is known. (A link already there is used: this one is dropped.)
        let way = ways(&to)?;
        let from = self.at.clone();
        self.keep();
        self.remember();
        // Nobody is in front of the blocks being written here now: their holds are let go, their words stay.
        self.unhold_all();
        let arranged = self.arrangement_taken();
        let st = &mut self.st;
        let left = Parked {
            machine: std::mem::take(&mut st.machine), layout: arranged, screen: std::mem::replace(&mut st.screen, Screen::nowhere()), tiles: std::mem::take(&mut st.tiles),
            journal: std::mem::take(&mut st.journal), screen_seen: st.screen_seen.take(), drafts: std::mem::take(&mut st.drafts), recovered: std::mem::take(&mut st.recovered), trashed: std::mem::take(&mut st.trashed),
            kept_in: self.kept_in.take(), recovery: self.recovery.take(),
        };
        st.parked.insert(from.clone(), left);
        st.at = to.clone();
        (st.online, st.screens_epoch, st.screen_wrote, st.asked_screen, st.aimed, st.about, st.dragging, st.form) = (true, 0, false, None, None, None, None, None);
        st.bar.open = false;
        st.pictured.clear();
        match st.parked.remove(&to) {
            Some(back) => {
                (st.machine, st.screen, st.tiles, st.journal, st.screen_seen, st.drafts, st.recovered, st.trashed) = (back.machine, back.screen, back.tiles, back.journal, back.screen_seen, back.drafts, back.recovered, back.trashed);
                (self.kept_in, self.recovery) = (back.kept_in, back.recovery);
                self.arrangement_put(back.layout);
            }
            // The first time here: as the file kept it when there is one, and what a window left unsaved comes back.
            None => {
                if let Some(path) = way.kept {
                    let recovery = Recovery::beside(&path);
                    st.recovered = recovery.read();
                    (self.kept_in, self.recovery) = (Some(path), Some(recovery));
                    self.restore();
                }
            }
        }
        if !self.store.linked(&to) { self.store.link(&to, way.link) }
        let back = format!("outline.switch name={} machine={}", word(&from.outline), word(&from.machine));
        self.st.notice = Some(Notice { undo: Some(back), ..Notice::info(format!("This window is on {} now{}. {} is kept as it was left.", to.outline, if to.machine.is_empty() { String::new() } else { format!(", on {}", to.machine) }, from.outline)) });
        self.start();
        Ok(())
    }
}
