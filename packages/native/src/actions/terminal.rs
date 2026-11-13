//! Terminal tiles: a shell or an agent beside a note. The programs themselves are the run's (`pty.rs`, held by the
//! store's hub); a tile names its program by a key, kept with the arrangement, so a tile torn into another window
//! or opened again the next launch finds the same program where its host still runs it.
//!
//! - **A kind is a row.** A tile is a terminal's when its kind's row names the drawer that takes the keys
//!   (`tiles/pty.rs`); what runs in it is its fields (`command`, `cwd`: the tile's own first, then the row's).
//!   Nothing here names a kind or a program: `terminal.open` takes the first such kind the service serves, or the
//!   first that starts with a command when it is asked for an agent.
//! - **A program starts because its tile is there** (`App::run_programs`, from what follows a change): one that
//!   came with a screen, one split off, one `terminal.open` made. Every tile of the arrangement has its program,
//!   in front or behind a tab.
//! - **The person is in a program** while its tile has the keys, it runs, and they have not stepped out
//!   (`App::in_program`, which `App::person` reads). `tile.leave` steps out and `tile.enter` back in; both are
//!   the person's. An agent sends a program text with `tile.type`, which the actor rule holds back while the
//!   person types there.
//! - **Close ends, detach keeps.** `tile.close` ends the program with its tile, on every host (the layout's rule
//!   for a tile whose program runs, the door's by contract: the person's close ends it, an agent's is refused).
//!   `terminal.detach` closes the tile and keeps the program: herdr-core and tmux run it on past the window, and
//!   the next launch finds it; on a plain pty it runs until the window ends, and the tile said so before anybody
//!   relied on it. `terminal.attach` gives a program with no tile one again; `terminal.jump` goes to one from the
//!   list. The window going ends nothing a host keeps.
//! - **Only this window's.** What a host runs that this window never started (the person's other work in
//!   herdr-core) is listed and never ended, typed into or given a tile from here.
//!
//! The names the door has for the same act are the door's (`tile.enter`, `tile.leave`, `tile.type`,
//! `tile.restart`), so a line reads in both.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{About, Action, Actor, App, Notice, Outcome};
use crate::actline::Args;
use crate::layout::{At, Dir, Id, Op, TileSpec};
use crate::pty;
use crate::screen::KindRow;

/// A terminal tile's fields: the line typed into its shell, the folder it starts in, and the machine that folder
/// is on when the service serves the program (an extension's own).
const COMMAND: &str = "command";
const CWD: &str = "cwd";
const HOST: &str = "host";

static OPEN: ActionRow = ActionRow::new("terminal.open", Touches::Shape, "a terminal beside the note (tile=, else the reader the open note is in): a new tile on its right, or under the terminal already there, your shell in it. agent=true opens the first kind that starts with a command of its own (an agent); kind= names the kind; command= types another line into the shell, cwd= starts it in a folder. The person's takes their keys into it")
    .args(&[
        ("agent", ArgSpec::flag("the first terminal kind that starts with a command of its own, in place of the shell").optional()),
        ("kind", ArgSpec::text("the tile's kind, when not the first a terminal draws").optional().kind("tile-kind")),
        ("command", ArgSpec::text("a line typed into the shell once it reads one, in place of the kind's own").optional()),
        ("cwd", ArgSpec::text("the folder it starts in (default: your home)").optional()),
        ("name", ArgSpec::text("the new tile's name (default its kind, numbered)").optional()),
        ("dir", ArgSpec::text("the side of the reader the new tile goes on (default: under the terminal that is there, else on the reader's right)").optional().choices(&["right", "down", "left", "up"])),
    ])
    .keys(&[KeyRow::keys("mod+j", "a shell beside the note"), KeyRow::with("mod+shift+j", None, "an agent beside the note", &[("agent", Scalar::Flag(true))])])
    .menu(&[MenuRow::new("Shell", "Terminal", Some("mod+j")), MenuRow::with("Agent", "Terminal", Some("mod+shift+j"), &[("agent", Scalar::Flag(true))])])
    .examples(&[
        Example { act: "terminal.open", does: "your shell in a tile beside the note", safe: None },
        Example { act: "terminal.open agent=true cwd=~/plots", does: "an agent beside the note, started in the plots folder", safe: None },
    ]);

