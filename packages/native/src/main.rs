//! ep0ch as a native window. `ep0ch-native [--ws <name>] [--machine <ssh-name>]` opens the outline the usual rule
//! names (`--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`) on a screen: tiles arranged by a layout, each drawn
//! by its kind's drawer, with the command bar over all of it. It ships no screen and no tile kind: both are the
//! service's rows (the screens extension has the ones every door ships), and it opens on the one that says so.
//!
//! It speaks the outline host's socket and draws what the host answers: see the README beside Cargo.toml.
//! Every change is an act line through one dispatcher (`actions/`), whoever asks: a key (`keys.rs`), a press
//! (`shell.rs`, a tile's drawer, `bar.rs`), or an agent over the control socket (`control.rs`).
//! Rune's own flags work as in any Rune app: `--snap out.png`, `--scene edit`, `--script steps.json`, `--tree`;
//! after `--`, `--act <file>` runs a file of act lines before the first frame, `--screen <name>` opens on that
//! screen, and `--programs <file>` runs its terminal tiles on a scripted host (a scene's made-up shell).
mod actions;
mod actline;
mod band;
mod bar;
mod client;
mod control;
mod draft;
mod ext;
mod keys;
mod layout;
mod list;
mod page;
mod parts;
mod pty;
mod query;
mod screen;
mod shell;
mod store;
#[cfg(test)]
mod tests;
mod tiles;

use std::time::Duration;

use rune::{AppSpec, Tx};

use actions::App;
use client::{Nowhere, Socket};
use store::OutlineAt;

// The scenes: every `scenes/<name>.act`, a file of act lines, as a `--scene <name>` (written by build.rs).
include!(concat!(env!("OUT_DIR"), "/scenes.rs"));

fn flag(name: &str) -> Option<String> {
    let args = rune::extra_args();
    args.iter().position(|a| a == name).and_then(|at| args.get(at + 1)).cloned()
}

/// The way to an outline's host, by the rule every client opens one by: how a lost link is made again and how a
/// window switches outline. A headless render keeps no arrangement.
fn ways(headless: bool) -> actions::Ways { std::rc::Rc::new(move |at: &OutlineAt| client::way(&at.outline, &at.machine, !headless)) }

fn init() -> App {
    // A headless render steps a virtual clock: each ask waits for its answer, so the frame drawn shows it.
    let headless = rune::tooling::headless_run().is_some();
    let app = match client::place(rune::extra_args()) {
        Ok(place) => {
            let app = App::opened(Box::new(Socket::connect(&place.socket)), OutlineAt { outline: place.outline.clone(), machine: place.machine.clone() }).reaching(ways(headless));
            // The arrangement is kept beside the control socket, a file an outline: a headless render keeps none.
            match client::control(rune::extra_args()).filter(|_| !headless) {
                Some(control) => app.arranged_in(client::arrangement(&control, &place.outline)),
                None => app,
            }
        }
        Err(why) => App::new(Box::new(Nowhere(Some(why))), ""),
    };
    // What runs the programs of its terminal tiles: the terminal this build has (none, built without the `pty`
    // feature), or a scripted host a scene names (`--programs <file>`: a headless render has no pty to wait on).
    let app = match flag("--programs").map(|file| std::fs::read_to_string(&file).map_err(|e| e.to_string()).and_then(|script| serde_json::from_str::<serde_json::Value>(&script).map_err(|e| e.to_string())).map_err(|why| format!("{file}: {why}"))) {
        Some(Ok(script)) => app.running_on(Box::new(pty::canned::Canned::read(&script))),
        Some(Err(why)) => { eprintln!("ep0ch-native: can't read the programs' script {why}"); app }
        // A headless render with no script runs nothing: a real program's screen would never be the same twice.
        None if headless => app,
        None => { let wake = app.store().waker(); app.running_on(pty::host(wake)) }
    };
    // The screen it opens on is asked of the service's list, when that has come: a headless render waits for it.
    let mut app = app.blocking(headless).opening_on(flag("--screen"));
    app.start();
    if headless { app.settle(); }
    if let Some(file) = flag("--act") {
        match std::fs::read_to_string(&file) {
            // (A headless render draws one frame: its clock is stepped past the moment a lit row waits for its card.)
            Ok(lines) => { app.script(&lines); if headless { let quiet = app.now + 2.0 * draft::CARD_QUIET; app.tick(quiet); } }
            Err(e) => eprintln!("ep0ch-native: can't read {file}: {e}"),
        }
    }
    // A headless render draws one window: `--torn <name>` says which, when the acts tore one out (a window of a
    // live run is opened by the shell; a headless one opens none, and Rune's own `--window` picks among windows
    // made before the run).
    if let Some(name) = flag("--torn").filter(|_| headless) {
        match app.born().into_iter().find(|born| born.window() == name) {
            Some(mut born) => { born.settle(); return born }
            None => eprintln!("ep0ch-native: no window named {name} was torn out: drawing the first"),
        }
    }
    app
}

