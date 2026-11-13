//! One owner each, held by what the window does: every test here is a failure a second decider caused, and goes
//! red when one comes back. `one_owner.rs` scans the source for the same thing; this file presses the window.
use rune::{Key, KeyEvent, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, Outcome};

pub(super) fn leaf(kind: &str, name: &str) -> Value { json!({ "t": "leaf", "kind": kind, "name": name }) }

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
pub(super) fn laid(mut spec: Value) -> Garden {
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
    write(&mut g.app, "Plot, half written");
    let undone = act(&mut g.app, "layout.undo");
    assert!(!undone.ok && undone.said.contains("reader2") && undone.said.contains("holds an edit of"), "{}", undone.said);
    assert!(names(&g.app).contains(&"reader2".to_string()), "the tile that holds the edit is still here");
    assert_eq!(draft(&g.app).map(|d| g.app.layout.name(&d.tile)).as_deref(), Some("reader2"));
    assert_eq!(words(&g.app), "Plot, half written");
    assert_eq!(g.app.journal.len(), 1, "the step is still there to undo once the edit is saved or dropped");
    // The same for a screen opened over it: the layout says no, in the same words.
    screens_are(&mut g, json!([screen_row("beds", json!({ "focus": "bed", "root": leaf("reader", "bed") }), json!([]))]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(!opened.ok && opened.said.contains("holds an edit of"), "{}", opened.said);
    assert_eq!(g.app.screen.name, "desk");
    // Saved, the block is still being written there: the tile stays. Closed, nothing holds it, and the step goes back.
    assert!(act(&mut g.app, "edit.save").ok);
    assert!(!act(&mut g.app, "layout.undo").ok && draft(&g.app).is_some(), "a tile a block is being written in never goes, saved or not");
    assert!(act(&mut g.app, "edit.close").ok);
    assert!(act(&mut g.app, "layout.undo").ok);
    assert!(!names(&g.app).contains(&"reader2".to_string()));
    assert!(draft(&g.app).is_none(), "no draft is left on a tile that is gone");
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
    // The drag let go with Escape is over. The same border dragged again is a change of its own: one step back, and
    // undoing it puts the border back and takes nothing else (the split before it) with it.
    let grip = rt.find("grip/s1/0").expect("the border is where it was");
    rt.pointer_down(grip.0, grip.1);
    rt.frame(0.0);
    rt.pointer_move(grip.0 + 120.0, grip.1);
    rest(&mut rt);
    rt.pointer_up(grip.0 + 120.0, grip.1);
    rest(&mut rt);
    assert!(rect_of(&rt, "tile/beds").unwrap()[2] > beds[2] + 80.0, "the border moved again");
    assert_eq!(rt.state.journal.len(), steps + 1, "a drag after one let go with Escape leaves its own step");
    assert!(ran(&mut rt, "layout.undo", Actor::Person).ok);
    assert_eq!((rect_of(&rt, "tile/beds").unwrap(), names(&rt.state)), (beds, tiles.clone()), "undoing it puts the border back, and the split before it stays");
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
    assert!(!draft(&rt.state).unwrap().buf.takes_keys(), "the block's field no longer takes what is typed");
    typed(&mut rt, "x");
    assert!(!unsaved(&rt.state), "a key typed with the tree focused is not text in the draft");
    assert!(draft(&rt.state).is_some(), "the draft is still open on its tile");
    assert!(ran(&mut rt, "tile.focus tile=bed", Actor::Person).ok);
    assert_eq!((rt.state.person().layer.name(), draft(&rt.state).unwrap().buf.takes_keys()), ("draft", true));
}

// ── who acts, and whether: the row says it, and `rule()` is the one check ─────────────────────────────────────

/// What is the person's alone is said on the action's row, so `actions`, the bar and an agent reading the row are
/// told before they run it; the refusal an agent gets is the row's own words.
#[test]
fn an_action_that_is_the_person_s_says_so_on_its_row_and_an_agent_is_refused_in_its_words() {
    let mut g = garden(ok());
    for id in ["bar.close", "bar.move", "bar.narrow", "notice.dismiss", "tile.focus"] {
        let row = crate::actions::find(id).unwrap().row;
        let why = row.person.unwrap_or_else(|| panic!("{id} is the person's and its row doesn't say so"));
        let line = std::iter::once(id.to_string()).chain(row.required().map(|arg| format!("{arg}=1"))).collect::<Vec<_>>().join(" ");
        let line = if id == "tile.focus" { "tile.focus tile=tree".to_string() } else { line };
        let refused = g.app.act(&line, agent());
        assert!(!refused.ok && refused.said == why, "{line}: {}", refused.said);
    }
    // A row that says nothing is the person's is run by anyone its `touches` lets.
    for action in crate::actions::all().filter(|action| action.row.person.is_none() && action.row.touches == crate::actions::row::Touches::Nothing && action.row.required().next().is_none()) {
        let said = g.app.act(action.row.id, agent()).said;
        for words in ["is the person's", "the person's to", "an agent never", "the person's keys are theirs"] { assert!(!said.contains(words), "{} says `touches: nothing` and no `person`, yet refuses an agent as the person's: {said}", action.row.id) }
    }
}

/// An agent's change to what the person looks at waits until they have been idle, as the row's `touches: screen`
/// says: at the keys a moment ago, it is refused with how long to wait.
#[test]
fn an_agent_s_screen_change_waits_until_the_person_has_been_idle() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("beds", json!({ "focus": "reader", "root": leaf("reader", "reader") }), json!([]))]));
    let mut rt = window(g.app);
    chord(&mut rt, Key::Text("i".into()), primary());
    assert!(rt.state.person().idle.is_some_and(|idle| idle < crate::keys::IDLE), "a key was pressed just now");
    let opened = ran(&mut rt, "screen.open name=beds", agent());
    assert!(!opened.ok && opened.said.contains("the person is at the keys") && opened.said.contains("idle 2s"), "{}", opened.said);
    std::thread::sleep(crate::keys::IDLE + std::time::Duration::from_millis(100));
    let opened = ran(&mut rt, "screen.open name=beds", agent());
    assert!(opened.ok, "{}", opened.said);
}

