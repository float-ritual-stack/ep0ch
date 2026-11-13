//! Writing a block as in the door (H1), as a person works: Tab on a list's line, a paste that keeps its lines, and
//! a completion list that says what its lit row is. Every step is a key, a paste or a press through the window.
use rune::{Key, Mods};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::App;
use crate::keys::Layer;

const PLOT: &str = "Plot [type::chore]\nBefore the rain.";
const SHIFT: Mods = Mods { shift: true, ctrl: false, alt: false, cmd: false, logo: false };

fn sent(asked: &Asked, action: &str) -> Option<Value> { asked.borrow().iter().rev().find(|a| a["action"] == action).cloned() }
fn at(rt: &rune::Runtime<App>) -> (String, (usize, usize)) { (words(&rt.state).to_string(), draft(&rt.state).unwrap().buf.ends()) }
fn last_step(rt: &rune::Runtime<App>) -> (String, bool) { rt.state.steps.last().map(|step| (step.line(), step.ok)).unwrap() }

/// Tab was Rune's: on a `- ` line with no list open it moved the keys to the next tile. It is the draft's row now.
#[test]
fn tab_and_shift_tab_move_a_list_s_line_a_level_each_as_one_step_and_the_keys_stay_in_the_block() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- peas");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- beans");
    let flat = format!("{PLOT}\n- peas\n- beans");
    assert_eq!(at(&rt), (flat.clone(), (flat.len(), flat.len())));
    // Tab: the item goes under the item above it, by that item's marker and gap; the caret stays on its text.
    chord(&mut rt, Key::Tab, Mods::default());
    let nested = format!("{PLOT}\n- peas\n  - beans");
    assert_eq!(at(&rt), (nested.clone(), (nested.len(), nested.len())));
    assert_eq!(last_step(&rt), ("draft.indent".to_string(), true), "the key ran the draft's own row");
    // The keys never left the block: the tile it is written in has them, its field takes what is typed, and the
    // layer is the draft's.
    let person = rt.state.person();
    assert_eq!((person.layer, person.focus.as_str(), draft(&rt.state).unwrap().buf.takes_keys()), (Layer::Draft, "reader", true));
    typed(&mut rt, "!");
    assert_eq!(words(&rt.state), format!("{nested}!"));
    // One step of the editor's own undo takes the level back, and nothing else: the letter typed after it first.
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(words(&rt.state), nested);
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt), (flat.clone(), (flat.len(), flat.len())), "the level is one step, and the caret is back where it was");
    chord(&mut rt, Key::Command('z'), Mods { shift: true, ..primary() });
    assert_eq!(at(&rt), (nested.clone(), (nested.len(), nested.len())), "and redo puts it back");
    // Shift+Tab: back to its parent's level. Again at the margin: nothing moves, and the keys stay.
    chord(&mut rt, Key::Tab, SHIFT);
    assert_eq!((at(&rt), last_step(&rt)), ((flat.clone(), (flat.len(), flat.len())), ("draft.outdent".to_string(), true)));
    chord(&mut rt, Key::Tab, SHIFT);
    assert_eq!((words(&rt.state), rt.state.person().layer, rt.state.person().focus.as_str()), (flat.as_str(), Layer::Draft, "reader"));
    // The hint row under the field says both keys, from their rows.
    let hints: Vec<String> = rt.elements().into_iter().filter_map(|e| e.text).collect();
    assert!(["indent the line, or the selected lines", "outdent the line, or the selected lines"].iter().all(|does| hints.iter().any(|said| said == does)), "{hints:?}");
}

#[test]
fn tab_moves_every_line_the_selection_touches_and_keeps_what_is_selected() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- beds");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- north");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- south");
    // From the end of the last line up into the line above: two lines touched.
    chord(&mut rt, Key::Up, SHIFT);
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!((&text[caret..anchor], text.as_str()), ("\n- south", format!("{PLOT}\n- beds\n- north\n- south").as_str()), "from the end of one line to the end of the line above");
    chord(&mut rt, Key::Tab, Mods::default());
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!(text, format!("{PLOT}\n- beds\n  - north\n  - south"), "both lines by the first line's step");
    assert_eq!(&text[caret..anchor], "\n  - south", "the selection's two ends stayed on their text");
    assert_eq!(last_step(&rt), ("draft.indent".to_string(), true));
    chord(&mut rt, Key::Tab, SHIFT);
    assert_eq!(words(&rt.state), format!("{PLOT}\n- beds\n- north\n- south"));
}

#[test]
fn tab_is_the_list_s_while_the_list_that_completes_a_word_is_open() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "- see [[se");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!((words(&rt.state), last_step(&rt).0.as_str()), (format!("{PLOT}\n- see [[seed-list]]").as_str(), "complete.accept"), "the lit row is written, and the line is where it was");
    // With the list put away, the same key is the draft's again.
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n  - see [[seed-list]]"));
    // An agent has no hand in the editor: the rows are the person's.
    for theirs in ["draft.indent", "draft.outdent", "draft.paste text=peas", "draft.paste"] {
        let no = rt.state.act(theirs, crate::actions::Actor::Agent("tidy".into()));
        assert!(!no.ok && no.said.contains("the editor is the person's"), "{theirs}: {}", no.said);
    }
}

