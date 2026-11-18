//! Programs in terminal tiles: the model. No renderer's type and no emulator's is named here, so the same state
//! is drawn by `tiles/pty.rs` today and could be by another renderer, and a build without the terminal's crates
//! holds, lists and draws programs all the same (a scripted host's: `canned.rs`).
//!
//! - **A `Grid` is what a program's screen is now**: cells on a column grid, a wide character its lead cell and a
//!   tail, and the cursor. `cut` is how a row is drawn: stretches of one-column cells, each wide character a piece
//!   of its own two cells wide, and the runs of background behind them (PROBES §7: one text a row drifts off the
//!   columns after a wide character; rows cut there do not).
//! - **A `Term` is one program's handle**: its grid, how it stands, and the ways in (a key, a paste, text sent as
//!   keys, a size, the scrollback). A `Host` opens them: the terminal's crates behind the `pty` feature
//!   (`moonframe.rs`: herdr-core when the machine has `hc`, then tmux, else a plain pty), a scripted one for a
//!   scene and the tests, and `Unbuilt`, which says the window was built without one.
//! - **`Programs` is the run's registry**, held by the store's hub so the windows of a run share it: a tile names
//!   its program by a key, and a tile torn into another window, or closed and opened again, finds the same program.
//!   A program whose host keeps it running (herdr-core, tmux) is found again by the next launch under the same key.
//! - **What a host keeps is the host's to say** (`Host::listed`): every live terminal it knows, the ones this
//!   window's key names (`key`) and the ones somebody else started (none: the person's other work, which is
//!   listed and never ended from here). How a program stands by its own word (`Report`: idle, working, done,
//!   blocked, error) is what it reported to its host, passed on; nothing here reads a screen to guess one.
//! - **What is listed is the programs' own word** (`said`): the window hands it to `lists.read from=programs`, which
//!   writes the rows (the service keeps no registry of programs; where each runs is this machine's to know).
pub mod canned;
#[cfg(feature = "pty")]
pub mod hc;
#[cfg(feature = "pty")]
pub mod moonframe;

use serde_json::{Value, json};

use crate::client::Waker;

/// A colour a cell asks for. `Default`: the theme's own ink, or its ground.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Ink {
    #[default]
    Default,
    Rgb(u8, u8, u8),
}

/// How a cell sits on the column grid.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Wide {
    /// One column.
    #[default]
    No,
    /// The first of the two columns a wide character takes.
    Lead,
    /// The second: nothing is drawn from it.
    Tail,
}

/// What a stretch of cells looks like, apart from its ground.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Look {
    pub fg: Ink,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Cell {
    pub ch: char,
    pub wide: Wide,
    pub look: Look,
    pub bg: Ink,
}

impl Default for Cell {
    fn default() -> Cell { Cell { ch: ' ', wide: Wide::No, look: Look::default(), bg: Ink::Default } }
}

impl Cell {
    /// Nothing is drawn from it: a space on the theme's ground with no line through or under it.
    fn blank(&self) -> bool { self.ch == ' ' && self.bg == Ink::Default && !self.look.underline && !self.look.strike }
}

/// A program's screen: `rows` rows of `cols` cells, row after row, and where the cursor is when it shows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Grid {
    pub cols: u16,
    pub rows: u16,
    pub cells: Vec<Cell>,
    /// Column and row.
    pub cursor: Option<(u16, u16)>,
}

impl Grid {
    pub fn blank(cols: u16, rows: u16) -> Grid { Grid { cols, rows, cells: vec![Cell::default(); usize::from(cols) * usize::from(rows)], cursor: None } }

    pub fn row(&self, row: u16) -> &[Cell] {
        let start = usize::from(row) * usize::from(self.cols);
        self.cells.get(start..start + usize::from(self.cols)).unwrap_or(&[])
    }

