//! ep0ch as a native window. `ep0ch-native [--ws <name>] [--machine <ssh-name>]` opens the outline the usual rule
//! names (`--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`) on a screen: tiles arranged by a layout, each drawn
//! by its kind's drawer, with the command bar over all of it. It ships no screen and no tile kind: both are the
//! service's rows (the screens extension has the ones every door ships), and it opens on the one that says so.
//!
//! It speaks the outline host's socket and draws what the host answers: see the README beside Cargo.toml.
//! Every change is an act line through one dispatcher (`actions/`), whoever asks: a key (`keys.rs`), a press
//! (`shell.rs`, a tile's drawer, `bar.rs`), or an agent over the control socket (`control.rs`).
//! Rune's own flags work as in any Rune app: `--snap out.png`, `--scene edit`, `--script steps.json`, `--tree`;
//! after `--`, `--act <file>` runs a file of act lines before the first frame, and `--screen <name>` opens on that
//! screen.
mod actions;
mod actline;
mod bar;
mod client;
mod control;
mod keys;
mod layout;
mod list;
mod page;
mod parts;
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

// The scenes: every `scenes/<name>.act`, a file of act lines, as a `--scene <name>` (written by build.rs).
include!(concat!(env!("OUT_DIR"), "/scenes.rs"));

fn flag(name: &str) -> Option<String> {
    let args = rune::extra_args();
    args.iter().position(|a| a == name).and_then(|at| args.get(at + 1)).cloned()
}

fn init() -> App {
    // A headless render steps a virtual clock: each ask waits for its answer, so the frame drawn shows it.
    let headless = rune::tooling::headless_run().is_some();
    let app = match client::place(rune::extra_args()) {
        Ok(place) => {
            let path = place.socket.clone();
            let app = App::new(Box::new(Socket::connect(&place.socket)), &place.outline).reconnecting(Box::new(move || Box::new(Socket::connect(&path))));
            // The arrangement is kept beside the control socket, a file an outline: a headless render keeps none.
            match client::control(rune::extra_args()).filter(|_| !headless) {
                Some(control) => app.arranged_in(std::path::Path::new(&control).with_file_name(format!("native-{}.layout.json", place.outline))),
                None => app,
            }
        }
        Err(why) => App::new(Box::new(Nowhere(Some(why))), ""),
    };
    // The screen it opens on is asked of the service's list, when that has come: a headless render waits for it.
    let mut app = app.blocking(headless).opening_on(flag("--screen"));
    app.start();
    if headless { app.settle(); }
    if let Some(file) = flag("--act") {
        match std::fs::read_to_string(&file) {
            Ok(lines) => { app.script(&lines); }
            Err(e) => eprintln!("ep0ch-native: can't read {file}: {e}"),
        }
    }
    app
}

fn setup(s: &mut App, waker: rune::Waker) { s.set_waker(waker) }

fn poll(s: &mut App, _clock: f64, tx: &mut Tx) -> bool {
    let landed = s.take();
    let moved = keys::effects(s, tx) | keys::follow(s, tx);
    // A lost link is made again, now and every two seconds until the host answers.
    if !s.online && !s.blocking {
        s.reconnect();
        tx.wake_after(Duration::from_secs(2));
    }
    landed || moved
}

fn main() {
    let window = rune::App::new(AppSpec::<App> {
        min_size: Some((720.0, 420.0)),
        scenes: SCENES,
        setup: Some(setup),
        poll: Some(poll),
        on_key: Some(keys::press),
        ..AppSpec::new("ep0ch", (1180.0, 760.0), init, shell::view)
    });
    // Agents reach a window that is on screen; a headless render is one frame and has no one to answer. Asked of
    // the arguments: Rune says which headless run this is only once the state is made, after this.
    let _control = (!rune::is_headless()).then(|| client::control(rune::extra_args())).flatten().and_then(|path| {
        control::serve(std::path::Path::new(&path), window.handle()).map_err(|why| eprintln!("ep0ch-native: {why}")).ok()
    });
    window.run();
}