static ENTER: ActionRow = ActionRow::new("tile.enter", Touches::Screen, "type in a terminal tile (tile=, else the one with the keys, else the first): every key but the one that leaves goes to its program. The person's only: an agent's would take their keys (tile.type sends a program text)")
    .person("typing in a terminal tile takes the person's keys; an agent sends it text with tile.type")
    .keys(&[KeyRow::on("ctrl+]", "tile", "into the terminal: every key goes to its program"), KeyRow::via("a press in a terminal tile")])
    .menu(&[MenuRow::new("Type", "Terminal", Some("ctrl+]"))])
    .examples(&[Example { act: "tile.enter tile=shell", does: "the person's keys go to the shell's program until the key that leaves", safe: Some(true) }]);

static LEAVE: ActionRow = ActionRow::new("tile.leave", Touches::Screen, "back to the window from the terminal tile the person types in: the tile keeps the keys, and they are the window's again. The person's only")
    .person("the person's keys are theirs: an agent doesn't take them out of a terminal tile")
    .keys(&[KeyRow::on("ctrl+]", "program", "back to the window's own keys")])
    .menu(&[MenuRow::new("Leave", "Terminal", Some("ctrl+]"))]);

static TYPE: ActionRow = ActionRow::new("tile.type", Touches::Tile, "send text=<text> to the program in a terminal tile (tile=, else the one with the keys, else the first), as typed keys (\\n is Return, \\e Escape). Refused to an agent for the terminal the person is typing in")
    .typing()
    .args(&[("text", ArgSpec::text("what to type; \\n for Return, \\e for Escape"))])
    .keys(&[KeyRow::via("an agent's way to a program; the person types in the tile")])
    .examples(&[Example { act: "tile.type text=\"seeds list\\\\n\" tile=shell", does: "types seeds list and Return into the shell", safe: None }]);

static RESTART: ActionRow = ActionRow::new("tile.restart", Touches::Tile, "run a terminal tile's program again (tile=, else the one with the keys, else the first), once it has ended or never started: the same kind, the same line typed into a new shell")
    .typing()
    .keys(&[KeyRow::via("the button on a terminal whose program ended")])
    .menu(&[MenuRow::new("Run it again", "Terminal", None)])
    .examples(&[Example { act: "tile.restart tile=shell", does: "a new shell in the tile whose shell exited", safe: None }]);

static DETACH: ActionRow = ActionRow::new("terminal.detach", Touches::Shape, "close a terminal tile (tile=, else the one with the keys, else the first) and leave its program running: it is listed with no tile, and terminal.jump or terminal.attach gives it one again. A program herdr-core or tmux keeps is found by the next launch too; one on a plain pty ends with the window (tile.close ends a program with its tile)")
    .keys(&[KeyRow::on("ctrl+backslash", "program", "detach: close the tile, the program runs on"), KeyRow::via("its row in the bar")])
    .menu(&[MenuRow::new("Detach", "Terminal", None)])
    .examples(&[Example { act: "terminal.detach tile=agent", does: "the agent's tile closes and the agent keeps working", safe: None }]);

static ATTACH: ActionRow = ActionRow::new("terminal.attach", Touches::Shape, "a tile for a program that runs in none: key= names it, as the programs list does (lists.read from=programs); the tile goes beside the note (tile=, else the reader the open note is in)")
    .args(&[("key", ArgSpec::text("the program, by its key")), ("dir", ArgSpec::text("the side of the reader the tile goes on (default: under the terminal that is there, else on the reader's right)").optional().choices(&["right", "down", "left", "up"]))])
    .keys(&[KeyRow::via("terminal.jump does it for a program with no tile; the notice of a detach has its button")])
    .menu(&[MenuRow::new("Attach", "Terminal", None)])
    .examples(&[Example { act: "terminal.attach key=garden-2", does: "the program garden-2 in a tile beside the note", safe: None }]);

