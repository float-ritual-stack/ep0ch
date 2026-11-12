//! The window itself, drawn over the garden: what is on screen, what a press does, and what the keys do where
//! the person is. A press and a key reach the same dispatcher as an act line; `parity.rs` holds them to it.
use rune::{Key, Mods, Runtime};

use super::support::*;
use crate::actions::{Actor, App, Field};
use crate::keys;

#[test]
fn the_note_draws_every_part_and_a_row_in_a_component_opens_its_note() {
    let mut rt = window(garden(ok()).app);
    for key in ["tile/tree/row/plot", "tile/tree/row/shed", "tile/reader/title", "tile/reader/part/0", "tile/reader/part/1", "tile/reader/part/2", "tile/reader/part/3", "tile/reader/part/3/fork", "tile/reader/part/4", "tile/reader/child/fork", "tile/backlinks/backlink/plan", "tile/reader/edit", "tool/bar.open", "tool/bar.open scope=query", "tool/note.new"] {
        assert!(rt.find(key).is_some(), "{key} is on screen");
    }
    assert!(rt.find("tile/tree/row/onions").is_none(), "a folded folder's notes aren't asked for or built");
    press(&mut rt, "tile/reader/part/1/beans");
    assert_eq!(rt.state.page().unwrap().title, "Water the beans");
    assert!(rt.find("tile/tree/row/beans").is_some() && rt.find("tile/reader/path").is_some(), "the tree unfolded to it, and its path is drawn");
}

#[test]
fn a_press_on_a_tree_row_opens_its_note_and_on_the_open_note_folds_it() {
    let mut rt = window(garden(ok()).app);
    press(&mut rt, "tile/tree/row/plot");
    assert!(rt.find("tile/tree/row/onions").is_some(), "the open note's row unfolds what is under it");
    press(&mut rt, "tile/tree/row/onions");
    assert_eq!(rt.state.subject().as_deref(), Some("onions"));
    assert!(rt.find("tile/tree/row/fork").is_some(), "opening a folder shows its notes");
    press(&mut rt, "tile/tree/row/onions");
    assert!(rt.find("tile/tree/row/fork").is_none(), "and a press on the open note folds it again");
}

#[test]
fn the_editor_s_buttons_say_what_leaving_would_do() {
    let mut rt = window(garden(ok()).app);
    press(&mut rt, "tile/reader/edit");
    assert_eq!(rt.state.editor.text, "Plot [type::chore]\nBefore the rain.");
    assert!(rt.find("tile/reader/source").is_some() && rt.find("tile/reader/done").is_some() && rt.find("tile/reader/discard").is_none() && rt.find("tile/reader/title").is_none());
    rt.update(|s, _| s.field(Field::Draft).replace_text("Plot, changed"));
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
    assert!(rt.find("tile/reader/discard").is_some() && rt.find("tile/reader/done").is_none(), "with unsaved text the way out is Discard, by name");
    press(&mut rt, "tile/reader/save");
    assert!(rt.state.editing.is_some() && !rt.state.unsaved());
    press(&mut rt, "tile/reader/done");
    assert!(rt.state.editing.is_none() && rt.find("tile/reader/title").is_some());
}

#[test]
fn a_chip_is_a_query_for_every_note_that_carries_it_and_binning_offers_undo() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/chip/type/chore");
    assert_eq!(last(&asked)["query"]["where"], "type=chore");
    assert!(rt.find("bar/field").is_some() && rt.find("bar/facet/area/plot").is_some());
    press(&mut rt, "bar/row/query/beans");
    assert_eq!(rt.state.subject().as_deref(), Some("beans"));
    assert!(rt.find("bar/field").is_none(), "a pick puts the bar away");
    rt.update(|s, _| { s.act("note.trash", Actor::Person); });
    rest(&mut rt);
    assert!(rt.find("notice-undo").is_some());
    press(&mut rt, "notice-undo");
    assert_eq!(rt.state.subject().as_deref(), Some("beans"));
}

#[test]
fn pictures_are_drawn_where_they_stand_under_the_header_image() {
    let mut app = garden(ok()).app.blocking(true);
    act(&mut app, "open id=shed");
    let mut rt = window(app);
    for _ in 0..10 { rt.frame(1.0 / 60.0); }
    let y = |rt: &Runtime<App>, key: &str| rt.find(key).unwrap_or_else(|| panic!("{key} is on screen")).1;
    assert!(y(&rt, "tile/reader/hero") < y(&rt, "tile/reader/title"), "the header image sits above the title");
    assert!(y(&rt, "tile/reader/title") < y(&rt, "tile/reader/part/0") && y(&rt, "tile/reader/part/0") < y(&rt, "tile/reader/part/1") && y(&rt, "tile/reader/part/1") < y(&rt, "tile/reader/part/2"));
}