// ── which tile an address names: `Layout::resolve`, for `tile=`, `to=` and a follower's source ────────────────

/// `tile=role:reader` is the tile whose role that is, refused when two have it (never "the tile named reader");
/// an id's first characters name its tile; and `to=` reads the same addresses `tile=` does.
#[test]
fn every_argument_that_names_a_tile_reads_one_address_grammar() {
    let seeds = json!({ "t": "leaf", "kind": "reader", "name": "seeds", "id": "t-5eed5eed-4e5f-4a6b-8c7d-9e0f1a2b3c4d" });
    let mut g = laid(json!({ "layout": { "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), seeds, leaf("backlinks", "reader")] } } }));
    // Two readers: the role names both, and says how to name one. The backlinks tile named `reader` is not it.
    let two = act(&mut g.app, "tile.split tile=role:reader");
    assert!(!two.ok && two.said.contains("role:reader names 2 tiles") && two.said.contains("use tile=<id>"), "{}", two.said);
    assert_eq!(two.kind, Some("invalid"));
    // One tree: its role is its address, for `tile=` and for `to=` alike.
    let moved = act(&mut g.app, "tile.move tile=t-5eed5eed to=role:tree side=bottom");
    assert!(moved.ok, "{}", moved.said);
    assert_eq!(g.app.steps.last().map(|step| step.tile.as_deref()), Some(Some("t-5eed5eed")));
    // None has it: the resolver says what there is to type.
    let none = act(&mut g.app, "tile.close tile=role:terminal");
    assert!(!none.ok && none.said.contains("no tile has the role terminal; roles here: backlinks, reader, tree"), "{}", none.said);
    let none = act(&mut g.app, "tile.move tile=bed to=role:terminal side=left");
    assert!(!none.ok && none.said.contains("no tile has the role terminal"), "{}", none.said);
    // A plain name is read last, and still is one.
    assert!(act(&mut g.app, "tile.focus tile=reader").ok);
    assert_eq!(g.app.layout.name(&g.app.layout.focus), "reader");
}

// ── where an open lands: `layout::place`, for a new note and an agent's open too ──────────────────────────────

fn note_in(app: &App, tile: &str) -> Option<String> { app.layout.named(tile).and_then(|id| app.note_of(&id)) }

fn three(more: Value) -> Garden {
    let mut spec = json!({ "layout": { "focus": "beds", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), leaf("reader", "seeds")] } } });
    for (key, value) in more.as_object().unwrap() { spec[key] = value.clone() }
    laid(spec)
}

/// The screen says where its opens land (`lands`), and the layout reads it: the person's open from a list, an
/// agent's open and a new note land in the same tile, by the same rule.
#[test]
fn an_open_that_names_no_tile_lands_where_the_screen_says_whoever_asks() {
    let mut g = three(json!({ "lands": "seeds", "newNote": [{ "opens": "lands" }] }));
    let opened = act(&mut g.app, "open id=shed");
    assert_eq!((opened.ok, opened.answer["tile"].as_str()), (true, Some("seeds")), "the person's, from the tree that has the keys: {}", opened.said);
    let opened = g.app.act("open id=beans", agent());
    assert_eq!((opened.ok, opened.answer["tile"].as_str()), (true, Some("seeds")), "an agent's: {}", opened.said);
    assert!(act(&mut g.app, "note.new").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), note_in(&g.app, "seeds").as_deref()), (Some("plot"), Some("new")), "a new note lands there too");
    assert_eq!(draft(&g.app).map(|d| g.app.layout.name(&d.tile)).as_deref(), Some("seeds"));
}

