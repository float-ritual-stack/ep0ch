//! A scripted terminal host: it runs nothing. Each program is a made-up shell that plays a script: what its screen
//! shows when it starts, what scrolled off above, and what it prints when a line is typed. A scene draws one (a
//! headless render has no pty to wait on, and a picture of a real one would never be the same twice), and the
//! window's tests drive one: keys in, rows out, a size, the scrollback, a program that outlives its window.
//!
//! The script is JSON, so a scene's is a file beside its act lines:
//!
//! ```json
//! { "backend": "herdr-core", "keeps": true,
//!   "prompt": [{ "t": "plot", "fg": "#98c379", "bold": true }, " $ "],
//!   "above": [["sown: 12 rows"]],
//!   "screen": [[{ "t": "畑", "wide": true }, " north bed"]],
//!   "replies": { "seeds": [["carrots  3 packets"], ["leeks    1 packet"]] },
//!   "reports": { "seedbot --plan beds": { "state": "working", "msg": "planning the beds" } },
//!   "others": [{ "address": "t4", "name": "watering", "runs": "tail -f watering.log", "status": "idle" }] }
//! ```
//!
//! A line is its runs; a run is a string, or `{t, fg, bg, bold, italic, underline, strike, wide}` (`wide`: each of
//! its characters takes two columns, as a terminal's emulator would say of them: nothing here measures a
//! character). `exit` typed ends the program. `reports`: what a program says of itself once a line is typed into
//! it (as an agent reports its status to what keeps it; a line with none clears it, as a shell back at its prompt
//! does). `others`: terminals the made-up host runs that this window never started.
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::{Cell, Grid, Host, Ink, Key, Listed, Look, Opened, Report, Stands, Start, Term, Wide};
use crate::client::Waker;

type Line = Vec<Cell>;

fn ink(v: &Value) -> Ink {
    let hex = v.as_str().unwrap_or("").trim_start_matches('#');
    let part = |at: usize| hex.get(at..at + 2).and_then(|pair| u8::from_str_radix(pair, 16).ok());
    match (part(0), part(2), part(4)) { (Some(r), Some(g), Some(b)) if hex.len() == 6 => Ink::Rgb(r, g, b), _ => Ink::Default }
}

/// A line of a script, as cells.
fn line(runs: &Value) -> Line {
    let mut cells = Vec::new();
    for run in runs.as_array().into_iter().flatten() {
        let flag = |name: &str| run[name].as_bool().unwrap_or(false);
        let text = run.as_str().or_else(|| run["t"].as_str()).unwrap_or("");
        let look = Look { fg: ink(&run["fg"]), bold: flag("bold"), italic: flag("italic"), underline: flag("underline"), strike: flag("strike") };
        let (bg, wide) = (ink(&run["bg"]), flag("wide"));
        for ch in text.chars() {
            cells.push(Cell { ch, wide: if wide { Wide::Lead } else { Wide::No }, look, bg });
            if wide { cells.push(Cell { ch: ' ', wide: Wide::Tail, look, bg }) }
        }
    }
    cells
}

fn lines(v: &Value) -> Vec<Line> { v.as_array().into_iter().flatten().map(line).collect() }

fn plain(text: &str) -> Line { text.chars().map(|ch| Cell { ch, ..Cell::default() }).collect() }

fn report(v: &Value) -> Report { Report { state: v["state"].as_str().unwrap_or("").to_string(), msg: v["msg"].as_str().unwrap_or("").to_string() } }

/// What a made-up shell plays.
#[derive(Clone, Default)]
pub struct Script {
    prompt: Line,
    above: Vec<Line>,
    screen: Vec<Line>,
    replies: BTreeMap<String, Vec<Line>>,
    reports: BTreeMap<String, Report>,
    others: Vec<Listed>,
}

impl Script {
    pub fn read(v: &Value) -> Script {
        Script {
            prompt: if v["prompt"].is_array() { line(&v["prompt"]) } else { plain("$ ") },
            above: lines(&v["above"]), screen: lines(&v["screen"]),
            replies: v["replies"].as_object().into_iter().flatten().map(|(typed, said)| (typed.clone(), lines(said))).collect(),
            reports: v["reports"].as_object().into_iter().flatten().map(|(typed, said)| (typed.clone(), report(said))).collect(),
            others: v["others"].as_array().into_iter().flatten().map(|other| {
                let word = |name: &str| other[name].as_str().unwrap_or("").to_string();
                Listed { key: None, address: word("address"), name: word("name"), runs: word("runs"), cwd: other["cwd"].as_str().map(str::to_string), report: other["status"].as_str().map(|state| Report { state: state.to_string(), msg: word("says") }), backend: v["backend"].as_str().unwrap_or("scripted").to_string() }
            }).collect(),
        }
    }
}