static JUMP: ActionRow = ActionRow::new("terminal.jump", Touches::Screen, "go to a program: key= names it, as the programs list does. The keys go to its tile, and one that runs in no tile is given one beside the note first. What a row of the programs list runs. The person's only")
    .person("the person's keys are theirs: an agent never moves them · terminal.attach key=… gives a program a tile")
    .args(&[("key", ArgSpec::text("the program, by its key"))])
    .keys(&[KeyRow::via("a press on a row of the programs list (bar.open scope=programs)")])
    .examples(&[Example { act: "terminal.jump key=garden-2", does: "the keys go to the agent's tile", safe: Some(true) }]);

static SCROLL: ActionRow = ActionRow::new("terminal.scroll", Touches::Tile, "move a terminal tile's view through what scrolled off (tile=, else the one with the keys, else the first): lines= how many, negative up")
    .typing()
    .args(&[("lines", ArgSpec::number("how many lines down; negative is up"))])
    .keys(&[
        KeyRow::with("shift+pageup", Some("program"), "up through what scrolled off", &[("lines", Scalar::Whole(-12))]),
        KeyRow::with("shift+pagedown", Some("program"), "back down", &[("lines", Scalar::Whole(12))]),
        KeyRow::via("the wheel over a terminal tile"),
    ])
    .examples(&[Example { act: "terminal.scroll lines=-12 tile=shell", does: "twelve lines up the shell's scrollback", safe: Some(true) }]);

static PASTE: ActionRow = ActionRow::new("terminal.paste", Touches::Tile, "paste into the program of the terminal tile the person types in (tile= names another): the clipboard's words, wrapped so the program knows they were not typed where it asks for that; text= pastes those words instead. The person's only: the clipboard is theirs")
    .person("the clipboard is the person's: an agent sends a program text with tile.type")
    .args(&[("text", ArgSpec::text("what to paste, in place of the clipboard's words").optional())])
    .keys(&[KeyRow::on("mod+shift+v", "program", "paste the clipboard into the program")])
    .menu(&[MenuRow::new("Paste", "Terminal", Some("mod+shift+v"))]);

static FIT: ActionRow = ActionRow::new("terminal.fit", Touches::Tile, "fit a terminal tile's program to a size in cells (tile=, else the one with the keys, else the first): what the tile does itself as it is laid out")
    .typing()
    .args(&[("cols", ArgSpec::number("columns")), ("rows", ArgSpec::number("rows")), ("cw", ArgSpec::number("a cell's width in points").optional()), ("ch", ArgSpec::number("a cell's height in points").optional())])
    .keys(&[KeyRow::via("the tile's own size, as it is laid out")])
    .examples(&[Example { act: "terminal.fit cols=96 rows=30 tile=shell", does: "the shell's program is told its screen is 96 columns by 30 rows", safe: None }]);

pub static ACTIONS: &[Action] = &[
    Action { row: &OPEN, run: open, about: About::Notes },
    Action { row: &ENTER, run: enter, about: About::Programs },
    Action { row: &LEAVE, run: leave, about: About::Programs },
    Action { row: &TYPE, run: type_, about: About::Programs },
    Action { row: &RESTART, run: restart, about: About::Programs },
    Action { row: &DETACH, run: detach, about: About::Programs },
    Action { row: &ATTACH, run: attach, about: About::Notes },
    Action { row: &JUMP, run: jump, about: About::Nothing },
    Action { row: &SCROLL, run: scroll, about: About::Programs },
    Action { row: &PASTE, run: paste, about: About::Programs },
    Action { row: &FIT, run: fit, about: About::Programs },
];

/// A key's stem from an outline's name: letters, digits and `-`, as every host that keeps programs can name one.
fn stem(outline: &str) -> String {
    let slug: String = outline.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    if slug.trim_matches('-').is_empty() { "window".to_string() } else { slug }
}

impl App {
    /// The kinds a terminal draws, as the service serves them, in its order.
    fn terminal_kinds(&self) -> impl Iterator<Item = &KindRow> { self.kinds().iter().filter(|row| crate::tiles::drawer_of(row).is_some_and(|drawer| drawer.takes_keys)) }