    /// A row's text: a wide character once, the blanks after its last word left off.
    pub fn text(&self, row: u16) -> String { self.row(row).iter().filter(|cell| cell.wide != Wide::Tail).map(|cell| cell.ch).collect::<String>().trim_end().to_string() }

    /// Every row's text down to the last row with any: what `peek` says a terminal shows.
    pub fn lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = (0..self.rows).map(|row| self.text(row)).collect();
        while lines.last().is_some_and(String::is_empty) { lines.pop(); }
        lines
    }
}

/// A piece of a row, drawn as one text: `cols` columns wide from column `col`, whatever its glyphs measure. `wide`:
/// it is one wide character, in a box of its own two cells. `looks`: the byte ranges of `text` that share a look.
#[derive(Clone, Debug, PartialEq)]
pub struct Stretch {
    pub col: u16,
    pub cols: u16,
    pub text: String,
    pub looks: Vec<(usize, usize, Look)>,
    pub wide: bool,
}

/// A run of cells on one ground that is not the theme's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ground {
    pub col: u16,
    pub cols: u16,
    pub ink: (u8, u8, u8),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Cut {
    pub stretches: Vec<Stretch>,
    pub grounds: Vec<Ground>,
}

/// A row cut where a wide character sits: each stretch of one-column cells is one piece, each wide character a
/// piece two cells wide, so the piece after it starts on its own column. A stretch of nothing but blanks is no
/// piece. A cell's ground is a rect of its own behind the text, a run a ground.
pub fn cut(row: &[Cell]) -> Cut {
    let mut out = Cut::default();
    let mut at = 0;
    while at < row.len() {
        if let Ink::Rgb(r, g, b) = row[at].bg {
            let mut end = at + 1;
            while end < row.len() && row[end].bg == row[at].bg { end += 1 }
            out.grounds.push(Ground { col: at as u16, cols: (end - at) as u16, ink: (r, g, b) });
            at = end;
        } else {
            at += 1;
        }
    }
    let mut at = 0;
    while at < row.len() {
        let wide = row[at].wide == Wide::Lead;
        let mut end = at + if wide { 2 } else { 1 };
        while !wide && end < row.len() && row[end].wide == Wide::No { end += 1 }
        let end = end.min(row.len());
        let cells = &row[at..end];
        if cells.iter().any(|cell| !cell.blank()) {
            let (mut text, mut looks): (String, Vec<(usize, usize, Look)>) = (String::new(), Vec::new());
            for cell in cells.iter().filter(|cell| cell.wide != Wide::Tail) {
                let start = text.len();
                // A cell is one column: a control character would take the text to a tab stop, or nowhere.
                text.push(if cell.ch.is_control() { ' ' } else { cell.ch });
                match looks.last_mut() { Some((_, till, look)) if *look == cell.look => *till = text.len(), _ => looks.push((start, text.len(), cell.look)) }
            }
            out.stretches.push(Stretch { col: at as u16, cols: (end - at) as u16, text, looks, wide });
        }
        at = end;
    }
    out
}

/// How a program stands.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Stands {
    Running,
    /// It ended.
    Exited,
    /// Its output ended and nothing confirms it did: what keeps it may still run it.
    Lost,
    /// It never started: why.
    Failed(String),
}

impl Stands {
    /// As a list says it: one word, or why it never started.
    pub fn word(&self) -> &str { match self { Stands::Running => "running", Stands::Exited => "exited", Stands::Lost => "lost", Stands::Failed(why) => why } }
    pub fn running(&self) -> bool { *self == Stands::Running }
}

/// A key as a program is sent one: its name (`enter`, `up`, `a`), the text it types when it types any, and what
/// was held with it. How it is written to the program is the terminal's own (its emulator's modes say).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Key {
    pub name: String,
    pub text: Option<String>,
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
}

