//! Tiles and screens: the shell draws whatever tree the layout holds, where the layout says; an open lands where
//! `place` says, asked only through the `open` action; and a screen is data that is opened, saved, found broken
//! and reset. Every layout here is opened as a screen the host lists, the way a person's own would be.
use rune::{Key, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, CELL};
use crate::layout::tree::Node;
use crate::tiles;

fn leaf(kind: &str, name: &str) -> Value { json!({ "t": "leaf", "kind": kind, "name": name }) }

/// A window laid out as the screen `beds`, whose layout is `layout`.
fn laid(layout: Value) -> Runtime<App> {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("beds", layout, json!([]))]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(opened.ok, "{}", opened.said);
    window(g.app)
}

/// Every tile on screen sits in the box the layout answers for it, and no tile the layout hides is drawn.
fn sits_as_laid(rt: &Runtime<App>) -> Vec<String> {
    let s = &rt.state;
    let origin = rect_of(rt, "tiles").expect("the tiles' area is drawn");
    let rects = s.layout.rects(s.area, &|_| false);
    let mut shown = Vec::new();
    for (id, r) in &rects {
        let name = s.layout.name(id);
        let drawn = rect_of(rt, &format!("tile/{name}"));
        if r.cols <= 0.0 || r.rows <= 0.0 { assert!(drawn.is_none(), "{name} has no room and is drawn"); continue }
        let want = [origin[0] + r.col as f32 * CELL.0, origin[1] + r.row as f32 * CELL.1, r.cols as f32 * CELL.0, r.rows as f32 * CELL.1];
        assert_eq!(drawn, Some(want), "{name} sits where the layout says");
        shown.push(name);
    }
    for id in s.layout.all() { if !rects.iter().any(|(x, _)| *x == id) { assert!(rect_of(rt, &format!("tile/{}", s.layout.name(&id))).is_none(), "{id} is hidden and drawn") } }
    shown
}

#[test]
fn a_split_draws_its_tiles_side_by_side_and_its_border_drags() {
    let mut rt = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.25, 0.75], "kids": [leaf("tree", "beds"), { "t": "split", "dir": "col", "weights": [0.5, 0.5], "kids": [leaf("reader", "bed"), leaf("reader", "seeds")] }] } }));
    assert_eq!(sits_as_laid(&rt), ["beds", "bed", "seeds"]);
    let (beds, bed, seeds) = (rect_of(&rt, "tile/beds").unwrap(), rect_of(&rt, "tile/bed").unwrap(), rect_of(&rt, "tile/seeds").unwrap());
    assert!(beds[0] + beds[2] <= bed[0] && bed[1] + bed[3] <= seeds[1] && bed[0] == seeds[0], "the tree beside a column of two readers");
    // The border between the tree and the readers, dragged to the right: one act a move, and one step back.
    let grip = rt.find("grip/s1/0").expect("the split's border has a grip");
    drag(&mut rt, grip, (grip.0 + 240.0, grip.1));
    let wider = rect_of(&rt, "tile/beds").unwrap();
    assert!(wider[2] > beds[2] + 200.0, "the tree is wider: {} then {}", beds[2], wider[2]);
    assert!(rt.state.steps.iter().any(|step| step.action == "layout.resize" && step.ok));
    sits_as_laid(&rt);
    rt.update(|s, _| { s.act("layout.undo", Actor::Person); });
    rest(&mut rt);
    assert_eq!(rect_of(&rt, "tile/beds").unwrap()[2], beds[2], "the whole drag is one step back");
}

#[test]
fn tabs_draw_the_one_in_front_and_a_press_on_a_tab_brings_it_forward() {
    let mut rt = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), { "t": "tabs", "active": 0, "tabs": [leaf("reader", "bed"), leaf("backlinks", "roots")] }] } }));
    assert_eq!(sits_as_laid(&rt), ["beds", "bed"]);
    assert!(rt.find("tile/bed/tab/bed").is_some() && rt.find("tile/bed/tab/roots").is_some(), "the set's tabs are in its title");
    // A hidden tab asks nothing: what it would read is asked when it shows.
    assert!(rt.state.store().asks_of("roots").is_empty());
    press(&mut rt, "tile/bed/tab/roots");
    assert_eq!(sits_as_laid(&rt), ["beds", "roots"]);
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "roots");
    assert!(!rt.state.store().asks_of("roots").is_empty() && rt.state.store().asks_of("bed").is_empty());
}