    /// A terminal tile's program, as its drawer reads it. None: the tile has none yet.
    pub fn program_of(&self, tile: &str) -> Option<pty::Shown> { self.store.program(self.ui(tile).program.as_deref()?) }

    /// The terminal tile whose program the person's keys are in: the tile with the keys, when it is a terminal's,
    /// its program runs and they have not stepped out of it. `App::person` asks this and nothing else decides it.
    pub fn in_program(&self) -> Option<Id> {
        let focus = &self.layout.focus;
        if self.out_of.as_ref() == Some(focus) || !self.is_a(focus, About::Programs) { return None }
        let key = self.ui(focus).program.as_deref()?;
        self.store.program_runs(key).then(|| focus.clone())
    }

    /// What a terminal tile's program starts with, as its tile and its kind's row say.
    fn wanted(&self, tile: &str, key: &str, by: &str) -> pty::Wanted {
        let field = |name: &str| self.field_of(tile, name).and_then(Value::as_str).map(str::to_string).filter(|said| !said.is_empty());
        let name = self.kind_of(tile).map(|row| row.name.clone()).filter(|name| !name.is_empty()).unwrap_or_else(|| self.layout.name(tile));
        // A program the service serves is a folder on the service's machine: a window on another machine's
        // outline has no such folder, and says so in place of starting something else by that line here.
        let unavailable = field(HOST).filter(|_| !self.at.machine.is_empty()).map(|host| format!("Its program is on {host}, where this outline's service runs: a terminal here would start it on this machine."));
        pty::Wanted { key: key.to_string(), name, kind: self.spec(tile).map(|spec| spec.kind.clone()).unwrap_or_default(), command: field(COMMAND), cwd: field(CWD), by: by.to_string(), unavailable }
    }

    /// Every terminal tile of the arrangement has its program: one with no key is given one, one nothing holds is
    /// started (or found still running, where its host keeps it), and the run is told which tile shows which. What
    /// follows from a tile being there, not an act: `by` is who made the tile, as a step names an actor.
    pub(in crate::actions) fn run_programs(&mut self, by: &str) {
        let mut placed = Vec::new();
        let mut minted = false;
        for tile in self.layout.all() {
            if !self.is_a(&tile, About::Programs) { continue }
            let key = match self.ui(&tile).program.clone() {
                Some(key) => key,
                None => {
                    let key = self.store.program_key(&stem(&self.at.outline));
                    self.ui_mut(&tile).program = Some(key.clone());
                    minted = true;
                    key
                }
            };
            if !self.store.holds_program(&key) { let want = self.wanted(&tile, &key, by); self.store.program_start(want); }
            placed.push((key, self.layout.name(&tile)));
        }
        self.store.programs_placed(placed);
        if minted { self.keep() }
    }

    /// A key the person pressed while in a program: sent to it. The key table's hand (`keys::press`).
    pub fn keyed(&mut self, key: pty::Key) {
        let Some(program) = self.in_program().and_then(|tile| self.ui(&tile).program.clone()) else { return };
        self.store.program_do(&program, |term| { term.key(&key); });
    }

    /// The run's programs have something new to show since the window last looked: what a frame is drawn for
    /// when nothing the service said landed. The lists of them are asked again as they now stand.
    pub fn ran(&mut self) -> bool {
        let now = self.store.programs_moved();
        if now == self.programs_seen { return false }
        self.st.programs_seen = now;
        self.pump();
        true
    }

    /// The tile a paste was asked into with no words of its own, once: the clipboard is read for it (`keys::effects`).
    pub fn pasting(&mut self) -> Option<Id> { self.st.pasting.take() }

    /// The clipboard's words, for the tile that asked: pasted into its program.
    pub fn pasted(&mut self, tile: &str, text: &str) {
        let Some(program) = self.ui(tile).program.clone() else { return };
        if !text.is_empty() { self.store.program_do(&program, |term| term.paste(text)); }
    }

