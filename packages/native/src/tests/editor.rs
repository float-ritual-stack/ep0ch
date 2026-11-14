//! The editor's keys (K3), as a person works: Return on a list, Tab where it can mean a level, lines moved by key,
//! brackets that wrap, pair and are typed over, a step ticked, an undo that takes back a word, and Esc that lets go
//! of a selection first. Every step is a real key through the window's runtime; the rules themselves are asked row
//! for row in `contract.rs`.
use rune::{Key, Mods};

use super::support::*;
use crate::actions::{Actor, App};
use crate::keys::Layer;

const PLOT: &str = "Plot [type::chore]\nBefore the rain.";
const SHIFT: Mods = Mods { shift: true, ctrl: false, alt: false, cmd: false, logo: false };
const ALT: Mods = Mods { shift: false, ctrl: false, alt: true, cmd: false, logo: false };
const PLAIN: Mods = Mods { shift: false, ctrl: false, alt: false, cmd: false, logo: false };

fn at(rt: &rune::Runtime<App>) -> (String, (usize, usize)) { (words(&rt.state).to_string(), draft(&rt.state).unwrap().buf.ends()) }
fn last_step(rt: &rune::Runtime<App>) -> (String, bool) { rt.state.steps.last().map(|step| (step.line(), step.ok)).unwrap() }
fn shifted() -> Mods { Mods { shift: true, ..primary() } }
/// The block open for writing, the caret at the end of its last line.
fn writing() -> rune::Runtime<App> {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    rt
}
fn said(rt: &rune::Runtime<App>) -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.text).collect() }

#[test]
fn return_goes_on_with_a_list_and_ends_it_on_an_empty_item() {
    let mut rt = writing();
    chord(&mut rt, Key::Enter, PLAIN);
    assert_eq!((words(&rt.state), last_step(&rt)), (format!("{PLOT}\n").as_str(), ("draft.newline".to_string(), true)), "Return is the draft's row, and prose breaks plainly");
    typed(&mut rt, "- peas");
    chord(&mut rt, Key::Enter, PLAIN);
    assert_eq!(at(&rt).0, format!("{PLOT}\n- peas\n- "), "the next item is begun: the same marker and gap");
    typed(&mut rt, "beans");
    chord(&mut rt, Key::Enter, PLAIN);
    // Return on the empty item: the marker goes, and the list is over.
    chord(&mut rt, Key::Enter, PLAIN);
    let ended = format!("{PLOT}\n- peas\n- beans\n");
    assert_eq!(at(&rt), (ended.clone(), (ended.len(), ended.len())));
    // A numbered step goes on with the next number, and a ticked one with an open box.
    typed(&mut rt, "9) dig");
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "[x] rake");
    chord(&mut rt, Key::Enter, PLAIN);
    assert_eq!(at(&rt).0, format!("{ended}9) dig\n10) [x] rake\n11) [ ] "));
    // Shift+Return is only the break: no marker comes with it.
    typed(&mut rt, "sow");
    chord(&mut rt, Key::Enter, SHIFT);
    assert_eq!((at(&rt).0, last_step(&rt).0), (format!("{ended}9) dig\n10) [x] rake\n11) [ ] sow\n"), "draft.newline plain=true".to_string()));
    // One undo takes one break back, and the keys never left the block.
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, format!("{ended}9) dig\n10) [x] rake\n11) [ ] sow"));
    assert_eq!((rt.state.person().layer, rt.state.person().focus.as_str()), (Layer::Draft, "reader"));
}

#[test]
fn a_marker_typed_on_an_item_return_began_takes_its_place() {
    let mut rt = writing();
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "- peas");
    chord(&mut rt, Key::Enter, PLAIN);
    // Out of habit: the marker again, on the item Return already began.
    typed(&mut rt, "* beans");
    assert_eq!(at(&rt).0, format!("{PLOT}\n- peas\n* beans"), "never `- * beans`");
}

