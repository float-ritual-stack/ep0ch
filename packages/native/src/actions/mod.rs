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
mod carry;
mod draft;
mod ext;
mod layout;
mod list;
mod nav;
mod note;
mod outline;
mod review;
pub mod row;
mod screen;
mod script;
mod shell;
mod terminal;
mod tile;
mod tree;
mod window;

use serde_json::{Map, Value, json};

pub use app::{App, CELL, Field, FormUi, Notice, Said, TileUi, Tone, Ways, stays};
pub use carry::{Moving, Strip};
pub use row::ActionRow;

use crate::actline::{self, Args};
pub use crate::actline::word;
use crate::keys::Whereabouts;
use crate::layout::{Refusal, Way, held_back};
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
    /// A terminal tile: one whose kind's drawer takes the keys, and runs a program.
    Programs,
    /// A note the layout places: about no tile until it lands, unless it names the one it comes from.
    Placed,
}

impl About {
    /// How a refusal says the sort: "tree is no tile that reads notes".
    fn said(self) -> &'static str { match self { About::Notes => "tile that reads notes", About::Lists => "list", About::Tree => "list arranged as a tree", About::Drafts => "tile a block is being written in", About::Programs => "terminal tile", _ => "tile" } }
}

/// An action: what it says about itself, what runs, and the sort of tile it is about.
pub struct Action {
    pub row: &'static ActionRow,
    pub run: fn(&mut App, &Args, &Actor) -> Outcome,
    pub about: About,
}

static NOUNS: &[&[Action]] = &[nav::ACTIONS, note::ACTIONS, draft::ACTIONS, review::ACTIONS, bar::ACTIONS, tree::ACTIONS, list::ACTIONS, shell::ACTIONS, tile::ACTIONS, terminal::ACTIONS, layout::ACTIONS, carry::ACTIONS, screen::ACTIONS, script::ACTIONS, ext::ACTIONS, outline::ACTIONS, window::ACTIONS];

/// Every action there is, in the order its noun lists it.
pub fn all() -> impl Iterator<Item = &'static Action> { NOUNS.iter().flat_map(|noun| noun.iter()) }

pub fn find(id: &str) -> Option<&'static Action> { all().find(|action| action.row.id == id) }

/// Every action's row, as data (outline-core's `ActionRow`): what this window hands a list of its own keys
/// (`lists.read from=actions`), so the keys screen is made from the rows that bind the keys and from nothing else.
pub fn rows() -> &'static Value {
    static ROWS: std::sync::LazyLock<Value> = std::sync::LazyLock::new(|| all().map(|action| serde_json::to_value(action.row).unwrap_or(Value::Null)).collect());
    &ROWS
}

/// The actor rule, and the one check of who acts: whether `by` may run an action, given how they stand, what its
/// row says it touches and whose it is, where the person is and the tile the act is about. The person always may,
/// and so may an agent that stands as them (`App::stands`: the run their own press started, on its invitation; the
/// door's rule, where an invitation lifts what is the person's own too). Any other agent never runs what the row
/// says is the person's own, never takes the person's keys, their draft or the tile they type in, and waits to
/// change what they look at until they have been idle. (What an agent may do to the arrangement is the layout's own
/// rule, asked by `reshape` with the same standing.) No action refuses an agent in its own run for whose it is: it
/// says so on its row (`person`).
pub(crate) fn rule(row: &ActionRow, by: &Actor, standing: bool, person: &Whereabouts, tile: &str) -> Result<(), String> {
    let Actor::Agent(_) = by else { return Ok(()) };
    if standing { return Ok(()) }
    if let Some(theirs) = row.person { return Err(theirs.to_string()) }
    // What it does instead is an act (`attention`), worded by the one sayer as every way out is.
    let held = |reason: &str, what: &str| Err(says(&held_back(reason, what, vec![attention()]), by));
    match row.touches {
        Touches::Nothing | Touches::Shape => Ok(()),
        Touches::Tile => {
            let typing = person.typing_in.as_deref() == Some(tile);
            let theirs = if row.while_ == Some(While::Typing) { typing } else { person.focus == tile || typing };
            if theirs { held(&person.why.clone().unwrap_or_else(|| format!("{} has the person's keys", person.focus)), &format!("run {} there", row.id)) } else { Ok(()) }
        }
        // What is the person's own of a draft (opening it, typing in it, saving, closing) says so on its row (`person`,
        // refused above); the rest is decided where the note is known: the action's, and for a patch the service's.
        Touches::Draft => Ok(()),
        Touches::Screen => match person.idle {
            // Their keys are held, whatever holds them and however long ago their last key was.
            _ if person.busy => held(person.why.as_deref().unwrap_or("the person is typing"), "move what they look at"),
            // The door's words (its dispatcher's screen rule), with its wait.
            Some(idle) if idle < crate::keys::IDLE => Err(format!("the person is at the keys (last key {:.1}s ago); try again once they've been idle {}s", idle.as_secs_f32(), crate::keys::IDLE.as_secs())),
            _ => Ok(()),
        },
    }
}

