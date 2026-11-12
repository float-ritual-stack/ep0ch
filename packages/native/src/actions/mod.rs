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
mod nav;
mod note;
pub mod row;
mod screen;
mod shell;
mod tile;
mod tree;

use serde_json::{Map, Value, json};

pub use app::{App, CELL, Editing, Field, Notice, Shown, TileUi, Tone, TreeLine};
pub use row::ActionRow;

use crate::actline::{self, Address, Args};
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
    pub fn line(&self) -> String { let line = actline::line_of(&self.action, &self.args); match &self.tile { Some(tile) => format!("{line} tile={}", word(tile)), None => line } }
    pub fn json(&self) -> Value { json!({ "line": self.line(), "action": self.action, "args": self.args, "tile": self.tile, "by": self.by.id(), "ok": self.ok, "said": self.said }) }
}

/// What goes on from a write's or a one-off read's answer.
pub type Then = fn(&mut App, Reply);

/// An action: what it says about itself, and what runs.
pub struct Action {
    pub row: &'static ActionRow,
    pub run: fn(&mut App, &Args, &Actor) -> Outcome,
}

static NOUNS: &[&[Action]] = &[nav::ACTIONS, note::ACTIONS, draft::ACTIONS, bar::ACTIONS, tree::ACTIONS, shell::ACTIONS, tile::ACTIONS, layout::ACTIONS, screen::ACTIONS];

/// Every action there is, in the order its noun lists it.
pub fn all() -> impl Iterator<Item = &'static Action> { NOUNS.iter().flat_map(|noun| noun.iter()) }

pub fn find(id: &str) -> Option<&'static Action> { all().find(|action| action.row.id == id) }

/// The actor rule: whether `by` may run an action that touches `touches`, given where the person is and the tile
/// the act is about. The person always may. An agent never takes the person's keys, their draft or the tile they
/// type in. (What an agent may do to the arrangement is the layout's own rule, asked by `reshape`.)
fn rule(row: &ActionRow, by: &Actor, person: &Whereabouts, tile: &str) -> Result<(), String> {
    let Actor::Agent(_) = by else { return Ok(()) };
    let way = "block.mark gets their attention";
    match row.touches {
        Touches::Nothing | Touches::Shape => Ok(()),
        Touches::Tile => {
            let typing = person.typing_in.as_deref() == Some(tile);
            let held = if row.while_ == Some(While::Typing) { typing } else { person.focus == tile || typing };
            if held { Err(format!("{}; an agent doesn't run {} there · {way}", person.why.clone().unwrap_or_else(|| format!("{} has the person's keys", person.focus)), row.id)) } else { Ok(()) }
        }
        // The draft session's rule decides, in the action: it knows which note the act is about.
        Touches::Draft => Ok(()),
        Touches::Screen => match &person.why {
            Some(why) if person.busy => Err(format!("{why}; an agent doesn't move what they look at · {way}")),
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
        // `tile=` is an address (outline-core's grammar): here, a tile of the arrangement by its name or its id.
        let aimed = match req.tile.as_deref() {
            None => None,
            Some(tile) => {
                let found = match Address::parse(tile) { Address::Name(name) | Address::Role { role: name, scope: None } => self.layout.named(&name), Address::Id(id) => Some(id).filter(|id| self.layout.spec(id).is_some()), _ => None }.or_else(|| self.layout.named(tile));
                let Some(found) = found else {
                    step.said = format!("no tile {tile} here: this window has {}", self.layout.names.0.iter().map(|(_, name)| name.as_str()).collect::<Vec<_>>().join(", "));
                    return self.invalid(step);
                };
                Some(found)
            }
        };
        // The tile a tile-touching act is about: the one it names, else the reader. An open that names none is about
        // no tile yet: where it lands is the layout's to say, and the layout's rule keeps it off the person's tile.
        let about = aimed.clone().or_else(|| if nav::placed(action.row) { None } else { self.reader() }).map(|tile| self.layout.name(&tile)).unwrap_or_default();
        if let Err(why) = rule(action.row, &by, &self.person(), &about) {
            step.said = why;
            return self.record(step);
        }
        let outer = std::mem::replace(&mut self.st.aimed, aimed);
        let outcome = (action.run)(self, &args, &by);
        self.st.aimed = outer;
        // A border's drag is a run of resizes; anything else ends it.
        if !layout::resizes(action.row) { self.st.dragging = None }
        step.ok = outcome.ok;
        step.said = outcome.said.clone();
        self.said(&step);
        self.steps_mut().push(step);
        self.pump();
        outcome
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

/// An argument's value as an act line's word.
pub fn word(value: &str) -> String { if !value.is_empty() && !value.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'' || c == '\\') { value.to_string() } else { json!(value).to_string() } }