    /// A tile's program ends as its tile closes, wherever it runs: on a plain pty with its handle, and where a
    /// host keeps it (herdr-core, tmux) by that host's own way to end one. A tile of another window that shows
    /// the same program is left with one that ended, and says so.
    pub(in crate::actions) fn program_closed(&mut self, key: &str) { self.store.program_end(key); }

    /// Closes a tile and ends nothing: its program runs on (a tile detached, a tile torn into another window).
    /// The layout's rule about a tile whose program a close would end is not asked of this close.
    pub(in crate::actions) fn close_keeping(&mut self, tile: Id, by: &Actor) -> Outcome {
        self.st.detaching = Some(tile.clone());
        let closed = self.reshape(&Op::Close { tile, gone: false, heir: false }, by);
        self.st.detaching = None;
        closed
    }
}

/// The terminal tile an act is about: the one the dispatcher found (aimed at, else with the keys, else the first).
fn target(app: &App) -> Result<Id, Outcome> { app.about().ok_or_else(|| Outcome::refused("no terminal tile here · terminal.open opens one beside the note")) }

/// The tile's program, by its key.
fn program(app: &App, tile: &str) -> Result<String, Outcome> { app.ui(tile).program.clone().ok_or_else(|| Outcome::refused(format!("{} has no program yet", app.layout.name(tile)))) }

/// The tile a new terminal goes beside: the reader the act is about (the one named, else the one the open note is
/// in: the dispatcher's answer), else the tile with the keys where no tile reads notes.
fn beside(app: &App) -> Id { app.about().unwrap_or_else(|| app.layout.focus.clone()) }

/// A terminal tile of `kind` opened beside the note, for the program `key` when it is for one that runs already.
fn open_tile(app: &mut App, kind: &str, fields: Vec<(&str, String)>, name: Option<&str>, dir: Option<Dir>, key: Option<&str>, by: &Actor) -> Outcome {
    // Where it goes: the side named (`dir=`), of the reader the act is about; unsaid, under the terminal that is
    // there already (a shell and an agent beside a note are a column of two, not the note cut in four), else on
    // that reader's right.
    // (Never under the terminal the person types in, for an agent: that tile is theirs to resize.)
    let theirs = app.in_program().filter(|_| !app.stands(by));
    let stacked = || app.layout.all().into_iter().filter(|tile| app.is_a(tile, About::Programs) && Some(tile) != theirs.as_ref()).next_back();
    let (target, dir) = match dir { Some(dir) => (beside(app), dir), None => stacked().map_or_else(|| (beside(app), Dir::Right), |under| (under, Dir::Down)) };
    // Named as its kind is, without its extension's name before it: `shell`, then `shell2`.
    let name = name.map(str::to_string).unwrap_or_else(|| app.layout.auto_name(kind.rsplit('.').next().unwrap_or(kind), &[]));
    let mut spec = TileSpec::new(name.clone(), kind.to_string());
    for (field, said) in fields { spec.fields.insert(field.to_string(), json!(said)); }
    let opened = app.reshape(&Op::Open { tile: spec, name: Some(name.clone()), loose: false, alt: false, deliberate: None, at: At::Split { target, dir, pair: false, weight: None }, keys: app.stands(by), link: None, verb: None, select_from: Vec::new() }, by);
    if !opened.ok { return opened }
    // (A tile made here is named, and its name is its id.)
    let tile = name.clone();
    if app.spec(&tile).is_none() { return opened }
    if let Some(key) = key { app.ui_mut(&tile).program = Some(key.to_string()) }
    app.run_programs(&by.id());
    app.keep();
    let shown = app.program_of(&tile);
    Outcome::answer(json!({ "tile": name, "program": shown.as_ref().map(|p| p.key.clone()), "backend": shown.as_ref().map(|p| p.backend.clone()), "keeps": shown.as_ref().map(|p| p.keeps), "state": shown.as_ref().map(|p| p.stands.word().to_string()) }))
}

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let kinds = || app.terminal_kinds().map(|row| row.written().to_string()).collect::<Vec<_>>().join(", ");
    let starts = |row: &&KindRow| row.fields.get(COMMAND).and_then(Value::as_str).is_some_and(|line| !line.is_empty());
    let row = match (args.text("kind"), args.flag("agent") == Some(true)) {
        (Some(asked), _) => match app.kind_row(asked).filter(|row| app.terminal_kinds().any(|theirs| theirs.kind == row.kind)) { Some(row) => row, None => return Outcome::refused(format!("{asked} is no kind a terminal draws here · the kinds: {}", kinds())) },
        (None, true) => match app.terminal_kinds().find(starts) { Some(row) => row, None => return Outcome::refused("no terminal kind here starts with a command of its own: name one with command=, or a kind with kind=") },
        (None, false) => match app.terminal_kinds().find(|row| !starts(row)).or_else(|| app.terminal_kinds().next()) { Some(row) => row, None => return Outcome::refused("no tile kind here is a terminal's: an extension serves them (bar.open scope=extensions)") },
    };
    let kind = row.written().to_string();
    let fields: Vec<(&str, String)> = [(COMMAND, args.text("command")), (CWD, args.text("cwd"))].into_iter().filter_map(|(field, said)| said.map(|said| (field, said.to_string()))).collect();
    open_tile(app, &kind, fields, args.text("name"), args.text("dir").and_then(Dir::read), None, by)
}

