//! ep0ch as a native window. `ep0ch-native [--ws <name>] [--machine <ssh-name>]` opens the outline the usual rule
//! names (`--ws`, then `EP0CH_WS`, then the nearest `.ep0ch`): the tree on the left, the open note in the middle,
//! what the service knows about it on the right, and the command bar over all of it.
//!
//! It speaks the outline host's socket and draws what the host answers: see the README beside Cargo.toml.
//! Every change is an act line through one dispatcher (`actions/`), whoever asks: a key (`keys.rs`), a press
//! (`view.rs`, `bar.rs`), or an agent over the control socket (`control.rs`).
//! Rune's own flags work as in any Rune app: `--snap out.png`, `--scene edit`, `--script steps.json`, `--tree`;
//! after `--`, `--act <file>` runs a file of act lines before the first frame.
mod actions;
mod actline;
mod bar;
mod client;
mod control;
mod keys;
mod list;
mod page;
mod store;
#[cfg(test)]
mod tests;
mod view;

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
            App::new(Box::new(Socket::connect(&place.socket)), &place.outline).reconnecting(Box::new(move || Box::new(Socket::connect(&path))))
        }
        Err(why) => App::new(Box::new(Nowhere(Some(why))), ""),
    };
    let mut app = app.blocking(headless);
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
    let moved = s.effects(tx);
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
        ..AppSpec::new("ep0ch", (1180.0, 760.0), init, view::view)
    });
    // Agents reach a window that is on screen; a headless render is one frame and has no one to answer.
    let _control = (rune::tooling::headless_run().is_none()).then(|| client::control(rune::extra_args())).flatten().and_then(|path| {
        control::serve(std::path::Path::new(&path), window.handle()).map_err(|why| eprintln!("ep0ch-native: {why}")).ok()
    });
    window.run();
}
