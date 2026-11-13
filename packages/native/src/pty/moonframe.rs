//! The terminal's crates, behind the `pty` feature: Moonframe's emulator (`moonframe-terminal`, alacritty's, in
//! Rust) and the backends that keep a program (`moonframe-mux`). This file is the one place either is named: it
//! hands the window a `Term` and a `Host`, and nothing else in the window knows which crate drew a cell.
//!
//! - **Which backend** is the mux's own choice (`Preference::Auto`), by what the machine has: herdr-core (`hc`),
//!   then tmux on a server of this window's own (`tmux -L ep0ch-native`), else the login shell on a plain pty.
//!   herdr-core and tmux keep a program when the window goes, and the next launch attaches to it under the same
//!   key; a plain pty's program ends with the window. The backend's own name is said on the tile.
//! - **herdr-core is the one this is built for.** Moonframe's backend attaches (its client streams the terminal's
//!   bytes, and the core answers the program's queries); the terminal itself is started here first (`hc.rs`), so
//!   it is nobody's child, outlives what started it and starts at its tile's size, under the labels Moonframe's
//!   backend finds its own by. Where that start fails, Moonframe's own start is what runs. What each terminal
//!   reports of itself, and what else the core runs, is the core's list.
//! - **What a keeper keeps is asked off the frame** (`Kept::hear`): once when anything first reads it (so a
//!   launch lists what the one before left, with no terminal opened yet), when a terminal is opened or ended,
//!   and every little while by a thread of the host's own. A read (`listed`) is what the keeper last said and
//!   asks nobody: a tile reads it every frame, and tmux's answer is a process.
//! - **A program is the person's shell.** A tile's command is typed into it once it reads a line
//!   (`Session::type_when_ready`), and never into one found still running: whether it was is asked of what keeps
//!   it (the core's list, tmux's sessions) before it is opened, not remembered.
//! - **Only this window's are ended.** `end` ends the terminal whose labels say this app started it under that
//!   key; a terminal with other labels, or none, is listed and never touched.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use moonframe_mux::{Backends, Preference};
use moonframe_terminal::{Color, Engine, Key as ShellKey, Open, Screen, Session, Size, encode, paste as pasted};

use super::hc;
use super::{Cell, Grid, Host, Ink, Key, Listed, Look, Opened, Report, Stands, Start, Term, Wide};
use crate::client::Waker;

/// Whose programs these are: the label herdr-core's terminals carry and the tmux server they run on, apart from
/// the person's own and any other app's.
pub const NAMESPACE: &str = "ep0ch-native";
/// The labels Moonframe's herdr-core backend finds its own terminals by (its `herdr_core.rs`: the key, and the app
/// that owns it). A terminal started here carries them, so that backend attaches to it and starts no second one.
const LABEL: &str = "moonframe";
const APP: &str = "moonframe-app";
/// The backends' own names, as the mux says them.
const HERDR_CORE: &str = "herdr-core";
const TMUX: &str = "tmux";
const PTY: &str = "pty";
/// How often the core's list is asked while a window is open.
const LISTED_EVERY: Duration = Duration::from_secs(2);

/// What keeps this app's programs (the core, else its tmux server), what it last said it keeps, and the thread
/// that asks it.
struct Kept {
    namespace: String,
    endpoint: Option<hc::Endpoint>,
    backends: Backends,
    preference: Preference,
    listed: Mutex<Vec<Listed>>,
    moved: AtomicU64,
    asking: AtomicBool,
    wake: Waker,
}

impl Kept {
    /// herdr-core is the backend a terminal would open on.
    fn on_core(&self) -> bool { matches!(self.preference, Preference::Auto | Preference::HerdrCore) && self.backends.herdr_core().is_some() }

    /// tmux is the backend a terminal would open on.
    fn on_tmux(&self) -> bool { !self.on_core() && self.preference != Preference::Pty && self.backends.tmux().is_some() }

    fn tmux(&self, args: &[&str]) -> Option<String> {
        let output = Command::new(TMUX).args(["-L", &self.namespace, "-f", "/dev/null"]).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// The sessions this app's own tmux server runs, asked of it now. (No server runs when no session does.)
    fn sessions(&self) -> Vec<String> { self.tmux(&["list-sessions", "-F", "#{session_name}"]).map(|out| out.lines().map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).collect()).unwrap_or_default() }

    /// Asks what keeps the programs what it keeps now, and holds the answer: the core's terminals, else this
    /// app's tmux sessions, else nothing (a plain pty keeps none). A core that doesn't answer leaves what it last
    /// said. Never from a frame: a process is started for tmux's answer, and the core's is a round trip.
    fn hear(&self) {
        let now = if self.on_core() {
            match self.ask() { Some(terminals) => self.read(terminals), None => return }
        } else if self.on_tmux() {
            self.sessions().into_iter().map(|session| Listed { key: Some(session.clone()), address: session.clone(), name: session, backend: TMUX.to_string(), ..Listed::default() }).collect()
        } else {
            Vec::new()
        };
        self.took(now);
    }