/// One program's handle. Every way in takes `&self`: a terminal reads and writes on threads of its own, and the
/// window reaches one only through the store (`Store::program_do`, from an action or the key table's hand).
pub trait Term {
    /// Its screen now.
    fn grid(&self) -> Grid;
    fn stands(&self) -> Stands;
    /// A key the person pressed. False: the terminal has nothing to send for it.
    fn key(&self, key: &Key) -> bool;
    /// Text pasted: wrapped so the program knows it was not typed, where it asked for that.
    fn paste(&self, text: &str);
    /// Text as typed keys, a newline the Return key: what an agent sends a program.
    fn send(&self, text: &str);
    /// The size its tile gives it, in cells, and a cell's in points.
    fn fit(&self, cols: u16, rows: u16, cell: (u16, u16));
    /// Lines up (negative) or down through what scrolled off.
    fn scroll(&self, lines: i32);
    /// Counts every change of what it shows: what a tile's drawing is versioned by.
    fn moved(&self) -> u64;
}

/// What a host is asked to start, or to find still running.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Start {
    /// The program's name between launches: a host that keeps programs finds one again by it.
    pub key: String,
    /// A line typed into the shell once it reads one, when the program is started: never into one found still
    /// running (which of the two it was is the host's to know, and to say: `Opened::attached`). None: the shell alone.
    pub command: Option<String>,
    /// The folder it starts in. None: the person's home.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

pub struct Opened {
    pub term: Box<dyn Term>,
    /// What runs it, in that backend's own name.
    pub backend: String,
    /// The program outlives the window: the next launch finds it under the same key.
    pub keeps: bool,
    /// It was found still running, and nothing was typed into it.
    pub attached: bool,
}

/// What a program says of itself, as its host passes it on: the word (`idle`, `working`, `done`, `blocked`,
/// `error`) and what it adds to it. A program that reports nothing has none; no screen is read for one.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Report {
    pub state: String,
    pub msg: String,
}

/// A live terminal a host keeps, held by this run or not.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct Listed {
    /// The key this window's programs are kept under, when it is one of them. None: somebody else started it.
    pub key: Option<String>,
    /// What its host calls it (`t7`, a name): how the person reaches it with the host's own tools.
    pub address: String,
    pub name: String,
    /// What runs in it now, as the host says: the program in front, else what it was started with.
    pub runs: String,
    pub cwd: Option<String>,
    pub report: Option<Report>,
    /// The host's own name (`herdr-core`, `tmux`).
    pub backend: String,
}

/// What runs the programs.
pub trait Host {
    /// Starts the program kept as `start.key`, or attaches to it when it still runs (and types nothing into it).
    /// `wake` is called, from any thread, whenever it has something new to show.
    fn open(&self, start: &Start, wake: Waker) -> Result<Opened, String>;
    /// Every live terminal it keeps, held here or not: what a launch finds from the one before, and what else runs
    /// on the machine beside it. As it last heard (a host that asks a server asks it off the window's thread).
    fn listed(&self) -> Vec<Listed>;
    /// Ends the program kept as `key`, wherever it runs: one this window's key names, never another's.
    fn end(&self, key: &str);
    /// Counts every change of what `listed` answers.
    fn moved(&self) -> u64 { 0 }
}

/// The host of a window built without its terminal: it opens nothing, and says so.
pub struct Unbuilt;

/// What a tile says where no terminal is built in. (How one is built in is the kind's own row to say: the
/// extension's description of the kind, drawn under this.)
pub const UNBUILT: &str = "The terminal is not built into this window.";

impl Host for Unbuilt {
    fn open(&self, _: &Start, _: Waker) -> Result<Opened, String> { Err(UNBUILT.to_string()) }
    fn listed(&self) -> Vec<Listed> { Vec::new() }
    fn end(&self, _: &str) {}
}

/// The host this build has: the terminal's crates when it was built with them, else none. `wake` is called when
/// what the host keeps changed (a program somebody else started, a report).
pub fn host(wake: Waker) -> Box<dyn Host> {
    #[cfg(feature = "pty")]
    { Box::new(moonframe::Mux::new(wake)) }
    #[cfg(not(feature = "pty"))]
    { let _ = wake; Box::new(Unbuilt) }
}