/// What an agent held back for the person does here to get their attention: a comment on the note, by this
/// window's own action (its row names it; the door marks the block instead). The one namer: the actor rule says
/// it, and the layout's rules are told it (`App::asked`), so both name the same act.
pub(crate) fn attention() -> Way { Way::new(review::ATTENTION.id, "on the note gets their attention").arg("body", "…") }

/// One way out in this window's words, for `by`: None when the window has no such action (a refusal never names an
/// action that is no row here). The person reads the key this window's own table binds to the act (`keys::cap_of`),
/// with where their keys are for it to mean this, else the act line; an agent reads the act line, and for a way
/// that is the person's alone, that it is theirs, by their key. (A control a way names is the door's to draw: this
/// window draws none of them, and says none.)
fn way_said(way: &Way, by: &Actor) -> Option<String> {
    find(&way.act)?;
    let line = actline::Request { action: way.act.clone(), tile: way.tile.clone(), by: None, args: way.args.iter().cloned().collect() }.line();
    let key = crate::keys::cap_of(&way.act, &way.args);
    Some(match (by, key) {
        (Actor::Agent(_), Some(key)) if way.theirs => format!("the person's {key} ({line}) {}", way.does),
        (Actor::Agent(_), None) if way.theirs => format!("the person's {line} {}", way.does),
        (Actor::Person, Some(key)) => format!("{key}{} {}", way.at.as_ref().map_or(String::new(), |at| format!(" {at}")), way.does),
        _ => format!("{line} {}", way.does),
    })
}

/// Ways out said one after another: outline-core's `waysSaid`, held by `core-contract.json`. A way `said` has no
/// words for is left out; each follows the one before as its `then` says.
pub(crate) fn ways_said(ways: &[Way], said: impl Fn(&Way) -> Option<String>) -> String {
    let mut out = String::new();
    for way in ways {
        let Some(words) = said(way) else { continue };
        if !out.is_empty() { out.push_str(if way.then { ", then " } else { ", or " }) }
        out.push_str(&words);
    }
    out
}