    /// Nothing is to be heard between two opens: no core, and a tmux server that keeps nothing (it runs only what
    /// this app starts, and a start is heard as it is made).
    fn quiet(&self) -> bool { !self.on_core() && self.listed.lock().unwrap().is_empty() }

    /// The core's terminals as the window lists them: this app's by their key, everybody else's by none.
    fn read(&self, terminals: Vec<hc::Terminal>) -> Vec<Listed> {
        terminals.into_iter().map(|terminal| {
            let ours = terminal.labels.get(APP).is_some_and(|app| *app == self.namespace);
            Listed {
                key: terminal.labels.get(LABEL).filter(|_| ours).cloned(),
                name: terminal.name.clone().unwrap_or_else(|| terminal.address.clone()),
                address: terminal.address,
                runs: terminal.runs,
                cwd: Some(terminal.cwd).filter(|cwd| !cwd.is_empty()),
                report: terminal.status.map(|status| Report { state: status.state, msg: status.msg }),
                backend: HERDR_CORE.to_string(),
            }
        }).collect()
    }

    /// Asks the core now. None: no core answers (none is installed, or it is not running).
    fn ask(&self) -> Option<Vec<hc::Terminal>> { hc::Core::connect(self.endpoint.as_ref()?).and_then(|mut core| core.list()).ok() }

    fn took(&self, now: Vec<Listed>) {
        let mut listed = self.listed.lock().unwrap();
        if *listed == now { return }
        *listed = now;
        drop(listed);
        self.moved.fetch_add(1, Ordering::Relaxed);
        (self.wake)();
    }
}

pub struct Mux {
    kept: Arc<Kept>,
}

impl Mux {
    /// The terminal as a window has it: the best backend the machine has, this app's own programs.
    pub fn new(wake: Waker) -> Mux { Mux::of(NAMESPACE, Preference::Auto, wake) }

    /// The same for another namespace or one backend by name: a test's own programs, apart from the person's.
    pub fn of(namespace: &str, preference: Preference, wake: Waker) -> Mux {
        let kept = Kept { namespace: namespace.to_string(), endpoint: hc::Endpoint::found(), backends: Backends::for_app(namespace), preference, listed: Mutex::default(), moved: AtomicU64::new(0), asking: AtomicBool::new(false), wake };
        Mux { kept: Arc::new(kept) }
    }

    /// The core's terminal this app keeps under `key`, when it still runs.
    fn ours(&self, terminals: &[hc::Terminal], key: &str) -> Option<String> {
        terminals.iter().find(|terminal| terminal.labels.get(LABEL).is_some_and(|theirs| theirs == key) && terminal.labels.get(APP).is_some_and(|app| *app == self.kept.namespace)).map(|terminal| terminal.address.clone())
    }

    /// What keeps the programs is asked what it keeps: here, the first time anything reads it (a launch lists
    /// what the one before left before it opens a terminal), and every little while from then on, on a thread
    /// that ends with this host. True: it was asked just now, for the first time.
    fn hearing(&self) -> bool {
        if self.kept.asking.swap(true, Ordering::AcqRel) { return false }
        self.kept.hear();
        let kept: Weak<Kept> = Arc::downgrade(&self.kept);
        let _ = std::thread::Builder::new().name("terminal-listed".into()).spawn(move || {
            loop {
                std::thread::sleep(LISTED_EVERY);
                let Some(kept) = kept.upgrade() else { return };
                if !kept.quiet() { kept.hear() }
            }
        });
        true
    }
}

/// `~` and `~/…` as the person's home: a tile's folder is written as a person writes one.
fn expand(cwd: &str) -> PathBuf {
    match (cwd.strip_prefix("~/"), std::env::var_os("HOME")) {
        (Some(rest), Some(home)) => PathBuf::from(home).join(rest),
        (None, Some(home)) if cwd == "~" => PathBuf::from(home),
        _ => PathBuf::from(cwd),
    }
}

