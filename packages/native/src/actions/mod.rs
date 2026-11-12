//! Every change to the window is an action, and `App::act` is the one way in.
//!
//! - **An action is its row plus what runs.** The row (`row.rs`, outline-core's `ActionRow`) is data: its name, what
//!   it does, its arguments, what it touches of the person's, its keys. Everything that shows or binds an action
//!   reads the row: the key table, the bar, a button's label and keycap, `actions` over the control socket.
//! - **A key, a press and an agent say the same thing**: an act line (`note.trash`, `open id=north-bed`). The
//!   dispatcher reads it (`actline.rs`), types its arguments by the row, checks the actor against what the row
//!   touches, runs it and records the step.
//! - **Only this folder changes the window's state**: `App`'s state is private to it (`app.rs`), so a view can
//!   read everything and change nothing except by an act line.
//!
//! One module a noun; each lists its actions, and `NOUNS` lists the modules.
mod app;
mod bar;
mod draft;
mod layout;
mod list;
mod nav;
mod note;
pub mod row;
mod screen;
mod script;
mod shell;
mod tile;
mod tree;

use serde_json::{Map, Value, json};

pub use app::{App, CELL, Field, Notice, Said, TileUi, Tone};
pub use row::ActionRow;

use crate::actline::{self, Args};
pub use crate::actline::word;
use crate::keys::Whereabouts;
use crate::store::Reply;
use row::{Touches, While};

/// Who acts: the person at the keys and the mouse, or an agent by its id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Actor {
    Person,
    Agent(String),
}

impl Actor {
    pub fn is_person(&self) -> bool { *self == Actor::Person }
    /// How the window names who did something: `you`, `an agent (compost-agent)`.
    pub fn label(&self) -> String { match self { Actor::Person => "you".into(), Actor::Agent(id) => format!("an agent ({id})") } }
    /// As a step records it.
    pub fn id(&self) -> String { match self { Actor::Person => "person".into(), Actor::Agent(id) => format!("agent:{id}") } }
}

/// What an action did, or why it didn't.
#[derive(Clone, Debug, PartialEq)]
pub struct Outcome {
    pub ok: bool,
    /// Refused: why, in plain words. Done: a few words where there is something to say.
    pub said: String,
    /// What it answers an agent.
    pub answer: Value,
    /// A refusal's kind, as the wire names kinds (outline-core's refusal.ts): `invalid` for a request that is itself wrong.
    pub kind: Option<&'static str>,
}

impl Outcome {
    pub fn done() -> Outcome { Outcome { ok: true, said: String::new(), answer: Value::Null, kind: None } }
    pub fn answer(answer: Value) -> Outcome { Outcome { answer, ..Outcome::done() } }
    pub fn refused(why: impl Into<String>) -> Outcome { Outcome { ok: false, said: why.into(), answer: Value::Null, kind: None } }
}

/// One act, as it was read and how it went: the record a key, a press and a line all leave alike.
#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    pub action: String,
    pub args: Map<String, Value>,
    pub tile: Option<String>,
    pub by: Actor,
    pub ok: bool,
    pub said: String,
}

impl Step {
    /// The act line it was, with its arguments as the action's row typed them.
    pub fn line(&self) -> String { actline::Request { action: self.action.clone(), tile: self.tile.clone(), by: None, args: self.args.clone() }.line() }
    pub fn json(&self) -> Value { json!({ "line": self.line(), "action": self.action, "args": self.args, "tile": self.tile, "by": self.by.id(), "ok": self.ok, "said": self.said }) }
}

/// What goes on from a write's or a one-off read's answer.
pub type Then = fn(&mut App, Reply);

/// What an act is about when it names no tile: the sort of tile its action acts in. `App::target` is the one
/// place that finds the tile; the dispatcher asks it for every act, checks the actor against that tile, and the
/// action runs in it (`App::about`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum About {
    /// No tile: the window, the bar, the screen.
    Nothing,
    /// Whichever tile: the one named, else the one with the keys.
    Any,
    /// A tile that reads notes: the open note's.
    Notes,
    /// A list tile.
    Lists,
    /// A list tile whose list is a tree.
    Tree,
    /// A tile a block is being written in.
    Drafts,
    /// A note the layout places: about no tile until it lands, unless it names the one it comes from.
    Placed,
}

impl About {
    /// How a refusal says the sort: "tree is no tile that reads notes".
    fn said(self) -> &'static str { match self { About::Notes => "tile that reads notes", About::Lists => "list", About::Tree => "list arranged as a tree", About::Drafts => "tile a block is being written in", _ => "tile" } }
}