/// Two files copied in a file manager are a path a line with a bare carriage return between them. Rune's editor
/// keeps it (it folds only CRLF), and the service reads one line. The paste is the window's to take: the words go
/// in once, their line ends plain, as one step of the editor's undo.
#[test]
fn a_paste_into_a_block_is_the_window_s_and_keeps_its_lines() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    let before = at(&rt);
    // A paste event, as the platform hands one over once the clipboard is read (what the chord and the field's menu both end in).
    rt.paste("- [img::shots/one.png]\r- [img::shots/two.png]");
    rest(&mut rt);
    let pasted = format!("{PLOT}\n- [img::shots/one.png]\n- [img::shots/two.png]");
    assert_eq!(at(&rt), (pasted.clone(), (pasted.len(), pasted.len())), "each line once, a newline between them, the caret after");
    assert!(!words(&rt.state).contains('\r'));
    // What was pasted is kept as typed, like anything else written.
    assert!(unsaved(&rt.state));
    // One undo takes the paste out whole, and nothing puts a carriage return back; redo is the plain text again.
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt), before);
    chord(&mut rt, Key::Command('z'), Mods { shift: true, ..primary() });
    assert_eq!(words(&rt.state), pasted);
    // A CRLF is one newline, and a paste over a selection takes its place.
    chord(&mut rt, Key::Command('a'), primary());
    rt.paste("Seed swap\r\nBring the late peas\r\n");
    rest(&mut rt);
    assert_eq!(words(&rt.state), "Seed swap\nBring the late peas\n");
    // The act's own words go in by the same way.
    assert!(act(&mut rt.state, "draft.paste text=\"- sow\r- water\"").ok);
    assert_eq!(words(&rt.state), "Seed swap\nBring the late peas\n- sow\n- water");
}

/// The paste chord is the draft's row. In a test the key reaches the table (a live window's is taken by Rune first
/// and comes back as the paste event above): either way one hand writes, once.
#[test]
fn the_paste_chord_asks_for_the_clipboard_and_writes_what_it_holds_once() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Command('v'), primary());
    assert_eq!((last_step(&rt), words(&rt.state)), (("draft.paste".to_string(), true), PLOT), "the row ran, and nothing is written until the clipboard is read");
    // The clipboard's words, handed back to the tile that asked (the stand-in for the read a headless run can't make).
    let tile = draft(&rt.state).unwrap().tile.clone();
    rt.state.pasted(&tile, " Then\rthe peas.");
    rest(&mut rt);
    assert_eq!(words(&rt.state), format!("{PLOT} Then\nthe peas."));
    // A comment's draft is the same session and the same field: the same paste.
    assert!(act(&mut rt.state, "edit.save").ok);
    chord(&mut rt, Key::Escape, Mods::default());
    chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
    rt.paste("June is safer.\rAsk at the shed.");
    rest(&mut rt);
    let comment = rt.state.drafts.iter().find(|draft| !draft.is_block()).expect("a comment is being written");
    assert_eq!(comment.buf.words(), "June is safer.\nAsk at the shed.");
}

/// The list said a label, a kind and a count of notes. It says what the lit row is now, in its source's own words,
/// draws what choosing it makes as the service drew it, and counts the rows under the list.
#[test]
fn the_completion_list_says_what_its_lit_row_is_and_which_of_how_many() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "See [[s");
    let said = |rt: &rune::Runtime<App>| -> Vec<String> { rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.contains("tile/reader/complete-"))).filter_map(|e| e.text).collect() };
    let texts = |rt: &rune::Runtime<App>| -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.text).collect() };
    // Under the list: the service's heading and the lit row of how many.
    assert!(rt.find("tile/reader/complete-count").is_some() && texts(&rt).iter().any(|said| said == "pages 1/3"), "{:?}", said(&rt));
    // Beside it: the first row's own words, and its example as the service drew it (asked with the list itself).
    assert!(rt.find("tile/reader/complete-docs").is_some());
    let peek = |rt: &rune::Runtime<App>| crate::control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().find(|tile| tile["name"] == "reader").unwrap()["facts"]["editing"]["completing"].clone();
    assert_eq!(peek(&rt)["rows"][0]["docs"], "The page **Seed list**, by its address.");
    assert_eq!(peek(&rt)["shows"]["children"][0]["children"][0]["text"], "[[seed-list]]");
    assert!(texts(&rt).iter().any(|said| said == "[[seed-list]]") && texts(&rt).iter().any(|said| said == "As drawn"), "{:?}", texts(&rt));
    assert!(sent(&asked, "completion.rows").unwrap().get("lit").is_none(), "the list's own ask lights its first row");
    // Down: the count moves at once, the list stays as it is, and the service is asked what the row now lit makes.
    chord(&mut rt, Key::Down, Mods::default());
    assert!(texts(&rt).iter().any(|said| said == "pages 2/3"));
    assert_eq!(rt.state.completing("reader").unwrap().rows.len(), 3);
    let lit = sent(&asked, "completion.rows").unwrap();
    assert_eq!((lit["lit"].as_u64(), lit["text"].as_str(), lit["near"].as_str()), (Some(1), Some(format!("{PLOT}\nSee [[s").as_str()), Some("plot")));
    assert_eq!((peek(&rt)["lit"].clone(), peek(&rt)["shows"]["children"][0]["children"][0]["text"].clone()), (json!(2), json!("[[shed]]")));
    assert!(texts(&rt).iter().any(|said| said == "[[shed]]") && !texts(&rt).iter().any(|said| said == "[[seed-list]]"));
    assert_eq!(rt.state.person().layer, Layer::Complete, "the keys are still the list's");
    // Up, back to the first: its drawing is the list's own answer's, and nothing more is asked.
    let asks = asked.borrow().len();
    chord(&mut rt, Key::Up, Mods::default());
    assert_eq!((asked.borrow().len(), peek(&rt)["shows"]["children"][0]["children"][0]["text"].clone()), (asks, json!("[[seed-list]]")));
    // A list with nothing to choose from has no row to speak of: no count, no panel.
    typed(&mut rt, "zz");
    assert_eq!(rt.state.person().layer, Layer::Said);
    assert!(rt.find("tile/reader/complete-count").is_none() && rt.find("tile/reader/complete-docs").is_none());
}
