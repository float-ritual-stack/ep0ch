//! One owner each, held by what the window does: every test here is a failure a second decider caused, and goes
//! red when one comes back. `one_owner.rs` scans the source for the same thing; this file presses the window.
use rune::{Key, KeyEvent, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, Field, Outcome};

fn leaf(kind: &str, name: &str) -> Value { json!({ "t": "leaf", "kind": kind, "name": name }) }

fn agent() -> Actor { Actor::Agent("seedling-agent".into()) }

/// One act line run in a drawn window, with what it asked landed.
fn ran(rt: &mut Runtime<App>, line: impl Into<String>, by: Actor) -> Outcome {
    let (line, (send, got)) = (line.into(), std::sync::mpsc::channel());
    rt.update(move |s, _| { let _ = send.send(s.act(&line, by)); });
    rest(rt);
    got.recv().unwrap()
}

fn names(app: &App) -> Vec<String> { app.layout.names.0.iter().map(|(_, name)| name.clone()).collect() }

/// A window laid out as the screen `beds`, whose spec is `spec` (its layout and whatever else a screen says).
fn laid(mut spec: Value) -> Garden {
    let mut g = garden(ok());
    spec["name"] = json!("beds");
    spec["title"] = json!("beds");
    let mut row = screen_row("beds", json!(null), json!([]));
    row["spec"] = spec;
    screens_are(&mut g, json!([row]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(opened.ok, "{}", opened.said);
    g
}

// ── whether the arrangement changes: `layout::apply`, for a step undone and a screen opened too ───────────────

/// Split the reader, edit in the new one, then undo: the arrangement before has no such tile, and the layout's rule
/// for a tile that holds an edit is asked of what would go. It stays, with its text, and so does the step.
#[test]
fn a_step_undone_never_takes_away_a_tile_that_holds_an_edit() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "tile.split").ok);
    assert_eq!(g.app.layout.name(&g.app.layout.focus), "reader2");
    assert!(act(&mut g.app, "edit").ok);
    g.app.field(Field::Draft).replace_text("Plot, half written");
    let undone = act(&mut g.app, "layout.undo");
    assert!(!undone.ok && undone.said.contains("reader2") && undone.said.contains("holds an edit of"), "{}", undone.said);
    assert!(names(&g.app).contains(&"reader2".to_string()), "the tile that holds the edit is still here");
    assert_eq!(g.app.editing.as_ref().map(|e| g.app.layout.name(&e.tile)).as_deref(), Some("reader2"));
    assert_eq!(g.app.editor.text, "Plot, half written");
    assert_eq!(g.app.journal.len(), 1, "the step is still there to undo once the edit is saved or dropped");
    // The same for a screen opened over it: the layout says no, in the same words.
    screens_are(&mut g, json!([screen_row("beds", json!({ "focus": "bed", "root": leaf("reader", "bed") }), json!([]))]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(!opened.ok && opened.said.contains("holds an edit of"), "{}", opened.said);
    assert_eq!(g.app.screen.name, "desk");
    // Saved, nothing holds it: the step goes back, and the edit that was open on the tile ends with it.
    assert!(act(&mut g.app, "edit.save").ok);
    assert!(act(&mut g.app, "layout.undo").ok);
    assert!(!names(&g.app).contains(&"reader2".to_string()));
    assert!(g.app.editing.is_none(), "no draft is left on a tile that is gone");
    assert_eq!(g.app.person().layer.name(), "tile");
}

/// An agent's undo and an agent's screen are operations like any other: neither takes away the tile with the
/// person's keys, and neither moves the keys.
#[test]
fn an_agent_s_undo_or_screen_never_takes_the_tile_with_the_person_s_keys() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "tile.split").ok);
    let undone = g.app.act("layout.undo", agent());
    assert!(!undone.ok && undone.said.contains("reader2 has the person's keys"), "{}", undone.said);
    assert!(names(&g.app).contains(&"reader2".to_string()));
    screens_are(&mut g, json!([screen_row("beds", json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.5, 0.5], "kids": [leaf("reader", "bed"), leaf("reader", "reader2")] } }), json!([]))]));
    // A screen that keeps their tile opens under them, and the keys stay where they were: the screen says `bed`.
    let opened = g.app.act("screen.open name=beds", agent());
    assert!(opened.ok, "{}", opened.said);
    assert_eq!((g.app.screen.name.as_str(), g.app.layout.name(&g.app.layout.focus)), ("beds", "reader2".to_string()));
    // The person's own open of it takes the screen's say.
    assert!(act(&mut g.app, "screen.reset").ok);
    assert_eq!(g.app.layout.name(&g.app.layout.focus), "bed");
    // One without their tile is refused.
    screens_are(&mut g, json!([screen_row("shed", json!({ "focus": "tools", "root": leaf("reader", "tools") }), json!([]))]));
    let opened = g.app.act("screen.open name=shed", agent());
    assert!(!opened.ok && opened.said.contains("bed has the person's keys"), "{}", opened.said);
    assert_eq!(g.app.screen.name, "beds");
}