/// One made-up program: everything it has printed, what is typed on its line, and what it was sent.
struct Play {
    script: Script,
    /// Every line printed, the ones that scrolled off first.
    printed: Vec<Line>,
    typing: String,
    cols: u16,
    rows: u16,
    /// How many lines up the view is from the newest.
    up: usize,
    stands: Stands,
    /// What it was sent, in order: a key by its name or its text, a paste, text sent as keys.
    heard: Vec<String>,
    /// What it says of itself now: the script's word for the last line typed into it.
    report: Option<Report>,
    /// The folder it was started in.
    cwd: Option<String>,
}

impl Play {
    fn new(script: &Script, start: &Start) -> Play {
        let mut play = Play { script: script.clone(), printed: script.above.iter().chain(&script.screen).cloned().collect(), typing: String::new(), cols: start.cols.max(1), rows: start.rows.max(1), up: 0, stands: Stands::Running, heard: Vec::new(), report: None, cwd: start.cwd.clone() };
        // The line its tile starts it with is typed into it, as a terminal types one into a shell.
        if let Some(command) = &start.command { play.heard.push(format!("line:{command}")); play.types(command); play.enter(); }
        play
    }

    fn types(&mut self, text: &str) { self.typing.push_str(text) }

    /// Return: the line as typed joins what was printed, then what the script says it prints.
    fn enter(&mut self) {
        let typed = std::mem::take(&mut self.typing);
        self.printed.push(self.script.prompt.iter().copied().chain(plain(&typed)).collect());
        self.report = self.script.reports.get(typed.trim()).cloned();
        if typed.trim() == "exit" { self.stands = Stands::Exited; return }
        if let Some(said) = self.script.replies.get(typed.trim()) { self.printed.extend(said.iter().cloned()) }
        self.up = 0;
    }

    fn key(&mut self, key: &Key) -> bool {
        if !self.stands.running() { return false }
        match (key.name.as_str(), &key.text) {
            ("enter", _) => self.enter(),
            ("backspace", _) => { self.typing.pop(); }
            ("d", _) if key.ctrl && self.typing.is_empty() => self.stands = Stands::Exited,
            (_, Some(text)) if !key.ctrl && !key.alt => self.types(text),
            _ => {}
        }
        true
    }

    fn grid(&self) -> Grid {
        let (cols, rows) = (usize::from(self.cols), usize::from(self.rows));
        // The line being typed is the newest, while the program runs.
        let live: Option<Line> = self.stands.running().then(|| self.script.prompt.iter().copied().chain(plain(&self.typing)).collect());
        let all: Vec<&Line> = self.printed.iter().chain(live.as_ref()).collect();
        let till = all.len().saturating_sub(self.up);
        let from = till.saturating_sub(rows);
        let mut grid = Grid::blank(self.cols, self.rows);
        for (row, cells) in all[from..till].iter().enumerate() {
            for (col, cell) in cells.iter().take(cols).enumerate() { grid.cells[row * cols + col] = *cell }
            // A wide character cut by the edge leaves a blank, as a terminal wraps it.
            if cells.len() > cols && cells[cols - 1].wide == Wide::Lead { grid.cells[row * cols + cols - 1] = Cell { bg: cells[cols - 1].bg, ..Cell::default() } }
        }
        if let Some(live) = live.filter(|_| self.up == 0) { grid.cursor = Some((live.len().min(cols.saturating_sub(1)) as u16, (till - from).saturating_sub(1) as u16)) }
        grid
    }
}

struct Shared {
    play: Mutex<Play>,
    moved: AtomicU64,
}

/// A handle on a made-up program.
struct CannedTerm {
    shared: Arc<Shared>,
    wake: Waker,
}

impl CannedTerm {
    fn change<T>(&self, change: impl FnOnce(&mut Play) -> T) -> T {
        let out = change(&mut self.shared.play.lock().unwrap());
        self.shared.moved.fetch_add(1, Ordering::Relaxed);
        (self.wake)();
        out
    }
}