#[test]
fn a_dock_slides_shut_to_a_strip_at_its_edge_and_open_again() {
    let mut rt = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.7, 0.3], "kids": [leaf("reader", "bed"), { "t": "dock", "edge": "right", "open": true, "policy": { "overlay": false }, "kid": leaf("backlinks", "roots") }] } }));
    assert_eq!(sits_as_laid(&rt), ["bed", "roots"]);
    let wide = rect_of(&rt, "tile/bed").unwrap()[2];
    rt.update(|s, _| { s.act("dock.toggle side=right", Actor::Person); });
    rest(&mut rt);
    assert_eq!(sits_as_laid(&rt), ["bed"], "shut, its tile is not drawn");
    assert!(rect_of(&rt, "tile/bed").unwrap()[2] > wide, "and the reader has its room");
    press(&mut rt, "dock/right");
    assert_eq!(sits_as_laid(&rt), ["bed", "roots"], "a press on its strip slides it open");
    // A dock that slides over the layout leaves the tiles under it where they were.
    let mut over = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.7, 0.3], "kids": [leaf("reader", "bed"), { "t": "dock", "edge": "right", "open": true, "kid": leaf("backlinks", "roots") }] } }));
    let (bed, roots) = (rect_of(&over, "tile/bed").unwrap(), rect_of(&over, "tile/roots").unwrap());
    assert!(roots[0] < bed[0] + bed[2] && roots[2] > 0.0, "it is drawn over the reader's right edge: {bed:?} {roots:?}");
    sits_as_laid(&over);
    over.update(|s, _| { s.act("dock.toggle side=right", Actor::Person); });
    rest(&mut over);
    assert_eq!(rect_of(&over, "tile/bed").unwrap(), bed, "shut or open, the reader keeps its box");
}

#[test]
fn columns_and_a_flow_are_drawn_from_the_same_boxes() {
    let rt = laid(json!({ "focus": "a", "root": { "t": "columns", "key": "lanes", "weights": [1, 1, 2], "kids": [leaf("reader", "a"), leaf("reader", "b"), leaf("reader", "c")] } }));
    assert_eq!(sits_as_laid(&rt), ["a", "b", "c"]);
    let (a, c) = (rect_of(&rt, "tile/a").unwrap(), rect_of(&rt, "tile/c").unwrap());
    assert!((c[2] - 2.0 * a[2]).abs() <= 2.0 * CELL.0, "the third column has twice the first's share: {} and {}", a[2], c[2]);
    // A flow sizes its own columns: the wide one first, the rest as wide as there is room for, then spines.
    let flow = laid(json!({ "focus": "b", "root": { "t": "flow", "key": "river", "anchor": 1, "kids": [leaf("reader", "a"), leaf("reader", "b"), leaf("reader", "c"), leaf("reader", "d"), leaf("reader", "e")] } }));
    let shown = sits_as_laid(&flow);
    assert!(shown.contains(&"b".to_string()) && shown.len() >= 3, "{shown:?}");
    assert!(matches!(flow.state.layout.tree(), Node::Flow { .. }));
    assert!(rect_of(&flow, "grip/f1/0").is_none(), "a flow's borders aren't dragged: it sizes its columns itself");
}

#[test]
fn a_float_is_drawn_over_the_tiles_where_it_was_left() {
    let rt = laid(json!({ "focus": "bed", "root": leaf("reader", "bed"), "floats": [{ "tile": leaf("backlinks", "roots"), "rect": { "col": 40, "row": 6, "cols": 50, "rows": 20 } }] }));
    assert_eq!(sits_as_laid(&rt), ["bed", "roots"]);
    let (bed, roots) = (rect_of(&rt, "tile/bed").unwrap(), rect_of(&rt, "tile/roots").unwrap());
    assert_eq!([roots[0] - bed[0], roots[1] - bed[1], roots[2], roots[3]], [40.0 * CELL.0, 6.0 * CELL.1, 50.0 * CELL.0, 20.0 * CELL.1]);
    let order: Vec<String> = rt.elements().into_iter().filter_map(|e| e.key).filter(|k| k == "tile/bed" || k == "tile/roots").collect();
    assert_eq!(order, ["tile/bed", "tile/roots"], "the float is drawn after the tile it is over");
}

