//! Keys everywhere (K1): the window worked without the mouse, by real key events through the runtime. A tree and
//! a list have a cursor row that is no hover and no open-note mark, kept by its id; a reader has a reading line;
//! Tab goes round the tiles in the layout's order and a digit jumps to one; Escape steps back one thing at a time;
//! and one hint row under the tiles says the keys of the tile that has them, from the key table.
use rune::{Key, Mods, Runtime};
use serde_json::json;

use super::support::*;
use crate::actions::{Actor, App};

fn key(rt: &mut Runtime<App>, key: Key) { chord(rt, key, Mods::default()) }
fn letter(rt: &mut Runtime<App>, text: &str) { key(rt, Key::Text(text.to_string())) }
fn cursor(rt: &Runtime<App>, tile: &str) -> Option<String> { rt.state.ui(tile).cursor.clone() }
fn focus(rt: &Runtime<App>) -> String { rt.state.layout.name(&rt.state.layout.focus) }
fn does(rt: &Runtime<App>) -> Vec<&'static str> { rt.state.hinted().into_iter().map(|hint| hint.does).collect() }
fn run(rt: &mut Runtime<App>, line: &str) { let line = line.to_string(); rt.update(move |s, _| { assert!(s.act(&line, Actor::Person).ok, "{line}"); }); rest(rt); }
fn rows(rt: &Runtime<App>, tile: &str) -> Vec<String> { rt.state.rows_of(tile).iter().map(|row| row.id.clone()).collect() }

#[test]
fn a_tree_s_cursor_moves_by_letters_and_arrows_folds_climbs_and_opens_its_row() {
    let g = garden(ok());
    let mut rt = window(g.app);
    // A press on a row gives its tile the keys and puts the cursor on that row.
    press(&mut rt, "tile/tree/row/plot");
    assert_eq!((focus(&rt).as_str(), cursor(&rt, "tree").as_deref()), ("tree", Some("plot")));
    run(&mut rt, "tree.fold id=plot open=true");
    let listed = rows(&rt, "tree");
    assert!(listed.len() >= 3, "{listed:?}");
    // j and the down arrow are one step each; k and the up arrow one back. The cursor is a row by its id.
    letter(&mut rt, "j");
    assert_eq!(cursor(&rt, "tree"), Some(listed[1].clone()));
    key(&mut rt, Key::Down);
    assert_eq!(cursor(&rt, "tree"), Some(listed[2].clone()));
    letter(&mut rt, "k");
    key(&mut rt, Key::Up);
    assert_eq!(cursor(&rt, "tree").as_deref(), Some("plot"));
    // The ends, and a step past an end stays on it.
    key(&mut rt, Key::End);
    assert_eq!(cursor(&rt, "tree"), listed.last().cloned());
    letter(&mut rt, "j");
    assert_eq!(cursor(&rt, "tree"), listed.last().cloned(), "the last row is the last");
    key(&mut rt, Key::Home);
    assert_eq!(cursor(&rt, "tree").as_deref(), Some("plot"));
    // The note the reader shows is another mark: moving the cursor opened nothing.
    let open = rt.state.note_of("reader");
    letter(&mut rt, "j");
    letter(&mut rt, "k");
    assert_eq!(rt.state.note_of("reader"), open);
    // h folds the open folder, and its rows go; l (and the right arrow) unfold it again.
    assert!(rt.state.ui("tree").unfolded.contains("plot"));
    letter(&mut rt, "h");
    assert!(!rt.state.ui("tree").unfolded.contains("plot"), "h folded the cursor's row");
    key(&mut rt, Key::Right);
    assert!(rt.state.ui("tree").unfolded.contains("plot"), "the right arrow unfolded it");
    // On a row that folds nothing, h climbs to the row it is under.
    run(&mut rt, "list.pick id=beans tile=tree");
    assert_eq!(cursor(&rt, "tree").as_deref(), Some("beans"));
    key(&mut rt, Key::Left);
    assert_eq!(cursor(&rt, "tree").as_deref(), Some("plot"), "the left arrow went to the row beans is under");
    // Space folds or unfolds; the cursor stays on its row by its id while the rows change under it.
    key(&mut rt, Key::End);
    let last = cursor(&rt, "tree").unwrap();
    run(&mut rt, "tree.fold id=onions open=true");
    assert_eq!(cursor(&rt, "tree"), Some(last.clone()), "a folder opened above it: the cursor is on the same note");
    assert!(rows(&rt, "tree").len() > listed.len());
    // Return opens the row the cursor is on, where the tree's opens land, by the one pick.
    key(&mut rt, Key::Enter);
    assert_eq!(rt.state.note_of("reader"), Some(last.clone()));
    assert!(rt.state.steps.iter().any(|step| step.line() == "list.pick" && step.ok), "Return ran the list's own pick");
    // What peek says of the tile: its cursor, beside the note its reader shows.
    let facts = (rt.state.drawer_of("tree").unwrap().facts)(&rt.state.cx("tree").unwrap());
    assert_eq!(facts["cursor"], json!(last));
}