/// `lands` may name a container by its key (the screen validator allows it): an open from outside goes into it,
/// never silently to the first reader.
#[test]
fn lands_naming_a_container_opens_into_it() {
    let layout = json!({ "focus": "beds", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "almanac"), { "t": "columns", "key": "readers", "weights": [1], "kids": [leaf("reader", "bed")] }] } });
    let mut g = laid(json!({ "lands": "readers", "layout": layout }));
    let opened = g.app.act("open id=shed", agent());
    assert_eq!((opened.ok, opened.answer["tile"].as_str()), (true, Some("bed")), "{}", opened.said);
    assert_eq!((note_in(&g.app, "almanac").as_deref(), note_in(&g.app, "bed").as_deref()), (Some("plot"), Some("shed")), "the first reader of the screen is left as it was");
}

/// A screen's rule for new notes is followed, as the door follows it: `float` is a reader over the layout, `tab` a
/// tab on the tile with the keys; the note opens there to be written and the reader it was made from keeps its note.
#[test]
fn a_new_note_opens_where_the_screen_s_rule_says() {
    let mut g = three(json!({ "newNote": [{ "opens": "float" }] }));
    assert!(act(&mut g.app, "tile.focus tile=bed").ok && act(&mut g.app, "note.new").ok);
    let made = draft(&g.app).map(|d| d.tile.clone()).expect("the new note is open to be written");
    assert!(g.app.layout.is_float(&made), "it floats over the screen: {:?}", names(&g.app));
    assert_eq!((g.app.note_of(&made).as_deref(), note_in(&g.app, "bed").as_deref(), g.app.layout.focus.as_str()), (Some("new"), Some("plot"), made.as_str()));
    // (A rule's kinds come as the service resolved them, as a tile's do: `screens.list` serves both.)
    let mut g = three(json!({ "newNote": [{ "opens": "tab", "only": ["screens.reader"] }, { "opens": "lands" }] }));
    assert!(act(&mut g.app, "tile.focus tile=bed").ok && act(&mut g.app, "note.new").ok);
    let made = draft(&g.app).map(|d| d.tile.clone()).unwrap();
    assert!(crate::layout::tree::tabs_of(g.app.layout.tree(), &made).is_some_and(|set| crate::layout::tree::tabs_of(g.app.layout.tree(), "bed") == Some(set)), "a tab beside bed");
    assert_eq!(note_in(&g.app, "bed").as_deref(), Some("plot"));
}