/// What Evan met: Tab anywhere on a line moved the whole line.
#[test]
fn tab_in_the_middle_of_a_paragraph_moves_nothing_and_the_keys_stay() {
    let mut rt = writing();
    let end = PLOT.len();
    chord(&mut rt, Key::Tab, PLAIN);
    assert_eq!(at(&rt), (PLOT.to_string(), (end, end)), "at a sentence's end Tab is no level");
    assert_eq!((last_step(&rt), rt.state.person().layer, rt.state.person().focus.as_str()), (("draft.indent".to_string(), true), Layer::Draft, "reader"), "the row took the key: it never went on to move the keys out of the block");
    // From the line's start it is a level: Home is the line's start here, on every platform.
    chord(&mut rt, Key::Home, PLAIN);
    let start = PLOT.find("Before").unwrap();
    assert_eq!((at(&rt).1, last_step(&rt).0), ((start, start), "draft.go to=line-start".to_string()));
    chord(&mut rt, Key::Tab, PLAIN);
    assert_eq!(at(&rt).0, "Plot [type::chore]\n  Before the rain.");
    // Shift+Tab takes the level off from any column.
    chord(&mut rt, Key::End, PLAIN);
    chord(&mut rt, Key::Tab, SHIFT);
    assert_eq!(at(&rt), (PLOT.to_string(), (end, end)));
    // A list item moves from any column, as it did.
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "- peas");
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "beans");
    chord(&mut rt, Key::Tab, PLAIN);
    assert_eq!(at(&rt).0, format!("{PLOT}\n- peas\n  - beans"));
    assert!(said(&rt).iter().any(|does| does == "indent the item, or the selected lines"), "the hint says what Tab is for: {:?}", said(&rt));
}

#[test]
fn a_line_is_moved_copied_and_deleted_by_key_each_as_one_step() {
    let mut rt = writing();
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "- beds");
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "north");
    let flat = format!("{PLOT}\n- beds\n- north");
    assert_eq!(at(&rt).0, flat);
    chord(&mut rt, Key::Up, ALT);
    let up = format!("{PLOT}\n- north\n- beds");
    assert_eq!((at(&rt).0, last_step(&rt).0), (up.clone(), "draft.line op=up".to_string()));
    let caret = at(&rt).1.1;
    assert_eq!(&up[..caret], format!("{PLOT}\n- north"), "the caret went with its line");
    chord(&mut rt, Key::Down, Mods { shift: true, ..ALT });
    assert_eq!(at(&rt).0, format!("{PLOT}\n- north\n- north\n- beds"), "written again below itself");
    chord(&mut rt, Key::Command('k'), shifted());
    assert_eq!((at(&rt).0, last_step(&rt).0), (up.clone(), "draft.line op=delete".to_string()));
    // Each was one step of the field's way back.
    chord(&mut rt, Key::Command('z'), primary());
    chord(&mut rt, Key::Command('z'), primary());
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, flat);
    // At the text's first line nothing is above to move over: the key is taken and nothing changes.
    chord(&mut rt, Key::Up, primary());
    assert_eq!((at(&rt).1, last_step(&rt).0), ((0, 0), "draft.go to=doc-start".to_string()));
    chord(&mut rt, Key::Up, ALT);
    assert_eq!(at(&rt), (flat, (0, 0)));
}

#[test]
fn a_bracket_brings_its_closer_is_typed_over_and_wraps_what_is_selected() {
    let mut rt = writing();
    chord(&mut rt, Key::Enter, PLAIN);
    typed(&mut rt, "see (");
    let open = format!("{PLOT}\nsee ()");
    assert_eq!(at(&rt), (open.clone(), (open.len() - 1, open.len() - 1)), "the closer came with it, the caret between");
    typed(&mut rt, "beds)");
    let closed = format!("{PLOT}\nsee (beds)");
    assert_eq!(at(&rt), (closed.clone(), (closed.len(), closed.len())), "the closer typed where it stands is typed over, not written twice");
    // Before a word a bracket comes alone.
    chord(&mut rt, Key::Home, PLAIN);
    typed(&mut rt, "[");
    assert_eq!(at(&rt).0, format!("{PLOT}\n[see (beds)"));
    chord(&mut rt, Key::Command('z'), primary());
    // The word the caret is on, selected by key, then wrapped a key at a time: twice is a page link.
    chord(&mut rt, Key::Command('w'), shifted());
    assert_eq!(last_step(&rt).0, "draft.select what=word");
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!(&text[anchor..caret], "see");
    typed(&mut rt, "[[");
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!((text.as_str(), &text[anchor..caret]), (format!("{PLOT}\n[[see]] (beds)").as_str(), "see"), "wrapped, and still selected");
    // A letter over a selection is only a letter.
    typed(&mut rt, "x");
    assert_eq!(at(&rt).0, format!("{PLOT}\n[[x]] (beds)"));
}

#[test]
fn a_step_is_ticked_by_key_and_a_line_made_one() {
    let mut rt = writing();
    chord(&mut rt, Key::Command('u'), shifted());
    assert_eq!((at(&rt).0, last_step(&rt).0), ("Plot [type::chore]\n- [ ] Before the rain.".to_string(), "draft.check".to_string()), "a line becomes a step");
    chord(&mut rt, Key::Command('u'), shifted());
    assert_eq!(at(&rt).0, "Plot [type::chore]\n- [x] Before the rain.");
    chord(&mut rt, Key::Command('u'), shifted());
    let open = "Plot [type::chore]\n- [ ] Before the rain.";
    assert_eq!(at(&rt), (open.to_string(), (open.len(), open.len())), "the caret stayed on its text throughout");
    assert!(said(&rt).iter().any(|does| does == "tick the step, or make the line one"), "the hint row offers it: {:?}", said(&rt));
}