#[test]
fn a_page_of_a_long_list_is_the_rows_in_view_and_the_cursor_s_row_is_brought_into_view() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("seed-list", json!({ "focus": "seeds", "root": { "t": "leaf", "kind": "query", "name": "seeds", "query": "type=seed" } }), json!([]))]));
    assert!(act(&mut g.app, "screen.open name=seed-list").ok);
    let mut rt = window(g.app);
    rest(&mut rt);
    let room = rt.state.ui("seeds").room.expect("the list told its tile how many rows its view shows");
    assert!(room >= 4.0, "{room}");
    let ids = rows(&rt, "seeds");
    // The first step is on the first row; a page moves the rows in view less one, as the door's lists do.
    letter(&mut rt, "j");
    assert_eq!(cursor(&rt, "seeds"), Some(ids[0].clone()));
    key(&mut rt, Key::PageDown);
    let page = crate::cursor::page_rows(room) as usize;
    assert_eq!(cursor(&rt, "seeds"), Some(ids[page].clone()));
    key(&mut rt, Key::PageDown);
    key(&mut rt, Key::PageDown);
    let at = cursor(&rt, "seeds").unwrap();
    assert_eq!(at, ids[page * 3]);
    // A row far down the list is built and inside the list's scroll: the cursor is seen.
    let (row, view) = (rect_of(&rt, &format!("tile/seeds/row/{at}")).expect("the cursor's row is built"), rect_of(&rt, "tile/seeds/scroll").unwrap());
    assert!(row[1] >= view[1] - 1.0 && row[1] + row[3] <= view[1] + view[3] + 1.0, "the cursor's row is in view: {row:?} in {view:?}");
    key(&mut rt, Key::End);
    assert_eq!(cursor(&rt, "seeds"), ids.last().cloned());
    assert!(rect_of(&rt, &format!("tile/seeds/row/{}", ids.last().unwrap())).is_some(), "the last of 600 rows is in view");
    key(&mut rt, Key::PageUp);
    assert_eq!(cursor(&rt, "seeds"), Some(ids[ids.len() - 1 - page].clone()));
}