fn enter(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let name = app.layout.name(&tile);
    if !app.program_of(&tile).is_some_and(|program| program.stands.running()) { return Outcome::refused(format!("{name}'s program is not running · tile.restart tile={name} runs it again")) }
    app.st.out_of = None;
    if app.layout.focus != tile { let focused = app.reshape(&Op::Focus { tile, quiet: false }, by); if !focused.ok { return focused } }
    Outcome::answer(json!({ "tile": name }))
}

fn leave(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    let Some(tile) = app.in_program() else { return Outcome::refused("the keys are in no program") };
    app.st.out_of = Some(tile.clone());
    Outcome::answer(json!({ "tile": app.layout.name(&tile) }))
}

fn type_(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let text = args.text("text").unwrap_or("").to_string();
    if text.is_empty() { return Outcome::refused("tile.type sends text: text=<what to type>") }
    if !app.store.program_runs(&key) { return Outcome::refused(format!("{}'s program is not running", app.layout.name(&tile))) }
    // As the door reads the same line: `\n` is Return and `\e` Escape (an act line's words carry no control character).
    let keys = text.replace("\\n", "\n").replace("\\e", "\x1b");
    app.store.program_do(&key, |term| term.send(&keys));
    Outcome::answer(json!({ "tile": app.layout.name(&tile), "chars": text.chars().count() }))
}

fn restart(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let name = app.layout.name(&tile);
    if app.store.program_runs(&key) { return Outcome::refused(format!("{name}'s program is running: it is run again once it has ended")) }
    app.store.program_end(&key);
    app.run_programs(&by.id());
    Outcome::answer(json!({ "tile": name, "program": key, "state": app.program_of(&tile).map(|program| program.stands.word().to_string()) }))
}

fn detach(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let name = app.layout.name(&tile);
    let shown = app.store.program(&key);
    let closed = app.close_keeping(tile, by);
    if !closed.ok { return closed }
    // The program is held, with no tile: it is the run's to say which tile shows which.
    app.run_programs(&by.id());
    let (backend, keeps) = shown.map_or((String::new(), false), |program| (program.backend, program.keeps));
    // What keeps the program has it from here: the window lets go of its stream, as a viewer that detaches does.
    // (A plain pty's program is its handle: held, it runs until the window ends.)
    if keeps { app.store.program_release(&key); app.run_programs(&by.id()); app.keep(); }
    // How long it runs on is said before anybody relies on it, with the act that gives it a tile again.
    if app.stands(by) {
        let said = if keeps { format!("{name}'s program runs on, kept by {backend}: the next launch finds it too.") } else { format!("{name}'s program runs on until this window ends: nothing keeps it after.") };
        app.st.notice = Some(Notice { undo: Some(format!("terminal.attach key={}", super::word(&key))), ..Notice::info(said) });
    }
    Outcome::answer(json!({ "tile": name, "program": key, "backend": backend, "keeps": keeps }))
}