/// An action: what it says about itself, what runs, and the sort of tile it is about.
pub struct Action {
    pub row: &'static ActionRow,
    pub run: fn(&mut App, &Args, &Actor) -> Outcome,
    pub about: About,
}

static NOUNS: &[&[Action]] = &[nav::ACTIONS, note::ACTIONS, draft::ACTIONS, bar::ACTIONS, tree::ACTIONS, list::ACTIONS, shell::ACTIONS, tile::ACTIONS, layout::ACTIONS, screen::ACTIONS, script::ACTIONS];

/// Every action there is, in the order its noun lists it.
pub fn all() -> impl Iterator<Item = &'static Action> { NOUNS.iter().flat_map(|noun| noun.iter()) }

pub fn find(id: &str) -> Option<&'static Action> { all().find(|action| action.row.id == id) }

/// The actor rule, and the one check of who acts: whether `by` may run an action, given what its row says it
/// touches and whose it is, where the person is and the tile the act is about. The person always may. An agent
/// never runs what the row says is the person's own, never takes the person's keys, their draft or the tile they
/// type in, and waits to change what they look at until they have been idle. (What an agent may do to the
/// arrangement is the layout's own rule, asked by `reshape`.) No action refuses an agent in its own run for whose
/// it is: it says so on its row (`person`).
fn rule(row: &ActionRow, by: &Actor, person: &Whereabouts, tile: &str) -> Result<(), String> {
    let Actor::Agent(_) = by else { return Ok(()) };
    if let Some(theirs) = row.person { return Err(theirs.to_string()) }
    let way = "block.mark gets their attention";
    match row.touches {
        Touches::Nothing | Touches::Shape => Ok(()),
        Touches::Tile => {
            let typing = person.typing_in.as_deref() == Some(tile);
            let held = if row.while_ == Some(While::Typing) { typing } else { person.focus == tile || typing };
            if held { Err(format!("{}; an agent doesn't run {} there · {way}", person.why.clone().unwrap_or_else(|| format!("{} has the person's keys", person.focus)), row.id)) } else { Ok(()) }
        }
        // What is the person's own of a draft (opening it, typing in it, saving, closing) says so on its row (`person`,
        // refused above); the rest is decided where the note is known: the action's, and for a patch the service's.
        Touches::Draft => Ok(()),
        Touches::Screen => match (&person.why, person.idle) {
            (Some(why), _) if person.busy => Err(format!("{why}; an agent doesn't move what they look at · {way}")),
            // The door's words (its dispatcher's screen rule), with its wait.
            (_, Some(idle)) if idle < crate::keys::IDLE => Err(format!("the person is at the keys (last key {:.1}s ago); try again once they've been idle {}s", idle.as_secs_f32(), crate::keys::IDLE.as_secs())),
            _ => Ok(()),
        },
    }
}

impl App {
    /// Runs one act line as `by`. The only way the window's state changes.
    pub fn act(&mut self, line: &str, by: Actor) -> Outcome {
        let req = match actline::parse(line) {
            Ok(req) => req,
            Err(why) => return self.invalid(Step { action: line.trim().to_string(), args: Map::new(), tile: None, by, ok: false, said: why.0 }),
        };
        self.act_request(req, by)
    }

