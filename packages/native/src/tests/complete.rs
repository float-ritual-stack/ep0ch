//! Completing (H5), as a person works: every step is a key, a press or a frame through the window.
use rune::{Key, Mods};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::App;
use crate::keys::Layer;

const PLOT: &str = "Plot [type::chore]\nBefore the rain.";

fn sent(asked: &Asked, action: &str) -> Option<Value> { asked.borrow().iter().rev().find(|a| a["action"] == action).cloned() }
fn last_step(rt: &rune::Runtime<App>) -> (String, bool) { rt.state.steps.last().map(|step| (step.line(), step.ok)).unwrap() }
fn texts(rt: &rune::Runtime<App>) -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.text).collect() }
fn completing(rt: &rune::Runtime<App>) -> Value { crate::control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().find(|tile| tile["name"] == "reader").unwrap()["facts"]["editing"]["completing"].clone() }

/// A block open for editing with the caret on a new line of its own.
fn writing() -> (rune::Runtime<App>, Asked) {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    (rt, asked)
}

/// The crash: `::` at a line's start lists the components, and the first one's example, drawn beside the list, holds
/// a list of notes. A list on a page is built only where it is in view of the page's scroll; the card beside the
/// completion list is over the window, in no scroll, and Rune panics the frame ("virtual stack must be inside a
/// scroll viewport"). Typed by two real keys.
#[test]
fn two_colons_at_a_line_s_start_list_the_components_and_the_window_stands() {
    let (mut rt, _) = writing();
    typed(&mut rt, "::");
    assert_eq!(rt.state.person().layer, Layer::Complete, "the components are listed");
    let found = rt.state.completing("reader").unwrap();
    assert!(found.rows.len() > 12 && found.rows[0].view.as_ref().is_some_and(|view| view.to_string().contains("\"type\":\"list\"")), "the lit row's example lists notes");
    // The window drew it: the example's own rows are in the card beside the list.
    assert!(texts(&rt).iter().any(|said| said == "Water the beans"), "{:?}", texts(&rt));
    // And down the whole list and round again, a card a row.
    for _ in 0..found_rows(&rt) + 1 { chord(&mut rt, Key::Down, Mods::default()); }
    assert_eq!(rt.state.person().layer, Layer::Complete);
}

fn found_rows(rt: &rune::Runtime<App>) -> usize { rt.state.completing("reader").map_or(0, |found| found.rows.len()) }

/// What was being written is kept as typed, so the next launch brings the block back with `::` in it. Nothing was
/// typed in that run: no list opens by itself, and the first key opens it.
#[test]
fn a_draft_found_back_ending_in_two_colons_opens_no_list_until_a_key_is_typed() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-complete-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let kept = dir.join("native-garden.layout.json");
    {
        let mut rt = window(garden_kept(ok(), &kept).app);
        press(&mut rt, "tile/reader/edit");
        chord(&mut rt, Key::Enter, Mods::default());
        // (Typed by an act so the first run never draws the list: this test is about the second.)
        assert!(act(&mut rt.state, "draft.paste text=\"::\"").ok);
        assert_eq!(words(&rt.state), format!("{PLOT}\n::"));
    }
    assert!(std::fs::read_to_string(dir.join("native-garden.drafts.json")).unwrap().contains("::"), "the file keeps the block as typed");
    let g = garden_kept(ok(), &kept);
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    rest(&mut rt);
    assert_eq!(words(&rt.state), format!("{PLOT}\n::"), "the block is back as it was typed");
    assert_eq!((rt.state.person().layer, rt.state.completing("reader").is_none()), (Layer::Draft, true), "and no list is open");
    assert!(sent(&asked, "completion.rows").is_none(), "nothing was asked to complete it: nothing was typed in this run");
    assert!(completing(&rt).is_null());
    // The next key is typing: the list opens on it.
    typed(&mut rt, "l");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = (last_step(&rt), json!(null));
}