/// A program as the run holds it.
pub struct Program {
    pub key: String,
    /// What it is called: its tile's kind, in the kind's own word.
    pub name: String,
    /// The kind of tile it was started for, as a screen writes it: what a tile made for it again is.
    pub kind: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub backend: String,
    pub keeps: bool,
    /// Who started it, as a step records an actor.
    pub by: String,
    /// It was found still running, and nothing was typed into it.
    pub attached: bool,
    failed: Option<String>,
    term: Option<Box<dyn Term>>,
}

impl Program {
    pub fn stands(&self) -> Stands {
        match (&self.failed, &self.term) { (Some(why), _) => Stands::Failed(why.clone()), (None, Some(term)) => term.stands(), (None, None) => Stands::Lost }
    }
}

/// What a program was started as: the kind of its tile and what was typed into it. Kept when its handle goes (a
/// tile detached where a host keeps the program) and between launches, so a tile made for it again is of its kind
/// and says its line.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Made {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
}

impl Made {
    pub fn json(&self) -> Value { json!({ "key": self.key, "name": self.name, "kind": self.kind, "command": self.command, "cwd": self.cwd }) }
    pub fn read(v: &Value) -> Option<Made> {
        let text = |name: &str| v[name].as_str().map(str::to_string);
        Some(Made { key: text("key")?, name: text("name").unwrap_or_default(), kind: text("kind").unwrap_or_default(), command: text("command"), cwd: text("cwd") })
    }
}

/// What a program is to start with, as its tile says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Wanted {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub by: String,
    /// Why it can't run here, when the tile's own fields say so (its program is another machine's).
    pub unavailable: Option<String>,
}

/// One program as a drawer reads it: what it says of itself and its screen now.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub key: String,
    pub name: String,
    pub command: Option<String>,
    pub backend: String,
    pub keeps: bool,
    pub attached: bool,
    pub stands: Stands,
    /// What it reported of itself to its host, as the host last said.
    pub report: Option<Report>,
    pub grid: Grid,
    pub moved: u64,
}

/// What keeps a program, and for how long, as its tile and a list of programs say it: said before anybody relies
/// on it either way. The one wording of it.
pub fn kept_said(backend: &str, keeps: bool) -> String {
    if backend.is_empty() { String::new() } else if keeps { format!("{backend} · outlives this window") } else { format!("{backend} · ends with this window") }
}

/// What a tile says of a program that was found still running, from a launch before or another tile.
pub const FOUND: &str = "found running: nothing was typed into it";

impl Shown {
    pub fn kept_said(&self) -> String { kept_said(&self.backend, self.keeps) }
}

/// The size a program starts at, until its tile has been laid out.
pub const FIRST: (u16, u16) = (80, 24);

/// The programs of a run.
pub struct Programs {
    host: Box<dyn Host>,
    list: Vec<Program>,
    /// Where each program shows: its key, the window and the tile.
    places: Vec<(String, String, String)>,
    /// Counts the programs started and let go.
    changed: u64,
    /// What each program this run has known was started as, held or not.
    known: Vec<Made>,
}

impl Default for Programs {
    fn default() -> Programs { Programs::on(Box::new(Unbuilt)) }
}

impl Programs {
    pub fn on(host: Box<dyn Host>) -> Programs { Programs { host, list: Vec::new(), places: Vec::new(), changed: 0, known: Vec::new() } }

    pub fn get(&self, key: &str) -> Option<&Program> { self.list.iter().find(|program| program.key == key) }

    /// A handle is held on the program `key`.
    pub fn holds(&self, key: &str) -> bool { self.get(key).is_some() }

    /// The host keeps a program running under `key`, held here or not.
    pub fn kept(&self, key: &str) -> bool { self.host.listed().iter().any(|kept| kept.key.as_deref() == Some(key)) }