#[test]
fn a_reader_s_keys_move_a_reading_line_scroll_its_page_and_go_back_forward_and_up() {
    let g = garden(ok());
    let mut rt = window(g.app);
    run(&mut rt, "open id=shed");
    assert_eq!((focus(&rt).as_str(), rt.state.note_of("reader").as_deref()), ("reader", Some("shed")));
    let parts = rt.state.shown_of("reader").unwrap().parts.len();
    assert!(parts >= 2, "the shed's page has parts to move through: {parts}");
    // j puts the reading line on the first part, and again on the next; k goes back. It is drawn beside its part.
    letter(&mut rt, "j");
    assert_eq!(rt.state.ui("reader").reading, Some(0));
    key(&mut rt, Key::Down);
    assert_eq!(rt.state.ui("reader").reading, Some(1));
    assert!(rt.find("tile/reader/reading/1").is_some() && rt.find("tile/reader/reading/0").is_none(), "the line is beside the part it is on, and no other");
    letter(&mut rt, "k");
    assert_eq!(rt.state.ui("reader").reading, Some(0));
    // The page's own keys run the scroll action, which never moves the reading line.
    for (pressed, line) in [(Key::PageDown, "scroll by=1"), (Key::Text(" ".into()), "scroll by=1"), (Key::PageUp, "scroll by=-1"), (Key::End, "scroll to=end"), (Key::Home, "scroll to=top")] {
        let from = rt.state.steps.len();
        key(&mut rt, pressed);
        assert!(rt.state.steps[from..].iter().any(|step| step.line() == line && step.ok), "{line}: {:?}", rt.state.steps[from..].iter().map(crate::actions::Step::line).collect::<Vec<_>>());
    }
    chord(&mut rt, Key::Text("G".into()), Mods { shift: true, ..Mods::default() });
    assert_eq!(rt.state.steps.last().map(crate::actions::Step::line).as_deref(), Some("scroll to=end"));
    assert_eq!(rt.state.ui("reader").reading, Some(0), "scrolling left the reading line where it was");
    // alt+left goes back, alt+right forward again, and u opens the note this one is under.
    let before = rt.state.ui("reader").history.last().cloned().expect("the reader came from somewhere");
    chord(&mut rt, Key::Left, Mods { alt: true, ..Mods::default() });
    assert_eq!(rt.state.note_of("reader"), Some(before.clone()));
    assert_eq!(rt.state.ui("reader").reading, None, "another note's page has its own reading line");
    chord(&mut rt, Key::Right, Mods { alt: true, ..Mods::default() });
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("shed"), "forward again to the note it went back from");
    key(&mut rt, Key::Backspace);
    assert_eq!(rt.state.note_of("reader"), Some(before));
    run(&mut rt, "open id=beans");
    assert!(rt.state.ui("reader").ahead.is_empty(), "a new open has nowhere forward of it");
    letter(&mut rt, "u");
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("plot"), "u opened the note beans is under");
    assert_eq!(rt.state.ui("reader").history.last().map(String::as_str), Some("beans"));
}

#[test]
fn tab_goes_round_the_tiles_in_the_layout_s_order_and_a_digit_gives_its_tile_the_keys() {
    let g = garden(ok());
    let mut rt = window(g.app);
    let stops: Vec<String> = rt.state.tab_stops().iter().map(|id| rt.state.layout.name(id)).collect();
    assert!(stops.len() >= 3, "{stops:?}");
    let start = stops.iter().position(|stop| *stop == focus(&rt)).expect("the tile with the keys is a stop");
    // Tab is the next stop, round the end; Shift+Tab the one before. Rune's own traversal is never asked.
    for n in 1..=stops.len() {
        key(&mut rt, Key::Tab);
        assert_eq!(focus(&rt), stops[(start + n) % stops.len()], "Tab {n}");
        let rune_s = std::rc::Rc::new(std::cell::RefCell::new(None));
        rt.update({ let seen = rune_s.clone(); move |_, tx| { *seen.borrow_mut() = tx.focused().map(str::to_owned); } });
        assert_eq!(rune_s.borrow().as_deref(), Some(format!("tile/{}", focus(&rt)).as_str()), "Rune's focus is on the tile the layout names");
    }
    chord(&mut rt, Key::Tab, Mods { shift: true, ..Mods::default() });
    assert_eq!(focus(&rt), stops[(start + stops.len() - 1) % stops.len()]);
    // Each title says its number, and that digit gives its tile the keys.
    for (n, stop) in stops.iter().enumerate().take(9) {
        let said = rt.elements().into_iter().find(|e| e.key.as_deref() == Some(format!("tile/{stop}/stop").as_str())).and_then(|e| e.text).unwrap_or_default();
        assert_eq!(said, (n + 1).to_string(), "{stop}'s title says its number");
        letter(&mut rt, &(n + 1).to_string());
        assert_eq!(focus(&rt), *stop);
    }
    // A digit past the last stop is refused, in words.
    let from = rt.state.steps.len();
    letter(&mut rt, "9");
    assert!(rt.state.steps[from..].iter().any(|step| step.action == "keys.stop" && !step.ok && step.said.contains("no tile 9")), "{:?}", rt.state.steps[from..].iter().map(|step| &step.said).collect::<Vec<_>>());
}