/// The screen's last tile stays: the layout's own refusal, in its words, whoever asks and however.
#[test]
fn the_last_tile_staying_is_the_layout_s_answer() {
    let mut g = laid(json!({ "layout": { "focus": "bed", "root": leaf("reader", "bed") } }));
    let closed = act(&mut g.app, "tile.close");
    assert!(!closed.ok && closed.said.contains("bed is the screen's last tile: it stays"), "{}", closed.said);
    assert_eq!(names(&g.app), ["bed"]);
}

// ── what Esc does: the key table's rows; a border's drag has its own way back ─────────────────────────────────

fn escape(rt: &mut Runtime<App>) {
    rt.key(KeyEvent { key: Key::Escape, mods: Mods::default() });
    rest(rt);
}

/// A border dragged and let go with Escape goes back where it was at the press, and nothing else is undone: an
/// earlier step stays one step back. A drag the layout refused and Escape undoes nothing either.
#[test]
fn escape_during_a_border_s_drag_puts_the_border_back_and_undoes_nothing_else() {
    let two = json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] } });
    let g = laid(json!({ "layout": two }));
    let mut rt = window(g.app);
    // An earlier change to the arrangement: a second reader under the first.
    assert!(ran(&mut rt, "tile.split dir=down", Actor::Person).ok);
    let (tiles, steps, beds) = (names(&rt.state), rt.state.journal.len(), rect_of(&rt, "tile/beds").unwrap());
    let grip = rt.find("grip/s1/0").expect("the split's border has a grip");
    rt.pointer_down(grip.0, grip.1);
    rt.frame(0.0);
    rt.pointer_move(grip.0 + 160.0, grip.1);
    rest(&mut rt);
    assert!(rect_of(&rt, "tile/beds").unwrap()[2] > beds[2] + 100.0, "the border moved with the pointer");
    escape(&mut rt);
    rt.pointer_up(grip.0 + 160.0, grip.1);
    rest(&mut rt);
    assert_eq!(rect_of(&rt, "tile/beds").unwrap(), beds, "the border is back where it was at the press");
    assert_eq!((names(&rt.state), rt.state.journal.len()), (tiles.clone(), steps), "the split before the drag is neither undone nor buried under a step");
    assert!(!rt.state.steps.iter().any(|step| step.action == "layout.undo"), "the drag's way back is a resize, never the undo");
    // A screen that keeps its sizes refuses the drag: Escape then has nothing to put back, and the split before stays.
    let kept = json!({ "focus": "bed", "policy": { "resizable": false }, "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] } });
    let g = laid(json!({ "layout": kept }));
    let mut rt = window(g.app);
    assert!(ran(&mut rt, "tile.split dir=down", Actor::Person).ok);
    let tiles = names(&rt.state);
    let Some(grip) = rt.find("grip/s1/0") else { return };
    rt.pointer_down(grip.0, grip.1);
    rt.frame(0.0);
    rt.pointer_move(grip.0 + 160.0, grip.1);
    rest(&mut rt);
    escape(&mut rt);
    assert_eq!(names(&rt.state), tiles, "nothing is undone by a drag that moved nothing");
}

// ── which tile has the keys: `Layout.focus`, and the person's layer is read from it ───────────────────────────

/// A press inside a tile gives that tile the keys: what `mod+w` closes is the tile the person last pressed in.
#[test]
fn a_press_inside_a_tile_gives_it_the_keys() {
    let g = laid(json!({ "layout": { "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] } } }));
    let mut rt = window(g.app);
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "bed");
    press(&mut rt, "tile/beds/row/shed");
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "beds", "the tree has the keys after a press on its row");
    assert_eq!(rt.state.person().focus, "beds");
    chord(&mut rt, Key::Text("w".into()), primary());
    assert_eq!(names(&rt.state), ["bed"], "mod+w closed the tile the person was in, not the reader");
}

/// While a note is edited in one tile and the keys are moved to another, the person is in that other tile: one
/// answer for the focus border, `peek` and where a key goes. Back on the tile with the draft, they are in it again.
#[test]
fn the_person_s_layer_is_read_from_the_tile_with_the_keys() {
    let g = laid(json!({ "layout": { "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] } } }));
    let mut rt = window(g.app);
    assert!(ran(&mut rt, "edit", Actor::Person).ok);
    assert_eq!((rt.state.person().layer.name(), rt.state.person().typing_in.as_deref()), ("draft", Some("bed")));
    assert!(ran(&mut rt, "tile.focus tile=beds", Actor::Person).ok);
    let at = rt.state.person();
    assert_eq!((at.layer.name(), at.focus.as_str(), at.typing_in.as_deref()), ("tile", "beds", None), "{at:?}");
    assert!(!rt.state.editor.focused, "the text area no longer takes what is typed");
    typed(&mut rt, "x");
    assert!(!rt.state.editor.text.contains('x') || rt.state.editor.text == rt.state.editing.as_ref().unwrap().base, "a key typed with the tree focused is not text in the draft");
    assert!(rt.state.editing.is_some(), "the draft is still open on its tile");
    assert!(ran(&mut rt, "tile.focus tile=bed", Actor::Person).ok);
    assert_eq!((rt.state.person().layer.name(), rt.state.editor.focused), ("draft", true));
}
