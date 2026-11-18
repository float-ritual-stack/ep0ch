//! Probe 1: can focus be set from code, so Rune's focus follows `Layout.focus`?
//!
//! DESIGN.md §4 gives "which tile has focus" one owner: `Layout.focus`, changed only by `Op::Focus`. Rune keeps a
//! focus of its own (the element the keys go to). These tests ask whether the second can be made to follow the first
//! from code, and how the layout hears when Rune moves its focus itself (a press, Tab).

use ep0ch_native_probes::*;
use rune::{Cx, El, Key, KeyEvent, Runtime, TextEdit, Tx, col, el, row, text};
use rune_kit::{Kit, TextInput};

/// A screen of three tiles in one row container, and a tabs container showing one of two more. `focus` stands for
/// `Layout.focus`; `heard` is every `Op::Focus` the layout was asked for, with what asked.
struct Desk {
    tiles: Vec<&'static str>,
    focus: &'static str,
    /// The tile the tabs container shows: `links` or `props`.
    tab: &'static str,
    heard: Vec<String>,
    /// A field inside the `seeds` tile.
    field: TextEdit,
    /// Something an agent's act changes without asking for focus.
    beds_title: String,
    /// A row with its own press handler, inside the `reader` tile.
    opened: u32,
    /// What `Tx::focused` read the last time a reconciler ran.
    rune_focus: Option<String>,
    /// What `follow` last asked Rune for: the key, and the tab that was showing when it asked.
    applied: Option<(String, &'static str)>,
}

fn desk() -> Desk {
    Desk { tiles: vec!["beds", "reader", "seeds", "links", "props"], focus: "beds", tab: "links", heard: vec![], field: TextEdit::default(), beds_title: "Beds".into(), opened: 0, rune_focus: None, applied: None }
}

impl Desk {
    /// `Op::Focus`, the only writer of `focus`.
    fn op_focus(&mut self, tile: &'static str, by: &str) {
        self.heard.push(format!("{by}: {tile}"));
        self.focus = tile;
    }

    /// Where Rune's focus belongs: the tile `Layout.focus` names, or the field in it while the field has the keys.
    /// The field says so itself: the runtime keeps `TextEdit::focused` true while it is typed in.
    fn wants(&self) -> String {
        if self.focus == "seeds" && self.field.focused { "tile/seeds/field".into() } else { format!("tile/{}", self.focus) }
    }

    /// The tile Rune's focus is in, from what a handler can read: a field's own model, else the focused element's
    /// key, which is namespaced `tile/<name>/…`.
    fn tile_of(&self, rune_focus: Option<&str>) -> Option<&'static str> {
        if self.field.focused { return Some("seeds") }
        self.tile_of_key(rune_focus?)
    }

    fn tile_of_key(&self, key: &str) -> Option<&'static str> {
        let rest = key.strip_prefix("tile/")?;
        self.tiles.iter().copied().find(|t| rest == *t || rest.strip_prefix(t).is_some_and(|r| r.starts_with('/')))
    }
}

fn tile(s: &Desk, name: &'static str, body: El) -> El {
    col()
        .key(format!("tile/{name}"))
        .focusable(true)
        .size(180.0, 160.0)
        .border(if s.focus == name { 2.0 } else { 1.0 }, rune::oklch(0.5, 0.1, 250.0))
        // A press on the tile's own ground is the person asking for focus: it becomes the op.
        .on_press(move |s: &mut Desk| s.op_focus(name, "press"))
        // The tile's own keys run before Rune's focus navigation, so Tab is the layout's to answer.
        .on_key(move |s: &mut Desk, e: &KeyEvent, _: &mut Tx| {
            if e.key != Key::Tab { return false }
            let row = &s.tiles[..3];
            let next = row[(row.iter().position(|t| *t == s.focus).unwrap_or(0) + 1) % row.len()];
            s.op_focus(next, "tab");
            true
        })
        .child(body)
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = Kit::neutral(cx.system_dark());
    let field = TextInput::new(&s.field).placeholder("A seed").width(Some(160.0)).on_edit(|s: &mut Desk| &mut s.field).build(&k).key("tile/seeds/field");
    let open = row().key("tile/reader/open").size(120.0, 24.0).on_press(|s: &mut Desk| s.opened += 1).child(text("Open"));
    row()
        .child(tile(s, "beds", text(s.beds_title.clone())))
        .child(tile(s, "reader", open))
        .child(tile(s, "seeds", field))
        .child(col().key("tabs").child(tile(s, s.tab, text(s.tab))))
        .child(el().key("empty").size(40.0, 160.0))
}

fn window() -> Runtime<Desk> {
    let mut rt = Runtime::new(desk(), view, (900.0, 200.0), env());
    turn(&mut rt);
    rt
}

/// A point on a tile's own ground, below whatever it holds.
fn ground(rt: &Runtime<Desk>, tile: &str) -> (f32, f32) {
    let r = rect(rt, &format!("tile/{tile}"));
    (r[0] + r[2] * 0.5, r[1] + r[3] - 20.0)
}

