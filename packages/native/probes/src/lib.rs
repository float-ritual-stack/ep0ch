//! Shared by the probes: how a test drives a Rune `Runtime` and reads what it drew. Nothing here is the app's.
//!
//! The words are the door's: a **tile** is one box of a screen, a **container** arranges tiles, a **screen** is a
//! named layout. A "pane" would be Herdr's or tmux's box, and none appears here.

use rune::{ElementInfo, Env, Key, KeyEvent, Mods, Runtime};

pub mod grid;

/// A light window at scale 1, as the app's own window tests build theirs.
pub fn env() -> Env { Env::new(false, 1.0) }

/// One frame that advances no time: queued handlers run, the view re-runs if state changed.
pub fn turn<S: 'static>(rt: &mut Runtime<S>) { rt.frame(0.0); }

/// Frames at 60 Hz until springs have landed.
pub fn rest<S: 'static>(rt: &mut Runtime<S>) {
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
}

pub fn key<S: 'static>(rt: &mut Runtime<S>, key: Key) { chord(rt, key, Mods::default()); }

pub fn chord<S: 'static>(rt: &mut Runtime<S>, key: Key, mods: Mods) {
    rt.key(KeyEvent { key, mods });
    turn(rt);
}

pub fn typed<S: 'static>(rt: &mut Runtime<S>, text: &str) {
    for ch in text.chars() { key(rt, Key::Text(ch.to_string())); }
}

/// The primary shortcut modifier as the platform reports it: Ctrl with `cmd` set off macOS.
pub fn primary() -> Mods { Mods { cmd: true, ctrl: !cfg!(target_os = "macos"), logo: cfg!(target_os = "macos"), ..Mods::default() } }

/// The element Rune says has the keyboard, by its own key.
pub fn focused<S: 'static>(rt: &Runtime<S>) -> Option<String> { focused_info(rt).and_then(|e| e.key) }

/// The element Rune says has the keyboard, by its path from the root.
pub fn focused_path<S: 'static>(rt: &Runtime<S>) -> Option<String> { focused_info(rt).map(|e| e.path) }

fn focused_info<S: 'static>(rt: &Runtime<S>) -> Option<ElementInfo> { rt.elements().into_iter().find(|e| e.focused) }

/// The element keyed `key`, exactly.
pub fn element<S: 'static>(rt: &Runtime<S>, key: &str) -> Option<ElementInfo> {
    rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key))
}

pub fn rect<S: 'static>(rt: &Runtime<S>, key: &str) -> [f32; 4] {
    element(rt, key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}")).rect
}

pub fn center<S: 'static>(rt: &Runtime<S>, key: &str) -> (f32, f32) {
    let r = rect(rt, key);
    (r[0] + r[2] * 0.5, r[1] + r[3] * 0.5)
}

pub fn click<S: 'static>(rt: &mut Runtime<S>, key: &str) {
    let (x, y) = center(rt, key);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    turn(rt);
}

/// A press at `from`, the pointer carried to `to` in `steps` moves, then let go.
pub fn drag<S: 'static>(rt: &mut Runtime<S>, from: (f32, f32), to: (f32, f32), steps: usize) {
    rt.pointer_down(from.0, from.1);
    turn(rt);
    for i in 1..=steps {
        let t = i as f32 / steps as f32;
        rt.pointer_move(from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t);
        turn(rt);
    }
    rt.pointer_up(to.0, to.1);
    turn(rt);
}

/// Wall-clock milliseconds `f` took.
pub fn ms(f: impl FnOnce()) -> f64 {
    let t = std::time::Instant::now();
    f();
    t.elapsed().as_secs_f64() * 1000.0
}

/// The median and the worst of a list of timings.
pub fn median_max(mut samples: Vec<f64>) -> (f64, f64) {
    samples.sort_by(|a, b| a.total_cmp(b));
    (samples[samples.len() / 2], *samples.last().unwrap())
}