/// Every kind a shipped screen names is one the service's rows give a drawer this window has, and every act line of
/// its toolbar is an action here: the screens extension, as the service answers it, opens whole in this window.
#[test]
fn every_kind_a_shipped_screen_names_resolves_and_its_toolbar_is_act_lines() {
    let g = garden(ok());
    let shipped = g.app.screens();
    assert_eq!(shipped.iter().filter(|s| s.starts()).count(), 1, "one screen says a window starts on it");
    assert!(shipped.len() >= 5, "{:?}", shipped.iter().map(|s| s.name.clone()).collect::<Vec<_>>());
    for screen in shipped {
        assert!(screen.problems.is_empty(), "{}: {:?}", screen.name, screen.problems);
        let layout = screen.layout().unwrap_or_else(|| panic!("{} has a layout", screen.name));
        for id in layout.all() {
            let spec = layout.spec(&id).unwrap();
            let row = g.app.kind_row(&spec.kind).unwrap_or_else(|| panic!("{}: no kind {} here", screen.name, spec.kind));
            assert!(tiles::drawer_of(row).is_some(), "{}: {} has a drawer", screen.name, spec.kind);
            // What it names by name is in its layout.
            if let Some(source) = spec.text("source").and_then(|s| s.strip_prefix("tile:")) { assert!(layout.named(source).is_some(), "{}: {} follows {source}, which it hasn't", screen.name, layout.name(&id)) }
        }
        if let Some(lands) = screen.read().and_then(|spec| spec.lands()) { assert!(layout.named(lands).is_some(), "{}: opens land in {lands}", screen.name) }
        for line in screen.read().map(|spec| spec.toolbar()).unwrap_or_default() { assert!(crate::actions::find(line.split_whitespace().next().unwrap()).is_some(), "{}: {line} is an action", screen.name) }
        // It is the door's saved form: what it reads to saves back to a layout that reads the same.
        assert_eq!(crate::layout::Layout::read(&layout.save()).save(), layout.save(), "{}", screen.name);
    }
}

// ── where an open lands: asked through the open action, never round it ────────────────────────────────────────

fn two_readers() -> Runtime<App> {
    laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), leaf("reader", "seeds")] } }))
}

fn opened(rt: &mut Runtime<App>, line: &'static str, by: Actor) -> crate::actions::Outcome {
    let (send, got) = std::sync::mpsc::channel();
    rt.update(move |s, _| { let _ = send.send(s.act(line, by)); });
    rest(rt);
    got.recv().unwrap()
}

#[test]
fn an_open_lands_where_the_layout_says_from_the_tile_it_comes_from() {
    let mut rt = two_readers();
    let note = |rt: &Runtime<App>, tile: &str| rt.state.note_of(&rt.state.layout.named(tile).unwrap());
    // From the tree: the first reader that takes it.
    press(&mut rt, "tile/beds/row/shed");
    assert_eq!((note(&rt, "bed").as_deref(), note(&rt, "seeds").as_deref()), (Some("shed"), Some("plot")));
    // From a reader's own row: that reader, and it remembers where from.
    let outcome = opened(&mut rt, "open id=beans tile=seeds", Actor::Person);
    assert_eq!((outcome.ok, outcome.answer["tile"].as_str()), (true, Some("seeds")));
    assert_eq!((note(&rt, "bed").as_deref(), note(&rt, "seeds").as_deref()), (Some("shed"), Some("beans")));
    assert_eq!(rt.state.ui("seeds").history, ["plot"], "each reader keeps its own way back");
    assert!(opened(&mut rt, "back tile=seeds", Actor::Person).ok);
    assert_eq!((note(&rt, "bed").as_deref(), note(&rt, "seeds").as_deref()), (Some("shed"), Some("plot")));
    // The person's open that names no tile lands in the reader they are in.
    opened(&mut rt, "tile.focus tile=seeds", Actor::Person);
    opened(&mut rt, "open id=onions", Actor::Person);
    assert_eq!((note(&rt, "bed").as_deref(), note(&rt, "seeds").as_deref()), (Some("shed"), Some("onions")));
}