/// A tile for the program `key`, when it runs in none: of the kind it was started as (kept with the arrangement,
/// so the launch after knows it too), or the first kind a terminal draws for one nothing here remembers.
fn tile_for(app: &mut App, key: &str, dir: Option<Dir>, by: &Actor) -> Outcome {
    if let Some((window, tile)) = app.store.program_place(key) { return Outcome::refused(match window { Some(window) => format!("{key} is in {tile}, in the window {window}"), None => format!("{key} is in {tile} already") }) }
    if !app.store.knows_program(key) { return Outcome::refused(format!("no program {key} runs here · bar.open scope=programs lists the ones that do")) }
    let made = app.store.program_made(key);
    let first = || app.terminal_kinds().find(|row| row.fields.get(COMMAND).is_none()).or_else(|| app.terminal_kinds().next()).map(|row| row.written().to_string());
    let Some(kind) = made.as_ref().map(|made| made.kind.clone()).filter(|kind| app.kind_row(kind).is_some()).or_else(first) else { return Outcome::refused("no tile kind here is a terminal's: an extension serves them (bar.open scope=extensions)") };
    // The tile says what its program was started with, so what it shows of itself is what runs.
    let (command, cwd) = made.map_or((None, None), |made| (made.command, made.cwd));
    let fields: Vec<(&str, String)> = [(COMMAND, command), (CWD, cwd)].into_iter().filter_map(|(field, said)| said.map(|said| (field, said))).collect();
    open_tile(app, &kind, fields, None, dir, Some(key), by)
}

fn attach(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let key = args.text("key").unwrap_or("").to_string();
    tile_for(app, &key, args.text("dir").and_then(Dir::read), by)
}

fn jump(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let key = args.text("key").unwrap_or("").to_string();
    match app.store.program_place(&key) {
        Some((Some(window), tile)) => Outcome::refused(format!("{key} is in {tile}, in the window {window}: its keys are that window's")),
        Some((None, tile)) => {
            let id = match app.tile_named(&tile, by) { Ok(id) => id, Err(why) => return Outcome::refused(why) };
            app.st.out_of = None;
            let focused = if app.layout.focus == id { Outcome::done() } else { app.reshape(&Op::Focus { tile: id, quiet: false }, by) };
            if focused.ok { Outcome::answer(json!({ "tile": tile, "program": key })) } else { focused }
        }
        None => tile_for(app, &key, None, by),
    }
}

fn scroll(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let lines = args.number("lines").unwrap_or(0.0).round() as i32;
    app.store.program_do(&key, |term| term.scroll(lines));
    Outcome::answer(json!({ "tile": app.layout.name(&tile), "lines": lines }))
}

fn paste(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let name = app.layout.name(&tile);
    if !app.store.program_runs(&key) { return Outcome::refused(format!("{name}'s program is not running")) }
    match args.text("text") {
        Some(text) => { let text = text.to_string(); app.store.program_do(&key, |term| term.paste(&text)); }
        // The clipboard is read where the window's hands are, on the next frame.
        None => app.st.pasting = Some(tile.clone()),
    }
    Outcome::answer(json!({ "tile": name }))
}

fn fit(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let key = match program(app, &tile) { Ok(key) => key, Err(no) => return no };
    let cells = |name: &str, most: f64| args.number(name).map(|n| n.round().clamp(1.0, most) as u16);
    let (Some(cols), Some(rows)) = (cells("cols", 500.0), cells("rows", 300.0)) else { return Outcome::refused("terminal.fit names a size: cols= and rows=") };
    let cell = (cells("cw", 200.0).unwrap_or(8), cells("ch", 200.0).unwrap_or(16));
    app.store.program_do(&key, |term| term.fit(cols, rows, cell));
    Outcome::answer(json!({ "tile": app.layout.name(&tile), "cols": cols, "rows": rows }))
}
