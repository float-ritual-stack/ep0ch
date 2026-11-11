//! ep0ch as a native window. `ep0ch-native [--ws <name>] [--machine <ssh-name>]` opens the outline the usual rule
//! names (`--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`): the tree on the left, the open note in the middle,
//! what the service knows about it on the right.
//!
//! It speaks the outline host's socket and draws what the host answers: see the README beside Cargo.toml.
//! Rune's own flags work as in any Rune app: `--snap out.png`, `--scene edit`, `--script steps.json`, `--tree`.
mod client;
mod model;
mod page;
#[cfg(test)]
mod tests;
mod view;

use std::time::Duration;

use rune::{AppSpec, Key, KeyEvent, Tx};
use rune_kit::shell;

use client::{Link, Socket};
use model::{App, Finder};

/// A link that is only ever lost: what the window has when no outline could be named, so it can say why.
struct Nowhere(Option<String>);

impl Link for Nowhere {
    fn send(&mut self, _: &serde_json::Value) {}
    fn take(&mut self) -> Vec<serde_json::Value> { self.0.take().map(client::lost).into_iter().collect() }
    fn wait(&mut self, _: &str, _: Duration) {}
}

fn init() -> App {
    let mut app = match client::resolve(rune::extra_args()) {
        Ok((socket, outline)) => {
            let path = socket.clone();
            App::new(Box::new(Socket::connect(&socket)), &outline).reconnecting(Box::new(move || Box::new(Socket::connect(&path))))
        }
        Err(why) => App::new(Box::new(Nowhere(Some(why))), ""),
    };
    // A headless render steps a virtual clock: each ask waits for its answer, so the frame drawn shows it.
    app.blocking = rune::tooling::headless_run().is_some();
    app.start();
    if app.blocking { app.settle(); }
    app
}

fn setup(s: &mut App, waker: rune::Waker) { s.set_waker(waker) }

fn poll(s: &mut App, _clock: f64, tx: &mut Tx) -> bool {
    let landed = s.take();
    // A lost link is made again, now and every two seconds until the host answers.
    if !s.online && !s.blocking {
        s.reconnect();
        tx.wake_after(Duration::from_secs(2));
    }
    landed
}

/// The window's own keys: what no focused field took.
fn on_key(s: &mut App, e: &KeyEvent, _tx: &mut Tx) -> bool {
    if shell::is_sidebar_toggle(e) { s.sidebar.toggle(); return true }
    match &e.key {
        Key::Command('k') => s.find(Finder::Find, ""),
        Key::Command('l') => s.find(Finder::Query, ""),
        Key::Command('e') => s.edit(),
        Key::Command('s') => s.save(),
        Key::Command('n') => s.new_child(),
        Key::Command('[') => s.go_back(),
        Key::Command('i') => s.inspector.toggle(),
        Key::Backspace if e.mods.cmd && s.editing.is_none() => s.trash(),
        Key::Up if e.mods.alt => s.step("up"),
        Key::Down if e.mods.alt => s.step("down"),
        Key::Right if e.mods.alt => s.step("in"),
        Key::Left if e.mods.alt => s.step("out"),
        Key::Escape if s.finder.is_some() => s.finder = None,
        Key::Escape if s.editing.is_some() => s.done_editing(),
        Key::Escape if s.notice.is_some() => s.notice = None,
        _ => return false,
    }
    true
}

// Scenes for headless renders (`--scene edit`), on the showcase outline: each acts as a person would and lands what it asked.
fn scene_edit(s: &mut App) { s.edit() }
fn scene_find(s: &mut App) { s.find(Finder::Find, "beans"); s.settle(); }
fn scene_query(s: &mut App) { s.find(Finder::Query, "type=letter"); s.settle(); }
fn scene_plan(s: &mut App) { open_found(s, "Plan for Saturday") }
fn scene_callouts(s: &mut App) { open_found(s, "Recipe callouts") }
fn scene_figures(s: &mut App) { open_found(s, "Allotment figures") }

/// Finds a note by its title and opens it, the way ⌘K does.
fn open_found(s: &mut App, title: &str) {
    s.find(Finder::Find, title);
    s.settle();
    s.cursor = s.found.get().and_then(|f| f.rows.iter().position(|r| r.title == title)).unwrap_or(0);
    s.find_open();
    s.settle();
}

fn main() {
    rune::run(AppSpec::<App> {
        min_size: Some((720.0, 420.0)),
        scenes: &[("edit", scene_edit), ("find", scene_find), ("query", scene_query), ("plan", scene_plan), ("figures", scene_figures), ("callouts", scene_callouts)],
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(on_key),
        ..AppSpec::new("ep0ch", (1180.0, 760.0), init, view::view)
    });
}