#[test]
fn an_agent_s_open_lands_without_the_person_s_keys_and_beside_a_reader_that_holds_unsaved_text() {
    let mut rt = two_readers();
    let before = rt.state.layout.focus.clone();
    let outcome = opened(&mut rt, "open id=shed", Actor::Agent("seedling-agent".into()));
    assert_eq!((outcome.ok, outcome.answer["tile"].as_str(), rt.state.layout.focus.as_str()), (true, Some("bed"), before.as_str()), "the first reader takes it; the keys stay");
    // The person edits in that reader: the agent's next open is given a reader of its own beside it, and says why.
    rt.update(|s, _| { s.act("edit tile=bed", Actor::Person); write(s, "Shed, rewritten"); });
    rest(&mut rt);
    let outcome = opened(&mut rt, "open id=beans tile=bed", Actor::Agent("seedling-agent".into()));
    assert!(!outcome.ok && outcome.said.contains("the person is in an edit on bed"), "aimed at the tile they type in, it is refused: {}", outcome.said);
    let outcome = opened(&mut rt, "open id=beans", Actor::Agent("seedling-agent".into()));
    assert_eq!((outcome.ok, outcome.answer["tile"].as_str()), (true, Some("seeds")), "named no tile, it lands in the reader that is free: {}", outcome.said);
    assert_eq!((words(&rt.state), rt.state.layout.focus.as_str()), ("Shed, rewritten", before.as_str()));
}

#[test]
fn an_open_on_a_screen_with_no_reader_makes_one_and_says_so() {
    let mut rt = laid(json!({ "focus": "beds", "root": leaf("tree", "beds") }));
    press(&mut rt, "tile/beds/row/shed");
    assert_eq!(sits_as_laid(&rt), ["beds", "reader"], "a reader opened for it, at the right edge");
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("shed"));
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said == "no reader here: a new one opened for it"), "{:?}", rt.state.notice);
}

// ── the wave's sentence ───────────────────────────────────────────────────────────────────────────────────────

/// Evan opens native, splits the reader, drags a tile to the dock, saves the screen as a note, breaks a kind's
/// name in that note and reads why on the tile, then resets.
#[test]
fn split_drag_to_a_dock_save_as_a_note_break_a_kind_read_why_and_reset() {
    let mut g = garden(ok());
    let asked = g.asked.clone();
    // The window opens on the screen it ships: the tree, a reader, and the note's details in a dock.
    assert_eq!((g.app.screen.name.as_str(), g.app.layout.names.0.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>()), ("desk", vec!["tree", "reader", "props", "backlinks"]));
    let mut rt = window(std::mem::replace(&mut g.app, App::new(Box::new(crate::client::Nowhere(None)), "")));
    assert_eq!(sits_as_laid(&rt), ["tree", "reader", "props", "backlinks"]);

    // Split the reader, by its chord: a second reader on the same note, with the keys.
    chord(&mut rt, Key::Command('d'), primary());
    assert_eq!(sits_as_laid(&rt), ["tree", "reader", "reader2", "props", "backlinks"]);
    assert_eq!((rt.state.layout.focus.as_str(), rt.state.note_of("reader2").as_deref()), ("reader2", Some("plot")));

    // Drag the tree by its title onto the middle of the backlinks, in the dock: it becomes a tab there.
    let (from, onto) = (rt.find("tile/tree/bar").unwrap(), rect_of(&rt, "tile/backlinks").unwrap());
    drag(&mut rt, (from.0 - 40.0, from.1), (onto[0] + onto[2] / 2.0, onto[1] + onto[3] / 2.0));
    assert!(rt.state.steps.iter().any(|step| step.line() == "tile.move side=center to=backlinks tile=tree" && step.ok), "{:?}", rt.state.steps.iter().map(crate::actions::Step::line).collect::<Vec<_>>());
    assert_eq!(sits_as_laid(&rt), ["reader", "reader2", "props", "tree"], "the tree is the dock's tab in front; the backlinks are behind it");
    assert!(rt.find("tile/tree/tab/backlinks").is_some());

    // Save it as a screen note: the service's write, with the arrangement as it stands.
    rt.update(|s, _| { s.act("screen.save name=\"Garden work\"", Actor::Person); });
    rest(&mut rt);
    let sent = asked.borrow().iter().rev().find(|a| a["action"] == "screens.save").cloned().expect("the screen was saved");
    assert_eq!((sent["spec"]["name"].as_str(), sent["spec"]["title"].as_str(), sent["base"].is_null(), sent["mutation"]["author"].as_str()), (Some("Garden work"), Some("Garden work"), true, Some("user")));
    assert_eq!(sent["spec"]["layout"], rt.state.layout.save(), "its layout is the arrangement, in the door's saved form");
    assert_eq!(sent["spec"]["toolbar"], json!(rt.state.screens().iter().find(|s| s.starts()).unwrap().read().unwrap().toolbar()), "and the screen's own fields stay");
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.contains("every door on this outline opens it")), "{:?}", rt.state.notice);
    assert_eq!(rt.state.screen.note(), Some(("screen-note", 1)), "the arrangement is that note's screen now");

    // Someone breaks a kind's name in the note. The service lists the screen with what is wrong, for the tile.
    let mut broken = sent["spec"]["layout"].clone();
    fn rekind(n: &mut Value, name: &str, kind: &str) -> bool {
        if n["t"] == "leaf" { if n["name"] == name { n["kind"] = json!(kind); return true } return false }
        ["kids", "tabs"].iter().any(|k| n[*k].as_array_mut().is_some_and(|kids| kids.iter_mut().any(|kid| rekind(kid, name, kind)))) || (n.get("kid").is_some() && rekind(&mut n["kid"], name, kind))
    }
    assert!(rekind(&mut broken["root"], "reader2", "raeder"), "{broken}");
    *g.screens.borrow_mut() = json!([screen_row("beds", broken.clone(), json!([{ "tile": "reader2", "said": "no tile kind raeder here · did you mean reader?" }]))]);
    let key = watch_of(&asked, "screens.list", |_| true);
    rt.update(move |s, _| { s.act("notice.dismiss", Actor::Person); });
    host_says_window(&mut rt, &g.said, json!({ "event": { "domain": "queries", "action": "queries.changed", "changes": [{ "key": key, "generation": 9 }] } }));
    // Opened, the tile says why, in the service's words, and shows its spec as data; the rest of the screen draws.
    rt.update(|s, _| { s.act("screen.open name=beds", Actor::Person); });
    rest(&mut rt);
    let texts: Vec<String> = rt.elements().into_iter().filter_map(|e| e.text).collect();
    assert!(rt.find("tile/reader2/problem/0").is_some() && texts.iter().any(|t| t == "no tile kind raeder here · did you mean reader?"), "{texts:?}");
    assert!(rt.find("tile/reader2/data").is_some() && rt.find("tile/reader/title").is_some(), "the broken tile is its spec; the reader beside it still reads");

    // The note is put right, and reset lays the window out as the screen has it now.
    *g.screens.borrow_mut() = json!([screen_row("beds", sent["spec"]["layout"].clone(), json!([]))]);
    let key = watch_of(&asked, "screens.list", |_| true);
    host_says_window(&mut rt, &g.said, json!({ "event": { "domain": "queries", "action": "queries.changed", "changes": [{ "key": key, "generation": 10 }] } }));
    chord(&mut rt, Key::Command('r'), rune::Mods { shift: true, ..primary() });
    assert!(rt.find("tile/reader2/problem/0").is_none() && rt.find("tile/reader2/title").is_some(), "reset: the tile reads again");
    assert_eq!(sits_as_laid(&rt), ["reader", "reader2", "props", "tree"]);
    // And every step of it can be taken back.
    rt.update(|s, _| { s.act("screen.open name=desk", Actor::Person); });
    rest(&mut rt);
    assert_eq!(sits_as_laid(&rt), ["tree", "reader", "props", "backlinks"]);
}