fn click_ground(rt: &mut Runtime<Desk>, tile: &str) {
    let (x, y) = ground(rt, tile);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    turn(rt);
}

/// The reconciler, both ways, in `poll`, which every frame starts with. It is the one place that calls `Tx::focus`.
///
/// - Rune to layout: when Rune's focus moved by itself (a press it answered) into another tile, that is the person
///   asking, and it becomes `Op::Focus`.
/// - Layout to Rune: when what the layout wants changed (or what is shown did), ask Rune once. Never every frame:
///   see `a_reconciler_that_only_knows_tiles_takes_the_keys_back_from_a_field`.
fn follow(s: &mut Desk, _clock: f64, tx: &mut Tx) -> bool {
    let now = tx.focused().map(str::to_owned);
    let moved = now != s.rune_focus;
    s.rune_focus = now;
    let mut changed = false;
    // Rune's focus is read a frame after it moves, so the move this reconciler asked for arrives here too: the tile
    // it last asked for is its own echo, never the person.
    let echo = s.applied.as_ref().and_then(|(key, _)| s.tile_of_key(key));
    if moved && let Some(tile) = s.tile_of(s.rune_focus.as_deref()) && tile != s.focus && Some(tile) != echo {
        s.op_focus(tile, "rune");
        changed = true;
    }
    let want = (s.wants(), s.tab);
    if s.applied.as_ref() != Some(&want) {
        // A field that already has the keys (a press put them there) is left alone.
        if !(want.0.ends_with("/field") && s.field.focused) { tx.focus(want.0.clone(), false); }
        s.applied = Some(want);
    }
    changed
}

/// A reconciler that knows only tiles: Rune's focus must be the tile's own element, asked whenever it isn't.
fn follow_tiles_only(s: &mut Desk, _clock: f64, tx: &mut Tx) -> bool {
    s.rune_focus = tx.focused().map(str::to_owned);
    let want = format!("tile/{}", s.focus);
    if tx.focused() != Some(want.as_str()) { tx.focus(want, false); }
    false
}

#[test]
fn a_handler_s_tx_focus_moves_rune_s_focus_to_the_tile_the_layout_names() {
    let mut rt = window();
    assert_eq!(focused(&rt), None, "nothing has focus in a new window");
    rt.update(|s, tx| {
        s.op_focus("reader", "act");
        tx.focus(format!("tile/{}", s.focus), false);
    });
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/reader"));
    assert!(element(&rt, "tile/reader").unwrap().focused && !element(&rt, "tile/reader").unwrap().focus_visible, "focused without a ring, as asked");
    rt.update(|s, tx| {
        s.op_focus("beds", "act");
        tx.focus("tile/beds", true);
    });
    turn(&mut rt);
    assert!(element(&rt, "tile/beds").unwrap().focus_visible, "and with one when the op came from keys");
}

#[test]
fn a_reconciler_in_poll_makes_rune_s_focus_follow_layout_focus_with_no_call_site_knowing() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/beds"), "the layout's first focus is Rune's after one frame, though poll said nothing changed");
    // Any writer of Layout.focus: here an update that never mentions Tx.
    rt.update(|s, _| s.op_focus("reader", "act"));
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/reader"));
    assert_eq!(rt.state.rune_focus.as_deref(), Some("tile/reader"), "Tx::focused in poll reads Rune's focus by the element's key");
    assert_eq!(rt.state.heard, ["act: reader"], "and following it back raised no second op");
}

#[test]
fn a_press_on_a_tile_s_ground_and_tab_reach_the_layout_as_ops() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    click_ground(&mut rt, "seeds");
    turn(&mut rt);
    assert_eq!(rt.state.heard, ["press: seeds"]);
    assert_eq!(focused(&rt).as_deref(), Some("tile/seeds"));
    key(&mut rt, Key::Tab);
    turn(&mut rt);
    assert_eq!(rt.state.heard.last().unwrap(), "tab: beds", "the tile's on_key took Tab before Rune's focus navigation");
    assert_eq!(focused(&rt).as_deref(), Some("tile/beds"));
}

#[test]
fn without_a_tile_on_key_tab_moves_rune_s_focus_behind_the_layout_s_back() {
    // The same row with no on_key on the tiles: what Rune does with Tab by itself.
    fn bare(s: &Desk, _: &mut Cx<Desk>) -> El {
        row().children(s.tiles.iter().map(|name| col().key(format!("tile/{name}")).focusable(true).size(160.0, 160.0)))
    }
    let mut rt = Runtime::new(desk(), bare, (900.0, 200.0), env());
    turn(&mut rt);
    rt.update(|_, tx| tx.focus("tile/beds", true));
    turn(&mut rt);
    key(&mut rt, Key::Tab);
    assert_eq!(focused(&rt).as_deref(), Some("tile/reader"), "Rune's own Tab order moved it");
    assert_eq!(rt.state.focus, "beds", "and no handler ran: the layout hears only if poll reads Tx::focused");
}