/// A refusal as this window says it to `by`: its reason, then the ways out this window has. The one place a way out
/// is worded (the layout's refusals through `reshape` and an open's landing, the actor rule's own): the layout and
/// the rule name an act, and this reads the key from the window's own table.
pub(crate) fn says(why: &Refusal, by: &Actor) -> String {
    let ways = ways_said(&why.ways, |way| way_said(way, by));
    if ways.is_empty() { why.reason.clone() } else { format!("{} · {ways}", why.reason) }
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
        // A problem the notice has said for long enough to be read goes when the person next acts, unless this act
        // says something in its place (`App::read`): the refusal answered what they did then.
        let read = by.is_person().then(|| self.read(std::time::Instant::now())).flatten();
        let outcome = self.run_request(req, by);
        if let Some(read) = read { self.put_away(read) }
        outcome
    }

    fn run_request(&mut self, req: actline::Request, by: Actor) -> Outcome {
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
        if let Err(why) = rule(action.row, &by, self.stands(&by), &self.person(), &about.as_ref().map(|tile| self.layout.name(tile)).unwrap_or_default()) {
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
    /// button that edits, a tree's row that opens); about the reader that tile speaks for when it acts on a note and
    /// the tile reads none itself; else it names none, and is about the tile the one rule finds
    /// (`App::target`), as the same line typed in the bar would be: where a press happened is no name for a tile.
    pub fn act_from(&mut self, mut req: actline::Request, from: &str, by: Actor) -> Outcome {
        let about = match (find(&req.action), self.layout.named(from)) {
            (Some(action), Some(tile)) if req.tile.is_none() && self.is_a(&tile, action.about) => Some(from.to_string()),
            // A list speaks for one reader (`App::home_of`, the one answer): a press in it that acts on a note (a
            // reply, a revision put back) is about that reader, as its rows' opens land there.
            (Some(action), Some(tile)) if req.tile.is_none() && action.about == About::Notes => self.home_of(&tile).map(|home| self.layout.name(&home)),
            _ => None,
        };
        if let Some(tile) = about { req.tile = Some(tile) }
        self.act_request(req, by)
    }

    /// Whether `by` stands as the person for the act being run: the person, or an agent their press invited (the
    /// run of a button they pressed, while it carries the invitation that press minted). The one answer: the actor
    /// rule reads it, the layout is told it (`App::asked`), and an action that does something only for the person
    /// (puts the bar away, opens their editor, unfolds their tree) asks it. Who the act is recorded as is `by` itself,
    /// always: an invited script's step and its writes are the script's.
    pub fn stands(&self, by: &Actor) -> bool { by.is_person() || self.st.invited }

    /// Runs a request an agent sends on an invitation of the person's (`invited`: this window minted it and it is
    /// still its run's): for as long as it runs, the agent stands as the person. The one way an act is invited.
    pub(in crate::actions) fn act_invited(&mut self, req: actline::Request, from: Option<&str>, by: Actor, invited: bool) -> Outcome {
        let outer = std::mem::replace(&mut self.st.invited, invited);
        let outcome = match from { Some(from) => self.act_from(req, from, by), None => self.act_request(req, by) };
        self.st.invited = outer;
        outcome
    }

    /// Runs a line pressed in a tile, as `act_from` runs a request: what a drawer's press is.
    pub fn act_in(&mut self, line: &str, from: &str, by: Actor) -> Outcome {
        match actline::parse(line) { Ok(req) => self.act_from(req, from, by), Err(_) => self.act(line, by) }
    }

    /// Runs a line a press in a tile says (a button, a row, a chip a drawer drew), as the person: the tile pressed
    /// in has the keys from then, whatever in it was pressed, and then the line runs as `act_in` runs it. Rune's
    /// focus says most presses already (`keys::follow`); a press on something that takes no focus of Rune's, or
    /// whose focus names no tile, is said here, by the same act.
    pub fn pressed_in(&mut self, line: &str, from: &str) -> Outcome {
        if self.layout.named(from).is_some_and(|tile| tile != self.layout.focus) { self.act_request(actline::Request { action: tile::FOCUS.id.to_string(), tile: Some(from.to_string()), by: None, args: Map::new() }, Actor::Person); }
        self.act_in(line, from, Actor::Person)
    }

    /// The tile an address names in this window, as `by` says it (`^` is from the tile with the person's keys):
    /// the layout's resolver, asked by every argument that names a tile.
    pub(in crate::actions) fn tile_named(&self, address: &str, by: &Actor) -> Result<String, String> {
        self.layout.resolve(address, Some(self.layout.focus.as_str()).filter(|_| self.stands(by)), &self.screen.name)
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
    /// A line that says who (`as=tidy-agent`) runs as that agent, as it would over the control socket, so a scene
    /// can show what an agent does in the window. A blocking window lands each line's answers before the next runs.
    pub fn script(&mut self, lines: &str) -> Vec<Outcome> {
        lines.lines().map(str::trim).filter(|line| !line.is_empty() && !line.starts_with('#')).map(|line| {
            let by = actline::parse(line).ok().and_then(|req| req.by).map_or(Actor::Person, Actor::Agent);
            let outcome = self.act(line, by);
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

