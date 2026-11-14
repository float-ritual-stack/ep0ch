//! What a press on a list's row asks for. No Rune and no state of the window's: the one port of outline-core's
//! `rowGesture` (`row-press.ts`), which the terminal door's `RowPresses` asks too, held row for row by
//! `fixtures/core-contract.json` (`presses`).
//!
//! - **A press is one of four things**, the mouse's steps matching the keyboard's: `Focus` (the press gave the
//!   list's tile the keys: its row is selected and nothing else), `Select` (as `j` and `k`: selected, and shown
//!   where the tile's select wires say), `Open` (a second press on the row soon after: Return), `Fresh` (Option or
//!   the platform's shortcut modifier held, or the middle button: Alt+Return).
//! - **The renderer says what was pressed, in the door's bits** (`ALT`, `CTRL`, `MIDDLE`): Option is alt, and the
//!   platform's shortcut modifier (Cmd on a Mac, Ctrl elsewhere) is ctrl. Nothing here reads a renderer's type.

/// Two presses on the same row within this long are a double click (outline-core's `DOUBLE_MS`).
pub const DOUBLE_MS: u64 = 400;
/// A press's modifier bits, as the door's mouse report carries them.
pub const SHIFT: u32 = 4;
pub const ALT: u32 = 8;
pub const CTRL: u32 = 16;
/// The middle button (0 the primary).
pub const MIDDLE: u32 = 1;

/// What a press on a row asks for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture { Focus, Select, Open, Fresh }

impl Gesture {
    pub fn word(self) -> &'static str { match self { Gesture::Focus => "focus", Gesture::Select => "select", Gesture::Open => "open", Gesture::Fresh => "fresh" } }
}

/// A press, as the list is told it: its modifier bits and button, when (in milliseconds of the asker's clock),
/// whether it gave the list's tile the keys, and whether a second press on the row opens however long after.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Press { pub mods: u32, pub button: u32, pub now: u64, pub focusing: bool, pub untimed: bool }

/// A press that opens fresh whatever came before it: alt or ctrl held, or the middle button (`pressFresh`).
pub fn fresh(mods: u32, button: u32) -> bool { mods & (ALT | CTRL) != 0 || button == MIDDLE }

/// The presses on rows, so a second one on the same row soon after is a double click: the last press, by the row
/// it was on (a row is named by whoever asks: a tile and the row's id).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Presses { last: Option<(String, u64)> }

impl Presses {
    /// A press on `row`: what it asks for. A double click opens even when its first press gave the list the keys;
    /// any other unmodified press selects. A third press starts afresh, and so does the press after a fresh open.
    pub fn press(&mut self, row: &str, p: Press) -> Gesture {
        if fresh(p.mods, p.button) { self.last = None; return Gesture::Fresh }
        let twice = self.last.as_ref().is_some_and(|(last, at)| last == row && ((p.untimed && !p.focusing) || p.now.saturating_sub(*at) < DOUBLE_MS));
        if twice { self.last = None; return Gesture::Open }
        self.last = Some((row.to_string(), p.now));
        if p.focusing { Gesture::Focus } else { Gesture::Select }
    }
    /// The list changed under the pointer: the next press starts afresh.
    pub fn forget(&mut self) { self.last = None }
}
