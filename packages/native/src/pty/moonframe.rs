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
//!   reports of itself, and what else the core runs, is the core's list, asked on a thread of its own.
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

/// What the core keeps, as it last said, and the thread that asks.
struct Kept {
    namespace: String,
    endpoint: Option<hc::Endpoint>,
    listed: Mutex<Vec<Listed>>,
    moved: AtomicU64,
    asking: AtomicBool,
    wake: Waker,
}

impl Kept {
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
    backends: Backends,
    preference: Preference,
    kept: Arc<Kept>,
}

impl Mux {
    /// The terminal as a window has it: the best backend the machine has, this app's own programs.
    pub fn new(wake: Waker) -> Mux { Mux::of(NAMESPACE, Preference::Auto, wake) }

    /// The same for another namespace or one backend by name: a test's own programs, apart from the person's.
    pub fn of(namespace: &str, preference: Preference, wake: Waker) -> Mux {
        let kept = Kept { namespace: namespace.to_string(), endpoint: hc::Endpoint::found(), listed: Mutex::default(), moved: AtomicU64::new(0), asking: AtomicBool::new(false), wake };
        Mux { backends: Backends::for_app(namespace), preference, kept: Arc::new(kept) }
    }

    /// herdr-core is the backend a terminal would open on.
    fn on_core(&self) -> bool { matches!(self.preference, Preference::Auto | Preference::HerdrCore) && self.backends.herdr_core().is_some() }

    /// tmux is the backend a terminal would open on.
    fn on_tmux(&self) -> bool { !self.on_core() && self.preference != Preference::Pty && self.backends.tmux().is_some() }

    fn tmux(&self, args: &[&str]) -> Option<String> {
        let output = Command::new(TMUX).args(["-L", &self.kept.namespace, "-f", "/dev/null"]).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// The sessions this app's own tmux server runs. (No server runs when no session does.)
    fn sessions(&self) -> Vec<String> { self.tmux(&["list-sessions", "-F", "#{session_name}"]).map(|out| out.lines().map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).collect()).unwrap_or_default() }

    /// The core's terminal this app keeps under `key`, when it still runs.
    fn ours(&self, terminals: &[hc::Terminal], key: &str) -> Option<String> {
        terminals.iter().find(|terminal| terminal.labels.get(LABEL).is_some_and(|theirs| theirs == key) && terminal.labels.get(APP).is_some_and(|app| *app == self.kept.namespace)).map(|terminal| terminal.address.clone())
    }

    /// The core is asked for its list every little while from now on, on a thread that ends with this host.
    fn keep_asking(&self) {
        if self.kept.asking.swap(true, Ordering::AcqRel) { return }
        let kept: Weak<Kept> = Arc::downgrade(&self.kept);
        let _ = std::thread::Builder::new().name("terminal-listed".into()).spawn(move || {
            loop {
                std::thread::sleep(LISTED_EVERY);
                let Some(kept) = kept.upgrade() else { return };
                if let Some(terminals) = kept.ask() { let now = kept.read(terminals); kept.took(now) }
            }
        });
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
        if self.on_core() {
            let terminals = self.kept.ask().unwrap_or_default();
            attached = self.ours(&terminals, &start.key).is_some();
            if !attached && let Some(endpoint) = &self.kept.endpoint {
                // Started here, so it is nobody's child and outlives what started it. One this can't start is
                // Moonframe's backend's to start, as it would have.
                let labels = BTreeMap::from([(LABEL.to_string(), start.key.clone()), (APP.to_string(), self.kept.namespace.clone())]);
                let mut run = hc::Run { name: hc::name_for(&format!("{}/{}", self.kept.namespace, start.key)), cwd: cwd.as_ref().filter(|cwd| cwd.is_dir()).map(|cwd| cwd.to_string_lossy().into_owned()), labels, cols: start.cols, rows: start.rows };
                let _ = hc::Core::connect(endpoint).and_then(|mut core| core.run(&run).or_else(|_| { run.name = None; core.run(&run) }));
            }
        } else if self.on_tmux() {
            attached = self.sessions().iter().any(|session| *session == start.key);
        }
        let open = Open { key: start.key.clone(), cwd, size, env: Vec::new() };
        let (opened, backend) = self.backends.open(self.preference, &open)?;
        let moved = Arc::new(AtomicU64::new(0));
        let counted = moved.clone();
        let session = Session::start(opened, Engine::Alacritty, size, Arc::new(move || {
            counted.fetch_add(1, Ordering::Relaxed);
            wake();
        }))?;
        // (Opened on a backend other than the one asked about, what was found there says nothing of this program.)
        let attached = attached && backend != PTY;
        if !attached && let Some(command) = &start.command { session.type_when_ready(format!("{command}\r").into_bytes()) }
        if backend == HERDR_CORE {
            if let Some(terminals) = self.kept.ask() { let now = self.kept.read(terminals); self.kept.took(now) }
            self.keep_asking();
        }
        // Every backend but the plain pty keeps its program when the handle goes.
        Ok(Opened { term: Box::new(MuxTerm { session, moved }), backend: backend.to_string(), keeps: backend != PTY, attached })
    }

    fn listed(&self) -> Vec<Listed> {
        let mut listed = self.kept.listed.lock().unwrap().clone();
        if self.on_tmux() { listed.extend(self.sessions().into_iter().map(|session| Listed { key: Some(session.clone()), address: session.clone(), name: session, backend: TMUX.to_string(), ..Listed::default() })) }
        listed
    }

    fn end(&self, key: &str) {
        if self.on_core() {
            let Some(endpoint) = &self.kept.endpoint else { return };
            let Ok(mut core) = hc::Core::connect(endpoint) else { return };
            let Ok(terminals) = core.list() else { return };
            // Only the terminal this app's labels name: never one somebody else started.
            if let Some(address) = self.ours(&terminals, key) { let _ = core.kill(&address); }
            if let Ok(terminals) = core.list() { let now = self.kept.read(terminals); self.kept.took(now) }
        } else if self.on_tmux() {
            self.tmux(&["kill-session", "-t", &format!("={key}")]);
        }
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