/// A screen opened by mistake is taken back whole: `layout.undo` puts back the arrangement and the screen it is of,
/// so a save after it is never another screen's note written over with this one's tiles.
#[test]
fn undo_after_a_screen_is_opened_goes_back_to_the_screen_it_was() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("beds", json!({ "focus": "bed", "root": leaf("reader", "bed") }), json!([]))]));
    assert!(act(&mut g.app, "tile.split").ok);
    let before = g.app.layout.save();
    assert!(act(&mut g.app, "screen.open name=beds").ok);
    assert_eq!((g.app.screen.name.as_str(), g.app.screen.note()), ("beds", Some(("beds-note", 2))));
    assert!(act(&mut g.app, "layout.undo").ok);
    assert_eq!(g.app.layout.save(), before, "the arrangement is the one before the screen was opened");
    assert_eq!((g.app.screen.name.as_str(), g.app.screen.note()), ("desk", None), "and it is that screen's again, not the one undone");
    let saved = act(&mut g.app, "screen.save");
    assert!(!saved.ok && saved.said.contains("extension's screen: a screen you make takes a name of its own"), "a save now is the desk's, never written over beds: {}", saved.said);
    assert!(!g.asked.borrow().iter().any(|a| a["action"] == "screens.save"));
    // One more step back is the split, on the same screen.
    assert!(act(&mut g.app, "layout.undo").ok);
    assert_eq!((g.app.screen.name.as_str(), g.app.layout.names.0.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>()), ("desk", vec!["tree", "reader", "props", "backlinks"]));
    // A reset is the same screen read again: undone, the screen stays as it is served now.
    assert!(act(&mut g.app, "screen.open name=beds").ok && act(&mut g.app, "tile.split").ok && act(&mut g.app, "screen.reset").ok);
    assert!(act(&mut g.app, "layout.undo").ok);
    assert_eq!((g.app.screen.name.as_str(), g.app.layout.names.0.len()), ("beds", 2));
}