    /// Runs a request already read (the control socket sends one). `as` in it names the agent.
    pub fn act_request(&mut self, req: actline::Request, by: Actor) -> Outcome {
        let by = match (&by, &req.by) { (Actor::Agent(_), Some(named)) => Actor::Agent(named.clone()), _ => by };
        let mut step = Step { action: req.action.clone(), args: req.args.clone(), tile: req.tile.clone(), by: by.clone(), ok: false, said: String::new() };
        let Some(action) = find(&req.action) else {
            let near = actline::closest(&req.action, all().map(|a| a.row.id));
            step.said = format!("no action named {}{} · `actions` lists them", req.action, near.map_or(String::new(), |near| format!("; did you mean {near}?")));
            return self.invalid(step);
        };
        let args = match actline::coerce(action.row, &req.args) {
            Ok(args) => args,
            Err(why) => { step.said = why.0; return self.invalid(step) }
        };
        step.args = args.json();
        // `tile=` is an address: the layout's one resolver says which tile it names, or why none.
        let aimed = match req.tile.as_deref() {
            None => None,
            Some(tile) => match self.tile_named(tile, &by) {
                Ok(found) => Some(found),
                Err(why) => { step.said = why; return self.invalid(step) }
            },
        };
        // A tile named for an act about a sort of tile is one of that sort, or the act is refused: it never runs in
        // another tile than the one it named.
        if let Some(named) = aimed.as_ref().filter(|named| !self.is_a(named, action.about)) {
            step.said = format!("{} is no {}: {} acts in one · name it with tile=, or leave tile= out", self.layout.name(named), action.about.said(), action.row.id);
            return self.invalid(step);
        }
        // The tile the act is about, found once (`App::target`): the one it names, else the nearest of the sort its
        // action wants. The actor is checked against this tile and the action runs in it. (An open that names none
        // is about no tile yet: where it lands is the layout's to say, and its rule keeps it off the person's tile.)
        let outer = (std::mem::replace(&mut self.st.aimed, aimed), self.st.about.take());
        let about = self.target(action.about);
        if let Err(why) = rule(action.row, &by, &self.person(), &about.as_ref().map(|tile| self.layout.name(tile)).unwrap_or_default()) {
            (self.st.aimed, self.st.about) = outer;
            step.said = why;
            return self.record(step);
        }
        self.st.about = about;
        let outcome = (action.run)(self, &args, &by);
        (self.st.aimed, self.st.about) = outer;
        // A border's drag is a run of resizes; anything else ends it.
        if !layout::resizes(action.row) { self.st.dragging = None }
        step.ok = outcome.ok;
        step.said = outcome.said.clone();
        self.said(&step);
        self.steps_mut().push(step);
        self.pump();
        outcome
    }

    /// Runs a request that comes from a tile and may name none: a button pressed in a note, a row picked in a list, a
    /// script's call, a press a drawer drew. A tile it names itself is the one it runs in (`act_request` holds it to
    /// that). Naming none, it is about the tile it comes from when its action acts in a tile of that sort (a note's
    /// button that edits, a tree's row that opens); else it names none, and is about the tile the one rule finds
    /// (`App::target`), as the same line typed in the bar would be: where a press happened is no name for a tile.
    pub fn act_from(&mut self, mut req: actline::Request, from: &str, by: Actor) -> Outcome {
        if req.tile.is_none() && let Some(action) = find(&req.action) && self.layout.named(from).is_some_and(|tile| self.is_a(&tile, action.about)) { req.tile = Some(from.to_string()) }
        self.act_request(req, by)
    }

    /// Runs a line pressed in a tile, as `act_from` runs a request: what a drawer's press is.
    pub fn act_in(&mut self, line: &str, from: &str, by: Actor) -> Outcome {
        match actline::parse(line) { Ok(req) => self.act_from(req, from, by), Err(_) => self.act(line, by) }
    }

    /// The tile an address names in this window, as `by` says it (`^` is from the tile with the person's keys):
    /// the layout's resolver, asked by every argument that names a tile.
    pub(in crate::actions) fn tile_named(&self, address: &str, by: &Actor) -> Result<String, String> {
        self.layout.resolve(address, Some(self.layout.focus.as_str()).filter(|_| by.is_person()), &self.screen.name)
    }

    /// A step that never ran, recorded with why.
    fn record(&mut self, step: Step) -> Outcome {
        let outcome = Outcome::refused(step.said.clone());
        self.said(&step);
        self.steps_mut().push(step);
        outcome
    }

    /// A request that is itself wrong: a line that doesn't read, a name nothing has, an argument that isn't one.
    fn invalid(&mut self, step: Step) -> Outcome { Outcome { kind: Some("invalid"), ..self.record(step) } }

    /// Act lines, one a line, run as the person would (a scene, a check): a blank line and a `#` line are skipped.
    /// A blocking window lands each line's answers before the next runs.
    pub fn script(&mut self, lines: &str) -> Vec<Outcome> {
        lines.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')).map(|line| {
            let outcome = self.act(line, Actor::Person);
            if self.blocking { self.settle(); }
            outcome
        }).collect()
    }
}

/// What a button that runs `line` is called: the action's menu row for those arguments, else its name.
pub fn label(line: &str) -> String {
    let Ok(req) = actline::parse(line) else { return line.to_string() };
    let Some(action) = find(&req.action) else { return req.action };
    // The row whose arguments the line gives, the most particular first: `edit.close discard=true` is Discard, not Done.
    let fits = |menu: &&row::MenuRow| menu.args().iter().all(|(k, v)| req.args.get(k).and_then(Value::as_str) == Some(v.word().as_str()));
    action.row.menu.iter().filter(fits).max_by_key(|menu| menu.args().0.len()).map_or(req.action, |menu| menu.label.to_string())
}