#[test]
fn the_next_tab_of_a_set_comes_forward_by_key() {
    let g = garden(ok());
    let mut rt = window(g.app);
    run(&mut rt, "layout.move tile=props to=backlinks where=tabs");
    let front = |rt: &Runtime<App>| rt.state.shown_tiles().iter().map(|id| rt.state.layout.name(id)).filter(|name| name == "props" || name == "backlinks").collect::<Vec<_>>();
    let was = front(&rt);
    assert_eq!(was.len(), 1, "one of the two is in front: {was:?}");
    run(&mut rt, &format!("tile.focus tile={}", was[0]));
    chord(&mut rt, Key::Text("n".into()), Mods { alt: true, ..Mods::default() });
    assert_ne!(front(&rt), was, "alt+n brought the other tab forward");
    chord(&mut rt, Key::Text("p".into()), Mods { alt: true, ..Mods::default() });
    assert_eq!(front(&rt), was, "alt+p went back");
}

#[test]
fn escape_steps_back_one_thing_at_a_time_and_says_when_nothing_is_left() {
    let mut g = garden(ok());
    // A screen that says where the keys go home to: its reader.
    let mut row = screen_row("beds", json!({ "focus": "reader", "root": { "t": "split", "dir": "row", "weights": [0.4, 0.6], "kids": [
        { "t": "leaf", "kind": "screens.tree", "role": "tree", "name": "tree", "wires": [{ "verb": "select", "to": "reader" }] }, { "t": "leaf", "kind": "screens.reader", "role": "reader", "name": "reader" }] } }), json!([]));
    row["spec"]["home"] = json!("reader");
    screens_are(&mut g, json!([row]));
    assert!(act(&mut g.app, "screen.open name=beds").ok);
    let mut rt = window(g.app);
    rest(&mut rt);
    let home = focus(&rt);
    assert_eq!(home, "reader");
    // A notice over a zoomed tile: Escape takes the notice away first, then puts the tile back, each a step.
    run(&mut rt, "tile.zoom on=true tile=tree");
    run(&mut rt, "link.follow ref=ep0ch:p/Seed%20list");
    assert!(rt.state.notice.is_some() && rt.state.layout.zoom.is_some());
    assert_eq!(rt.state.person().stack().iter().map(|layer| layer.name()).filter(|name| ["noticed", "zoomed", "tile"].contains(name)).collect::<Vec<_>>(), ["noticed", "zoomed", "tile"]);
    key(&mut rt, Key::Escape);
    assert!(rt.state.notice.is_none() && rt.state.layout.zoom.is_some(), "the notice went, the zoom stayed");
    key(&mut rt, Key::Escape);
    assert!(rt.state.layout.zoom.is_none(), "the tile is back in its place");
    // With nothing open, the keys go home; home already, Escape closes nothing and says so. q is the same step.
    run(&mut rt, "tile.focus tile=tree");
    key(&mut rt, Key::Escape);
    assert_eq!(focus(&rt), home, "the keys went to the screen's home tile");
    let from = rt.state.steps.len();
    letter(&mut rt, "q");
    assert_eq!(focus(&rt), home);
    assert!(rt.state.steps[from..].iter().any(|step| step.action == "keys.home" && step.ok && step.said.contains("Nothing left to close")), "{:?}", rt.state.steps[from..].iter().map(|step| (&step.action, &step.said)).collect::<Vec<_>>());
    // What Escape will do is what the person's whereabouts say, read from the same rows.
    assert_eq!(rt.state.person().json()["esc"], "notice.dismiss", "the notice that said so is what Escape takes away next");
}