impl Term for CannedTerm {
    fn grid(&self) -> Grid { self.shared.play.lock().unwrap().grid() }
    fn stands(&self) -> Stands { self.shared.play.lock().unwrap().stands.clone() }
    fn key(&self, key: &Key) -> bool {
        self.change(|play| {
            play.heard.push(match &key.text { Some(text) if !key.ctrl && !key.alt => text.clone(), _ => format!("{}{}{}{}", if key.ctrl { "ctrl+" } else { "" }, if key.alt { "alt+" } else { "" }, if key.shift { "shift+" } else { "" }, key.name) });
            play.key(key)
        })
    }
    fn paste(&self, text: &str) { self.change(|play| { play.heard.push(format!("paste:{text}")); play.types(text) }) }
    fn send(&self, text: &str) {
        self.change(|play| {
            play.heard.push(format!("send:{text}"));
            for (n, part) in text.split('\n').enumerate() {
                if n > 0 { play.enter() }
                play.types(part);
            }
        })
    }
    fn fit(&self, cols: u16, rows: u16, _: (u16, u16)) { self.change(|play| { play.cols = cols.max(1); play.rows = rows.max(1); }) }
    fn scroll(&self, lines: i32) {
        self.change(|play| {
            let most = (play.printed.len() + 1).saturating_sub(usize::from(play.rows));
            play.up = (play.up as i64 - i64::from(lines)).clamp(0, most as i64) as usize;
        })
    }
    fn moved(&self) -> u64 { self.shared.moved.load(Ordering::Relaxed) }
}

/// The programs a scripted host has started, by key: a test's second look at what one was sent, and what a host
/// that keeps programs still runs when its window is gone.
#[derive(Clone, Default)]
pub struct Running(Arc<Mutex<BTreeMap<String, Arc<Shared>>>>);

impl Running {
    /// What the program `key` was sent, in order.
    #[cfg(test)]
    pub fn heard(&self, key: &str) -> Vec<String> { self.0.lock().unwrap().get(key).map(|shared| shared.play.lock().unwrap().heard.clone()).unwrap_or_default() }
    #[cfg(test)]
    pub fn keys(&self) -> Vec<String> { self.0.lock().unwrap().keys().cloned().collect() }
}

/// A host of made-up programs. `keeps`: its programs outlive their handles, as herdr-core's do, and are found again
/// by their keys (by this host, or by another made over the same `Running`: the next launch).
pub struct Canned {
    script: Script,
    backend: String,
    keeps: bool,
    running: Running,
    moved: Arc<AtomicU64>,
}

impl Canned {
    /// The host a script describes: `backend` names what it stands in for, `keeps` whether that outlives a window.
    pub fn read(v: &Value) -> Canned { Canned::over(v, Running::default()) }

    /// The same, over programs already running: what the launch after finds.
    pub fn over(v: &Value, running: Running) -> Canned {
        Canned { script: Script::read(v), backend: v["backend"].as_str().unwrap_or("scripted").to_string(), keeps: v["keeps"].as_bool().unwrap_or(false), running, moved: Arc::default() }
    }

    #[cfg(test)]
    pub fn running(&self) -> Running { self.running.clone() }
}

impl Host for Canned {
    fn open(&self, start: &Start, wake: Waker) -> Result<Opened, String> {
        let mut running = self.running.0.lock().unwrap();
        // One that still runs is attached to as it is; one that ended, or that nothing kept, starts over.
        let kept = running.get(&start.key).filter(|shared| self.keeps && shared.play.lock().unwrap().stands.running()).cloned();
        let attached = kept.is_some();
        let shared = kept.unwrap_or_else(|| Arc::new(Shared { play: Mutex::new(Play::new(&self.script, start)), moved: AtomicU64::new(0) }));
        running.insert(start.key.clone(), shared.clone());
        self.moved.fetch_add(1, Ordering::Relaxed);
        Ok(Opened { term: Box::new(CannedTerm { shared, wake }), backend: self.backend.clone(), keeps: self.keeps, attached })
    }

    fn listed(&self) -> Vec<Listed> {
        let ours = self.running.0.lock().unwrap().iter().filter_map(|(key, shared)| {
            let play = shared.play.lock().unwrap();
            // What a host keeps is what runs: one that ended is no terminal of its own any more.
            (self.keeps && play.stands.running()).then(|| Listed { key: Some(key.clone()), address: key.clone(), name: key.clone(), runs: play.heard.iter().find_map(|heard| heard.strip_prefix("line:")).unwrap_or("").to_string(), cwd: play.cwd.clone(), report: play.report.clone(), backend: self.backend.clone() })
        }).collect::<Vec<_>>();
        ours.into_iter().chain(self.script.others.iter().cloned()).collect()
    }

    fn end(&self, key: &str) {
        if let Some(shared) = self.running.0.lock().unwrap().get(key) { shared.play.lock().unwrap().stands = Stands::Exited }
        self.moved.fetch_add(1, Ordering::Relaxed);
    }

    fn moved(&self) -> u64 { self.moved.load(Ordering::Relaxed) + self.running.0.lock().unwrap().values().map(|shared| shared.moved.load(Ordering::Relaxed)).sum::<u64>() }
}