#[test]
fn a_press_on_a_row_inside_a_tile_never_reaches_the_tile_s_on_press_and_the_layout_hears_through_rune_s_focus() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    click(&mut rt, "tile/reader/open");
    assert_eq!(rt.state.opened, 1);
    assert_eq!(rt.state.heard, Vec::<String>::new(), "the row took the press; the tile's on_press did not run");
    assert_eq!(focused(&rt).as_deref(), Some("tile/reader"), "but a control with on_key takes focus from any press inside it");
    turn(&mut rt);
    assert_eq!(rt.state.heard, ["rune: reader"], "which poll reads and turns into the op");
    assert_eq!(rt.state.focus, "reader");
}

#[test]
fn a_press_on_a_field_in_another_tile_moves_the_layout_s_focus_and_keeps_the_field_s() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/beds"));
    click(&mut rt, "tile/seeds/field");
    assert!(rt.state.heard.is_empty(), "the field took the press: no handler of the tile's ran");
    turn(&mut rt);
    assert_eq!(rt.state.heard, ["rune: seeds"], "the layout hears from the field's own model, TextEdit::focused");
    turn(&mut rt);
    assert!(focused_path(&rt).unwrap().ends_with("tile/seeds/tile/seeds/field/value/input"), "{:?}", focused_path(&rt));
    typed(&mut rt, "kale");
    assert_eq!(rt.state.field.text, "kale");
    // And out again: a press on a tile's ground takes the keys from the field.
    click_ground(&mut rt, "beds");
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/beds"));
    assert!(!rt.state.field.focused);
}

#[test]
fn a_reconciler_that_only_knows_tiles_takes_the_keys_back_from_a_field() {
    let mut rt = window();
    rt.poll = Some(follow_tiles_only);
    rt.update(|s, _| s.op_focus("seeds", "act"));
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/seeds"));
    click(&mut rt, "tile/seeds/field");
    assert_eq!(focused(&rt).as_deref(), Some("input"), "the press focused the field");
    turn(&mut rt);
    assert_eq!(rt.state.rune_focus.as_deref(), Some("input"), "Tx::focused names the kit's own part, with no tile in it");
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/seeds"), "so a reconciler that compares it with the tile's key asks again, and the field loses the keys");
    typed(&mut rt, "kale");
    assert_eq!(rt.state.field.text, "");
}

#[test]
fn focus_lands_on_a_tile_that_the_same_change_brings_on_screen() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    assert!(element(&rt, "tile/props").is_none(), "the hidden tab's tile isn't built");
    rt.update(|s, _| {
        s.tab = "props";
        s.op_focus("props", "act");
    });
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/props"));
}

#[test]
fn focus_asked_for_a_tile_that_is_not_shown_is_dropped_until_the_tile_shows() {
    let mut rt = window();
    rt.update(|_, tx| tx.focus("tile/props", false));
    turn(&mut rt);
    assert_eq!(focused(&rt), None, "Tx::focus on a key nothing shows does nothing, and says nothing");
    rt.poll = Some(follow);
    rt.update(|s, _| s.op_focus("props", "act"));
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(focused(&rt), None);
    rt.update(|s, _| s.tab = "props");
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(focused(&rt).as_deref(), Some("tile/props"), "the reconciler asks again when what is shown changes, so it lands when the tile shows");
}

#[test]
fn a_field_inside_a_tile_takes_focus_by_the_tile_s_namespaced_key() {
    let mut rt = window();
    rt.update(|_, tx| tx.focus("tile/seeds/field", false));
    turn(&mut rt);
    let path = focused_path(&rt).expect("the kit field's editor is focused");
    assert!(path.contains("tile/seeds/field"), "{path}");
    assert_eq!(focused(&rt).as_deref(), Some("input"), "Rune focuses the wrapper's first focusable child: the kit's own `input`");
    assert!(rt.state.field.focused, "and the model hears through on_edit");
    typed(&mut rt, "kale");
    assert_eq!(rt.state.field.text, "kale");
}

#[test]
fn a_field_also_takes_focus_through_its_model_and_gives_it_up_to_blur() {
    let mut rt = window();
    rt.update(|s, _| s.field.focused = true);
    turn(&mut rt);
    assert!(focused_path(&rt).unwrap().contains("tile/seeds/field"));
    rt.update(|_, tx| tx.blur());
    turn(&mut rt);
    assert_eq!(focused(&rt), None);
    assert!(!rt.state.field.focused);
}

#[test]
fn an_agent_s_update_that_redraws_another_tile_leaves_focus_and_the_pointer_alone() {
    let mut rt = window();
    rt.poll = Some(follow);
    turn(&mut rt);
    click(&mut rt, "tile/seeds/field");
    turn(&mut rt);
    typed(&mut rt, "ka");
    let before = (focused_path(&rt), rt.pointer(), rt.state.heard.clone());
    rt.update(|s, _| s.beds_title = "Beds (3 to sow)".into());
    turn(&mut rt);
    turn(&mut rt);
    typed(&mut rt, "le");
    assert_eq!((focused_path(&rt), rt.pointer(), rt.state.heard.clone()), before);
    assert_eq!(rt.state.field.text, "kale", "the person kept typing through it");
}