impl Host for Mux {
    fn open(&self, start: &Start, wake: Waker) -> Result<Opened, String> {
        let size = Size { cols: start.cols, rows: start.rows, ..Size::default() };
        let cwd = start.cwd.as_deref().map(expand);
        // Found still running, or to be started: asked of what keeps it, now.
        let mut attached = false;
        if self.kept.on_core() {
            let terminals = self.kept.ask().unwrap_or_default();
            attached = self.ours(&terminals, &start.key).is_some();
            if !attached && let Some(endpoint) = &self.kept.endpoint {
                // Started here, so it is nobody's child and outlives what started it. One this can't start is
                // Moonframe's backend's to start, as it would have.
                let labels = BTreeMap::from([(LABEL.to_string(), start.key.clone()), (APP.to_string(), self.kept.namespace.clone())]);
                let mut run = hc::Run { name: hc::name_for(&format!("{}/{}", self.kept.namespace, start.key)), cwd: cwd.as_ref().filter(|cwd| cwd.is_dir()).map(|cwd| cwd.to_string_lossy().into_owned()), labels, cols: start.cols, rows: start.rows };
                let _ = hc::Core::connect(endpoint).and_then(|mut core| core.run(&run).or_else(|_| { run.name = None; core.run(&run) }));
            }
        } else if self.kept.on_tmux() {
            attached = self.kept.sessions().iter().any(|session| *session == start.key);
        }
        let open = Open { key: start.key.clone(), cwd, size, env: Vec::new() };
        let (opened, backend) = self.kept.backends.open(self.kept.preference, &open)?;
        let moved = Arc::new(AtomicU64::new(0));
        let counted = moved.clone();
        let session = Session::start(opened, Engine::Alacritty, size, Arc::new(move || {
            counted.fetch_add(1, Ordering::Relaxed);
            wake();
        }))?;
        // (Opened on a backend other than the one asked about, what was found there says nothing of this program.)
        let attached = attached && backend != PTY;
        if !attached && let Some(command) = &start.command { session.type_when_ready(format!("{command}\r").into_bytes()) }
        // What keeps it says so from now: the list has the program before its first frame.
        if !self.hearing() { self.kept.hear() }
        // Every backend but the plain pty keeps its program when the handle goes.
        Ok(Opened { term: Box::new(MuxTerm { session, moved }), backend: backend.to_string(), keeps: backend != PTY, attached })
    }

    fn listed(&self) -> Vec<Listed> {
        self.hearing();
        self.kept.listed.lock().unwrap().clone()
    }

    fn end(&self, key: &str) {
        if self.kept.on_core() {
            let Some(endpoint) = &self.kept.endpoint else { return };
            let Ok(mut core) = hc::Core::connect(endpoint) else { return };
            let Ok(terminals) = core.list() else { return };
            // Only the terminal this app's labels name: never one somebody else started.
            if let Some(address) = self.ours(&terminals, key) { let _ = core.kill(&address); }
        } else if self.kept.on_tmux() {
            self.kept.tmux(&["kill-session", "-t", &format!("={key}")]);
        }
        self.kept.hear();
    }

    fn moved(&self) -> u64 { self.kept.moved.load(Ordering::Relaxed) }
}

struct MuxTerm {
    session: Session,
    moved: Arc<AtomicU64>,
}

fn ink(color: Color) -> Ink { match color { Color::Default => Ink::Default, Color::Rgb(r, g, b) => Ink::Rgb(r, g, b) } }

/// The emulator's screen as the window's grid: a wide character is the cell before a spacer.
fn grid_of(screen: &Screen) -> Grid {
    let cols = usize::from(screen.cols).max(1);
    let cells = screen.cells.iter().enumerate().map(|(at, cell)| {
        let leads = at % cols + 1 < cols && screen.cells.get(at + 1).is_some_and(|next| next.spacer);
        Cell {
            ch: if cell.spacer || cell.wrap_spacer { ' ' } else { cell.ch },
            wide: if cell.spacer { Wide::Tail } else if leads { Wide::Lead } else { Wide::No },
            look: Look { fg: ink(cell.fg), bold: cell.bold, italic: cell.italic, underline: cell.underline, strike: cell.strike },
            bg: ink(cell.bg),
        }
    }).collect();
    Grid { cols: screen.cols, rows: screen.rows, cells, cursor: screen.cursor }
}

impl Term for MuxTerm {
    fn grid(&self) -> Grid { grid_of(&self.session.screen()) }

    fn stands(&self) -> Stands {
        let screen = self.session.screen();
        if screen.exited { Stands::Exited } else if screen.disconnected { Stands::Lost } else { Stands::Running }
    }

    fn key(&self, key: &Key) -> bool {
        let shell = ShellKey { name: &key.name, text: key.text.as_deref(), ctrl: key.ctrl, alt: key.alt, shift: key.shift };
        match encode(shell, self.session.screen().app_cursor) {
            Some(bytes) => { Session::write(&self.session, &bytes); true }
            None => false,
        }
    }

    fn paste(&self, text: &str) { Session::write(&self.session, &pasted(text, self.session.screen().bracketed_paste)) }

    fn send(&self, text: &str) { Session::write(&self.session, text.replace('\n', "\r").as_bytes()) }

    fn fit(&self, cols: u16, rows: u16, cell: (u16, u16)) { self.session.resize(Size { cols, rows, cell_width: cell.0, cell_height: cell.1 }); }

    fn scroll(&self, lines: i32) { self.session.scroll(lines) }

    fn moved(&self) -> u64 { self.moved.load(Ordering::Relaxed) }
}