    /// A key nothing has: `<stem>-<n>`, the first free.
    pub fn free_key(&self, stem: &str) -> String {
        let kept = self.host.listed();
        (1..).map(|n| format!("{stem}-{n}")).find(|key| !self.holds(key) && !kept.iter().any(|kept| kept.key.as_deref() == Some(key.as_str()))).unwrap_or_default()
    }

    /// Starts `want`, or attaches to it where the host still runs it (nothing is typed into a program found
    /// running). One already held is left as it is. A program that can't start is held all the same, with why.
    pub fn start(&mut self, want: Wanted, wake: Waker) {
        if self.holds(&want.key) { return }
        let start = Start { key: want.key.clone(), command: want.command.clone(), cwd: want.cwd.clone(), cols: FIRST.0, rows: FIRST.1 };
        let opened = match &want.unavailable { Some(why) => Err(why.clone()), None => self.host.open(&start, wake) };
        let (term, backend, keeps, attached, failed) = match opened { Ok(opened) => (Some(opened.term), opened.backend, opened.keeps, opened.attached, None), Err(why) => (None, String::new(), false, false, Some(why)) };
        self.remember(Made { key: want.key.clone(), name: want.name.clone(), kind: want.kind.clone(), command: want.command.clone(), cwd: want.cwd.clone() });
        self.list.push(Program { key: want.key, name: want.name, kind: want.kind, command: want.command, cwd: want.cwd, backend, keeps, by: want.by, attached, failed, term });
        self.changed += 1;
    }

    /// What the program `key` was started as, as this run or the launch before knew it.
    pub fn made(&self, key: &str) -> Option<&Made> { self.known.iter().find(|made| made.key == key) }

    /// What a program was started as, to be known from now (a program started; what the launch before kept).
    pub fn remember(&mut self, made: Made) {
        self.known.retain(|known| known.key != made.key);
        self.known.push(made);
    }

    /// What each program was started as, for every one this run has known and not ended: what the arrangement's
    /// file keeps, so the launch after makes a tile of its kind for one its host still runs.
    pub fn known(&self) -> Vec<Made> { self.known.clone() }

    /// Lets go of a program's handle and leaves it running where its host keeps it: one on a plain pty ends with
    /// its handle, one herdr-core or tmux keeps runs on and is listed as kept.
    pub fn release(&mut self, key: &str) -> Option<Program> {
        let at = self.list.iter().position(|program| program.key == key)?;
        let program = self.list.remove(at);
        self.places.retain(|(theirs, _, _)| theirs != key);
        self.changed += 1;
        Some(Program { term: None, ..program })
    }

    /// Ends a program: its handle is let go and its host is told to end it, so one the host would keep is gone
    /// too. Only a program this run holds or its host lists under this window's key: nothing else is ever ended.
    pub fn end(&mut self, key: &str) -> Option<Program> {
        let held = self.release(key);
        if held.is_some() || self.kept(key) { self.host.end(key) }
        self.known.retain(|known| known.key != key);
        self.changed += 1;
        held
    }

    /// A way into a program, by its handle. False: nothing is held under `key`, or it never started.
    pub fn with(&self, key: &str, run: impl FnOnce(&dyn Term)) -> bool {
        match self.get(key).and_then(|program| program.term.as_deref()) { Some(term) => { run(term); true } None => false }
    }

    pub fn shown(&self, key: &str) -> Option<Shown> {
        let program = self.get(key)?;
        let (grid, moved) = program.term.as_deref().map_or((Grid::default(), 0), |term| (term.grid(), term.moved()));
        let report = self.host.listed().into_iter().find(|kept| kept.key.as_deref() == Some(key)).and_then(|kept| kept.report);
        Some(Shown { key: program.key.clone(), name: program.name.clone(), command: program.command.clone(), backend: program.backend.clone(), keeps: program.keeps, attached: program.attached, stands: program.stands(), report, grid, moved })
    }