#[test]
fn an_undo_takes_back_a_word_and_not_everything_typed() {
    let mut rt = writing();
    typed(&mut rt, " Sow the peas");
    assert_eq!(at(&rt).0, format!("{PLOT} Sow the peas"));
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, format!("{PLOT} Sow the "), "the last word, and its space stays with the word before");
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, format!("{PLOT} Sow "));
    chord(&mut rt, Key::Command('z'), shifted());
    assert_eq!(at(&rt).0, format!("{PLOT} Sow the "), "and redo puts a word back");
}

#[test]
fn escape_lets_go_of_a_selection_before_it_leaves() {
    let mut rt = writing();
    chord(&mut rt, Key::Home, SHIFT);
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!((&text[caret..anchor], last_step(&rt).0), ("Before the rain.", "draft.go extend=true to=line-start".to_string()), "Shift+Home selects to the line's start");
    // With something selected the hint row offers what is done with it, from the rows that say so.
    assert!(said(&rt).iter().any(|does| does == "copy") && said(&rt).iter().any(|does| does == "cut"), "{:?}", said(&rt));
    chord(&mut rt, Key::Escape, PLAIN);
    let (_, (anchor, caret)) = at(&rt);
    assert_eq!((anchor, caret, draft(&rt.state).is_some()), (caret, caret, true), "the first Escape let go of the selection and nothing else");
    assert!(!said(&rt).iter().any(|does| does == "copy"), "nothing selected, nothing to copy: {:?}", said(&rt));
    chord(&mut rt, Key::Escape, PLAIN);
    assert!(draft(&rt.state).is_none(), "the next one leaves: nothing was unsaved");
}

/// What the field's own editor does (a motion by word, an undo) is an action too: an act line runs it, the keys
/// screen lists its key, and the table never takes that key from the field.
#[test]
fn the_field_s_own_keys_are_listed_and_run_as_acts_and_an_agent_runs_none() {
    let mut rt = writing();
    let end = PLOT.len();
    assert!(rt.state.act("draft.go to=word-back", Actor::Person).ok);
    rest(&mut rt);
    assert_eq!(at(&rt).1, (end - "rain.".len(), end - "rain.".len()), "the editor was handed its own key, and moved by its own word");
    assert!(rt.state.act("draft.go to=word-back extend=true", Actor::Person).ok);
    rest(&mut rt);
    let (text, (anchor, caret)) = at(&rt);
    assert_eq!(&text[caret..anchor], "the ");
    assert!(rt.state.act("draft.cut", Actor::Person).ok);
    rest(&mut rt);
    assert_eq!(at(&rt).0, "Plot [type::chore]\nBefore rain.");
    assert!(rt.state.act("draft.erase to=word-back", Actor::Person).ok);
    rest(&mut rt);
    assert_eq!(at(&rt).0, "Plot [type::chore]\nrain.");
    assert!(rt.state.act("draft.undo", Actor::Person).ok);
    assert_eq!(at(&rt).0, "Plot [type::chore]\nBefore rain.");
    assert!(rt.state.act("draft.erase to=line-end", Actor::Person).ok);
    assert_eq!(at(&rt).0, "Plot [type::chore]\nBefore ");
    // The same word motion by its key is the field's: no row ran, and the caret moved.
    let steps = rt.state.steps.len();
    chord(&mut rt, Key::Left, if cfg!(target_os = "macos") { ALT } else { primary() });
    assert_eq!((rt.state.steps.len(), at(&rt).1.1), (steps, "Plot [type::chore]\n".len()), "the table left the key to the editor");
    // The keys screen and `peek` list both kinds, and say whose each is.
    let rows = crate::keys::rows(&rt.state);
    let row = |line: &str| rows.as_array().unwrap().iter().find(|row| row["line"] == line && row["layer"] == "draft").unwrap_or_else(|| panic!("{line} has no row")).clone();
    assert_eq!((row("draft.go to=word-back")["from"].as_str(), row("draft.undo")["from"].as_str(), row("draft.line op=up")["from"].as_str()), (Some("field"), Some("field"), Some("row")));
    // The editor is the person's: an agent's way in is draft.patch.
    for line in ["draft.newline", "draft.line op=delete", "draft.check", "draft.wrap with=[", "draft.undo", "draft.go to=doc-end"] {
        let refused = rt.state.act(line, Actor::Agent("tidy".into()));
        assert!(!refused.ok, "{line} is the person's");
    }
    assert_eq!(at(&rt).0, "Plot [type::chore]\nBefore ");
}