/// A state nobody opens on: what a window's spec names until the shell hands it the state it was made for.
fn nobody() -> App { App::new(Box::new(Nowhere(None)), "") }

fn setup(s: &mut App, waker: rune::Waker) { s.set_waker(waker) }

fn poll(s: &mut App, clock: f64, tx: &mut Tx) -> bool {
    let landed = s.take();
    // What the lit row of an open completion list says of itself is drawn once the row has been lit a moment.
    let (carded, due) = s.tick(clock);
    if let Some(due) = due { tx.wake_after(due) }
    // The drafts held are renewed on the service, and it is told when the keys go quiet: asked again when due.
    if let Some(due) = s.beat() { tx.wake_after(due) }
    // What the status line says goes once it has been up long enough to read; asked again when that is due.
    let (faded, due) = s.fade(std::time::Instant::now());
    if let Some(due) = due { tx.wake_after(due) }
    // A program in a terminal tile has something new to show (its screen lands at once: the drawer's own grid says so).
    let ran = s.ran();
    let moved = keys::effects(s, tx) | keys::follow(s, tx) | ran;
    // A window an act asked for (a tile torn out) is opened, over the state the act made for it.
    for born in s.born() { shell::open(born, made(nobody)) }
    // A lost link is made again, now and every two seconds until the host answers.
    if !s.online && !s.blocking {
        s.reconnect();
        tx.wake_after(Duration::from_secs(2));
    }
    landed || moved || faded || carded
}

/// What every window of the run is made of: its view, its keys, what it does each turn. `init` makes its state.
fn made(init: fn() -> App) -> AppSpec<App> {
    AppSpec::<App> {
        min_size: Some((720.0, 420.0)),
        scenes: SCENES,
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(keys::press),
        ..AppSpec::new("ep0ch", (1180.0, 760.0), init, shell::view)
    }
}

fn main() {
    // First, as Rune's README asks ("Launch fast"): on a Mac the adapter, the device and the pipeline are made on a
    // thread while AppKit starts, and the first window takes them. Elsewhere it does nothing.
    rune::prewarm_gpu();
    // A quit drops what the run holds and comes back from `run`: the control socket leaves its folder as it is
    // dropped (`control::Control`). Rune's own default ends the process at the quit's last hook and drops nothing.
    rune::orderly_exit();
    let window = rune::App::new(made(init)).chrome(shell::frame()).on_close(control::gone);
    // Agents reach a window that is on screen; a headless render is one frame and has no one to answer. Asked of
    // the arguments: Rune says which headless run this is only once the state is made, after this.
    let _control = (!rune::is_headless()).then(|| client::control(rune::extra_args())).flatten().and_then(|path| {
        control::here(store::MAIN, window.handle());
        control::serve(std::path::Path::new(&path), control::Windows).map_err(|why| eprintln!("ep0ch-native: {why}")).ok()
    });
    window.run();
}