    /// The tiles of `window` that show a program now, each its program's key and its own name.
    pub fn place(&mut self, window: &str, tiles: Vec<(String, String)>) {
        let before = self.places.clone();
        self.places.retain(|(_, theirs, _)| theirs != window);
        self.places.extend(tiles.into_iter().map(|(key, tile)| (key, window.to_string(), tile)));
        if before != self.places { self.changed += 1 }
    }

    /// The tile a program shows in: its window and the tile's name.
    pub fn place_of(&self, key: &str) -> Option<(&str, &str)> { self.places.iter().find(|(theirs, _, _)| theirs == key).map(|(_, window, tile)| (window.as_str(), tile.as_str())) }

    /// Counts every change of what any program shows, of which there are and of what the host keeps.
    pub fn moved(&self) -> u64 { self.changed + self.host.moved() + self.list.iter().map(|program| program.term.as_deref().map_or(0, |term| term.moved())).sum::<u64>() }

    /// Every program as it says of itself, for the window `asker`: the ones held, in the order they started, then
    /// the ones the host keeps running under this window's keys that nothing here holds (a launch before left
    /// them), then what else the host runs (`mine: false`: listed, and reached with the host's own tools). The
    /// shape `lists.read from=programs` is handed.
    pub fn said(&self, asker: &str) -> Value {
        let kept = self.host.listed();
        let report = |row: &mut Value, report: &Option<Report>| if let Some(report) = report { row["status"] = json!(report.state); if !report.msg.is_empty() { row["says"] = json!(report.msg) } };
        let held = self.list.iter().map(|program| {
            let mut row = json!({ "key": program.key, "name": program.name, "state": program.stands().word() });
            if let Some(command) = &program.command { row["command"] = json!(command) }
            if let Some(cwd) = &program.cwd { row["cwd"] = json!(cwd) }
            // Who started it, when that was an agent: the person's own are theirs without saying.
            if program.by.starts_with("agent:") { row["by"] = json!(program.by) }
            if !program.backend.is_empty() { row["backend"] = json!(program.backend); row["keeps"] = json!(program.keeps); row["kept"] = json!(kept_said(&program.backend, program.keeps)); }
            if let Some(theirs) = kept.iter().find(|kept| kept.key.as_deref() == Some(program.key.as_str())) { report(&mut row, &theirs.report) }
            if let Some((window, tile)) = self.place_of(&program.key) {
                row["tile"] = json!(tile);
                if window != asker { row["window"] = json!(window) }
            }
            row
        });
        // (This window's before anybody else's, each in the order its host lists them.)
        let loose = kept.iter().filter(|kept| kept.key.as_deref().is_some_and(|key| !self.holds(key)));
        let rest = loose.chain(kept.iter().filter(|kept| kept.key.is_none())).map(|kept| {
            // One of this window's is called what it was started as, where that is known; else, and for what
            // somebody else started, what its host calls it and says runs in it.
            let made = kept.key.as_deref().and_then(|key| self.made(key));
            let mut row = json!({ "key": kept.key.clone().unwrap_or_default(), "name": made.map_or(&kept.name, |made| &made.name), "state": Stands::Running.word(), "backend": kept.backend, "keeps": true, "kept": kept_said(&kept.backend, true) });
            if let Some(command) = made.map(|made| made.command.clone()).unwrap_or_else(|| Some(kept.runs.clone()).filter(|runs| !runs.is_empty())) { row["command"] = json!(command) }
            if let Some(cwd) = made.and_then(|made| made.cwd.clone()).or_else(|| kept.cwd.clone()) { row["cwd"] = json!(cwd) }
            report(&mut row, &kept.report);
            if kept.key.is_none() { row["mine"] = json!(false); row["address"] = json!(kept.address); }
            row
        });
        held.chain(rest).collect()
    }
}
