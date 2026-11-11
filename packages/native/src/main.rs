//! ep0ch as a native window. `ep0ch-native [--ws <name>] [--machine <ssh-name>]` opens the outline the usual rule
//! names (`--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`): the tree on the left, the open note in the middle,
//! what the service knows about it on the right.
//!
//! The window draws and the bridge (`bridge/main.ts`, run with bun) reads: see the README beside Cargo.toml.
//! Rune's own flags work as in any Rune app: `--snap out.png`, `--scene edit`, `--script steps.json`, `--tree`.
mod bridge;
mod model;
#[cfg(test)]
mod tests;
mod view;

use rune::{AppSpec, Key, KeyEvent, Tx};
use rune_kit::shell;

use bridge::Bridge;
use model::{App, Finder};

/// Where the bridge is: `EP0CH_NATIVE_BRIDGE`, else the one beside this crate's source (the checkout it was built from).
fn bridge_script() -> String {
    std::env::var("EP0CH_NATIVE_BRIDGE").unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/bridge/main.ts").to_string())
}

fn init() -> App {
    let bun = std::env::var("EP0CH_BUN").unwrap_or_else(|_| "bun".to_string());
    let mut app = App::new(Bridge::spawn(&bun, &bridge_script(), rune::extra_args()));
    app.start();
    // A headless render has no later frame: wait for the tree and the first note before drawing.
    if rune::tooling::headless_run().is_some() {
        app.settle();
        app.settle();
    }
    app
}

fn setup(s: &mut App, waker: rune::Waker) { s.bridge.set_waker(waker) }

fn poll(s: &mut App, _clock: f64, _tx: &mut Tx) -> bool {
    // A scripted headless run steps a virtual clock faster than answers arrive: wait for what the last step asked.
    let settled = rune::tooling::headless_run().is_some() && s.settle();
    s.take() || settled
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
        Key::Backspace if e.mods.cmd && s.draft.is_none() => s.trash(),
        Key::Up if e.mods.alt => s.step("up"),
        Key::Down if e.mods.alt => s.step("down"),
        Key::Right if e.mods.alt => s.step("in"),
        Key::Left if e.mods.alt => s.step("out"),
        Key::Escape if s.palette.is_some() => s.palette = None,
        Key::Escape if s.draft.is_some() => s.cancel_edit(),
        Key::Escape if s.notice.is_some() => s.notice = None,
        _ => return false,
    }
    true
}

// Scenes for headless renders (`--scene edit`): each starts from the settled window and waits for what it asked.
fn scene_edit(s: &mut App) { s.edit() }
fn scene_find(s: &mut App) { s.find(Finder::Find, "beans"); s.settle(); }
fn scene_query(s: &mut App) { s.find(Finder::Query, "type=letter"); s.settle(); }
fn scene_plan(s: &mut App) { open_titled(s, "Plan for Saturday") }
fn scene_callouts(s: &mut App) { open_titled(s, "Recipe callouts") }
fn scene_figures(s: &mut App) { open_titled(s, "Allotment figures") }

fn open_titled(s: &mut App, title: &str) {
    let Some(id) = s.tree.iter().find(|r| r.title == title).map(|r| r.id.clone()) else { return };
    s.open(&id);
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