/// The wave's sentence: the bar opened by its chord, an action found by a word of its name, and run.
#[test]
fn the_bar_opened_by_its_chord_finds_an_action_by_a_word_and_runs_it() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    chord(&mut rt, Key::Command('k'), primary());
    assert!(rt.state.bar.open && rt.find("bar/field").is_some(), "the chord the bar.open row names opens the bar");
    typed(&mut rt, "trash");
    assert_eq!(rt.state.bar.edit.text, "trash", "the bar's line has the keys as soon as it is there");
    let rows = crate::bar::rows(&rt.state);
    assert_eq!((rows[0].source, rows[0].line.as_str(), rows[0].keycap.clone()), ("actions", "note.trash", keys::cap("note.trash")), "the first row is the action named, with its keycap from the table");
    assert!(rt.find("bar/row/actions/note.trash").is_some() && rt.find("bar/row/actions/note.untrash").is_some());
    chord(&mut rt, Key::Enter, Mods::default());
    let sent = asked.borrow().iter().rev().find(|a| a["action"] == "delete").cloned().expect("the note went to the Trash");
    assert_eq!((sent["blockId"].as_str(), sent["mutation"]["author"].as_str(), sent["mutation"]["actorId"].as_str()), (Some("plot"), Some("user"), Some("ep0ch-native:box")));
    assert!(!rt.state.bar.open && rt.find("notice-undo").is_some(), "the bar is away and the notice offers the way back");
    let steps: Vec<String> = rt.state.steps.iter().map(|step| step.line()).collect();
    assert_eq!(steps, ["bar.open", "note.trash", "bar.pick"], "three acts, each recorded as the line it was (a pick when what it ran is done)");
}

#[test]
fn the_bar_s_keys_move_its_lit_row_and_a_line_typed_whole_runs_as_written() {
    let mut rt = window(garden(ok()).app);
    chord(&mut rt, Key::Command('k'), primary());
    chord(&mut rt, Key::Down, Mods::default());
    chord(&mut rt, Key::Down, Mods::default());
    assert_eq!(rt.state.bar.cursor, 2);
    chord(&mut rt, Key::Up, Mods::default());
    assert_eq!((rt.state.bar.cursor, rt.state.bar.edit.text.as_str()), (1, ""), "the arrows are the table's in the bar, not the field's");
    // An action that can't run without arguments is put on the line to finish; finished, the line runs as written.
    rt.update(|s, _| { s.act("bar.pick source=actions key=open", Actor::Person); });
    rest(&mut rt);
    assert_eq!((rt.state.bar.open, rt.state.bar.edit.text.as_str()), (true, "open "));
    typed(&mut rt, "id=shed");
    assert_eq!(crate::bar::rows(&rt.state)[0].source, "line");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!((rt.state.subject().as_deref(), rt.state.bar.open), (Some("shed"), false));
}

#[test]
fn esc_closes_one_thing_at_a_time_the_bar_then_the_editor_then_the_notice() {
    let mut rt = window(garden(ok()).app);
    let steps: Vec<&str> = keys::esc_steps().iter().map(|bind| bind.line.as_str()).collect();
    assert_eq!(steps, ["bar.close", "edit.close", "notice.dismiss"], "the list is the rows bound to Escape, by layer");
    rt.update(|s, _| { s.act("link.follow ref=ep0ch:p/Seed%20list", Actor::Person); s.act("edit", Actor::Person); s.act("bar.open", Actor::Person); });
    rest(&mut rt);
    assert_eq!(rt.state.person().layer, keys::Layer::Bar);
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((rt.state.bar.open, rt.state.editing.is_some(), rt.state.notice.is_some()), (false, true, true));
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((rt.state.editing.is_some(), rt.state.notice.is_some()), (false, true));
    chord(&mut rt, Key::Escape, Mods::default());
    assert!(rt.state.notice.is_none());
}

#[test]
fn in_the_note_s_source_the_table_has_a_chord_first_and_return_types_a_line() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    typed(&mut rt, " Now");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "then");
    assert_eq!(rt.state.editor.text, "Plot [type::chore]\nBefore the rain. Now\nthen", "plain Return is a line in a note's source");
    // The save chord is the table's, from inside the field: the editor never sees it, and it keeps the keys.
    chord(&mut rt, Key::Command('s'), primary());
    let saved = asked.borrow().iter().rev().find(|a| a["action"] == "update").cloned().expect("the save chord saved");
    assert_eq!(saved["text"], "Plot [type::chore]\nBefore the rain. Now\nthen");
    assert!(rt.state.editing.is_some() && rt.state.editor.focused);
    // A chord that moves or bins a note on a tile is the editor's own while a note is being written: it edits the
    // text, and nothing is asked of the host.
    chord(&mut rt, Key::Up, Mods { alt: true, ..Mods::default() });
    chord(&mut rt, Key::Backspace, primary());
    assert!(!asked.borrow().iter().any(|a| a["action"] == "move" || a["action"] == "delete"), "tile-layer rows don't hold in a draft");
    assert!(rt.state.editing.is_some() && rt.state.unsaved(), "the editor took them as its own keys");
}

#[test]
fn a_button_s_label_and_keycap_are_its_action_s_row_and_the_table_s() {
    let rt = window(garden(ok()).app);
    let texts: Vec<String> = rt.elements().into_iter().filter_map(|e| e.text).collect();
    for line in ["bar.open", "bar.open scope=query", "note.new", "edit"] {
        let label = crate::actions::label(line);
        assert!(texts.iter().any(|t| *t == label), "{line}'s label {label:?} is drawn: {texts:?}");
    }
        assert_eq!((crate::actions::label("edit.close"), crate::actions::label("edit.close discard=true"), crate::actions::label("note.untrash id=beans"), crate::actions::label("tree.pick id=beans")), ("Done".into(), "Discard".into(), "Undo".into(), "tree.pick".into()), "a label is the menu row for the arguments given, else the action's name");
}