#[test]
fn escape_shuts_the_dock_the_keys_are_in() {
    let g = garden(ok());
    let mut rt = window(g.app);
    run(&mut rt, "tile.dock edge=left tile=tree");
    run(&mut rt, "tile.focus tile=tree");
    assert!(rt.state.shown_tiles().iter().any(|id| rt.state.layout.name(id) == "tree"), "the dock is open with the tree in it");
    assert!(rt.state.person().stack().contains(&crate::keys::Layer::Docked));
    key(&mut rt, Key::Escape);
    assert!(!rt.state.shown_tiles().iter().any(|id| rt.state.layout.name(id) == "tree"), "Escape shut the dock");
    assert_ne!(focus(&rt), "tree", "and the keys went to a tile that is shown");
}

#[test]
fn the_hint_row_says_the_keys_of_the_tile_that_has_them_from_the_table() {
    let g = garden(ok());
    let mut rt = window(g.app);
    run(&mut rt, "tile.focus tile=tree");
    let said = does(&rt);
    for row in ["the next row", "the row before", "unfold the row", "open the row the cursor is on", "step back: the keys to the screen's home tile"] { assert!(said.contains(&row), "{row} is said on a tree: {said:?}") }
    assert!(!said.contains(&"the next lane of a board"), "a tree's own h and l are said once, as the tree's: {said:?}");
    // The row is drawn under the tiles, each key as the table caps it.
    let drawn: Vec<String> = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("keys/"))).filter_map(|e| e.key).collect();
    assert_eq!(drawn.len(), said.len(), "one line a hint: {drawn:?}");
    let first = rt.state.hinted().into_iter().find(|hint| hint.does == "the next row").unwrap();
    assert_eq!(first.caps.len(), 2, "j and the down arrow are one line: {:?}", first.caps);
    // On a reader, the reader's keys; while words are picked there, the keys that act on them first.
    run(&mut rt, "tile.focus tile=reader");
    let said = does(&rt);
    assert!(said.contains(&"the next part of the page") && said.contains(&"back to the note before") && !said.contains(&"the next row"), "{said:?}");
    // A sequence begun lists what it can still become, by the keys left to press, and nothing else.
    run(&mut rt, "passage.select quote=\"Before the rain.\"");
    letter(&mut rt, "a");
    let waits = rt.state.hinted();
    assert!(!waits.is_empty() && waits.iter().all(|hint| hint.line.starts_with("comment")), "{waits:?}");
    assert_eq!(waits[0].caps, ["C"], "the key left to press: {:?}", waits[0].caps);
    letter(&mut rt, "c");
    assert!(rt.state.draft_on(&rt.state.layout.focus.clone()).is_some(), "the sequence ran its row");
}

#[test]
fn an_agent_never_moves_the_cursor_or_the_reading_line_of_the_tile_the_person_is_on() {
    let g = garden(ok());
    let mut rt = window(g.app);
    run(&mut rt, "tile.focus tile=tree");
    let agent = Actor::Agent("tidy-agent".into());
    rt.update({ let agent = agent.clone(); move |s, _| {
        assert!(!s.act("list.step by=1 tile=tree", agent.clone()).ok, "the tree has the person's keys");
        assert!(s.act("reading.step by=1 tile=reader", agent.clone()).ok, "the reader has not: its reading line is anybody's to move");
        assert!(!s.act("tile.focus by=1", agent.clone()).ok && !s.act("keys.stop n=1", agent).ok, "the person's keys are theirs");
    } });
    assert_eq!(cursor(&rt, "tree"), None);
}