/// The host says a line to a drawn window, and what follows lands on its next frames.
fn host_says_window(rt: &mut Runtime<App>, said: &Said, line: Value) {
    said.borrow_mut().push_back(line);
    rest(rt);
    rt.update(|s, _| { s.settle(); });
    rest(rt);
}

/// The arrangement is kept in a file a window, written on each change, and a window opens as it was left.
#[test]
fn the_arrangement_is_kept_in_a_file_and_the_window_opens_as_it_was_left() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-kept-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("native-garden.layout.json");
    let mut app = garden(ok()).app.arranged_in(file.clone());
    assert!(!file.exists(), "nothing is written until something changes");
    act(&mut app, "tile.split dir=down");
    act(&mut app, "open id=shed");
    act(&mut app, "tree.fold id=plot open=true");
    let kept: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!((kept["screen"].as_str(), kept["tiles"]["reader2"]["note"].as_str(), kept["layout"]["focus"].as_str()), (Some("desk"), Some("shed"), Some("reader2")));
    // Another run, on the same file: the same tiles, the same notes, the same folders.
    let again = garden(ok()).app.arranged_in(file.clone());
    assert_eq!(again.layout.save(), app.layout.save());
    assert_eq!((again.note_of("reader2").as_deref(), again.ui("tree").unfolded.iter().next().map(String::as_str), again.layout.focus.as_str()), (Some("shed"), Some("plot"), "reader2"));
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn a_screen_s_own_keys_run_first_while_a_tile_has_the_keys_and_never_while_a_block_is_written() {
    let mut g = garden(ok());
    let mut row = screen_row("potting", json!({ "focus": "reader", "root": { "t": "split", "dir": "row", "weights": [0.4, 0.6], "kids": [{ "t": "leaf", "kind": "query", "name": "beds", "query": "type=chore" }, { "t": "leaf", "kind": "reader", "name": "reader" }] } }), json!([]));
    // As a screen writes its keys: a capital is the letter with Shift; one runs in a tile it names; one holds only off a reader.
    row["spec"]["keys"] = json!([
        { "key": "S", "action": "bar.open", "args": { "scope": "screens" } },
        { "key": "x", "action": "tile.close", "tile": "beds", "only": ["reader"] },
        { "key": "b", "action": "bar.open", "unless": ["reader"] },
    ]);
    screens_are(&mut g, json!([row]));
    assert!(act(&mut g.app, "screen.open name=potting").ok);
    act(&mut g.app, "open id=shed");
    let mut rt = window(g.app);
    // The keys are listed with the rows', the screen's own first and said to be the screen's.
    let listed = crate::keys::rows(&rt.state);
    assert_eq!(listed[0], json!({ "chord": "S", "line": "bar.open scope=screens", "layer": "tile", "from": "screen" }));
    assert_eq!(listed[1], json!({ "chord": "x", "line": "tile.close tile=beds", "layer": "tile", "from": "screen", "only": ["reader"] }));
    // While a block is written the keys are its field's: a letter the screen binds is a letter typed.
    press(&mut rt, "tile/reader/edit");
    typed(&mut rt, "x");
    assert!(words(&rt.state).ends_with('x') && rt.state.layout.named("beds").is_some(), "typed, not run: {:?}", words(&rt.state));
    rt.update(|s, _| { assert!(s.act("edit.close discard=true", Actor::Person).ok); });
    rest(&mut rt);
    // On a tile: one that holds off a reader does nothing on the reader; the capital runs its action with its arguments.
    typed(&mut rt, "b");
    assert!(!rt.state.bar.open, "b is not the reader's");
    chord(&mut rt, Key::Text("S".into()), Mods { shift: true, ..Mods::default() });
    assert!(rt.state.bar.open && rt.state.steps.last().is_some_and(|step| step.line() == "bar.open scope=screens"), "{:?}", rt.state.steps.last().map(|step| step.line()));
    chord(&mut rt, Key::Escape, Mods::default());
    // One that names a tile runs there, as the person.
    typed(&mut rt, "x");
    assert!(rt.state.layout.named("beds").is_none() && rt.state.layout.named("reader").is_some(), "the screen's x closed the tile it names");
}
