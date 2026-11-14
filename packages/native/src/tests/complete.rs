//! Completing (H5), as a person works: every step is a key, a press or a frame through the window. What the list
//! is hung by, what each row shows, what each key does there, and what choosing a row leaves next.
use rune::{Key, KeyEvent, Mods, Runtime};
use serde_json::Value;

use super::support::*;
use crate::actions::App;
use crate::keys::Layer;

const PLOT: &str = "Plot [type::chore]\nBefore the rain.";
const SHIFT: Mods = Mods { shift: true, alt: false, cmd: false, ctrl: false, logo: false };
const CTRL: Mods = Mods { shift: false, alt: false, cmd: false, ctrl: true, logo: false };

fn sent_all(asked: &Asked, action: &str) -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == action).cloned().collect() }
fn last_step(rt: &Runtime<App>) -> (String, bool) { rt.state.steps.last().map(|step| (step.line(), step.ok)).unwrap() }
fn texts(rt: &Runtime<App>) -> Vec<String> { rt.elements().into_iter().filter(|e| !e.exiting).filter_map(|e| e.text).collect() }
/// The words drawn under an element, by its key.
fn within(rt: &Runtime<App>, key: &str) -> Vec<String> { rt.elements().into_iter().filter(|e| !e.exiting && e.path.contains(key)).filter_map(|e| e.text).map(|said| plain(&said)).collect() }
fn rect(rt: &Runtime<App>, key: &str) -> [f32; 4] { rect_of(rt, key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}")) }
fn lit(rt: &Runtime<App>) -> usize { rt.state.completing_at("reader") }
fn labels(rt: &Runtime<App>) -> Vec<String> { rt.state.completing("reader").map(|found| found.rows.iter().map(|row| row.label.clone()).collect()).unwrap_or_default() }
fn caret(rt: &Runtime<App>) -> (usize, usize) { draft(&rt.state).unwrap().buf.ends() }

/// A block open for editing with the caret on a new line of its own.
fn writing() -> (Runtime<App>, Asked) { writing_in((1180.0, 760.0)) }
fn writing_in(size: (f32, f32)) -> (Runtime<App>, Asked) {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window_sized(g.app, size);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    (rt, asked)
}

/// The crash, down the whole list: `::` at a line's start lists the components, and the first one's example, drawn
/// beside the list, holds a list of notes. A list on a page is built only where it is in view of the page's
/// scroll; the card beside the completion list is over the window, in no scroll, and Rune panics the frame
/// ("virtual stack must be inside a scroll viewport") unless that list is built whole. Typed by two real keys,
/// then every row lit in turn and round again, a card a row.
#[test]
fn two_colons_at_a_line_s_start_list_the_components_and_the_window_stands() {
    let (mut rt, _) = writing();
    typed(&mut rt, "::");
    assert_eq!(rt.state.person().layer, Layer::Complete, "the components are listed");
    let found = rt.state.completing("reader").unwrap().clone();
    assert!(found.rows.len() > 12 && found.rows[0].view.as_ref().is_some_and(|view| view.to_string().contains("\"type\":\"list\"")), "the lit row's example lists notes");
    assert!(within(&rt, "tile/reader/complete-docs").iter().any(|said| said == "Water the beans"), "{:?}", within(&rt, "tile/reader/complete-docs"));
    for _ in 0..found.rows.len() + 1 { chord(&mut rt, Key::Down, Mods::default()); }
    assert_eq!((rt.state.person().layer, lit(&rt)), (Layer::Complete, 1), "round the list and one on: the window is still here");
}

/// One box, hung by the token: its left edge at the start of what is being completed, under the caret's line, and
/// it stays there while more is typed. Its foot, inside it, says which row of how many and what the keys do; the
/// card is at its side, level with its top.
#[test]
fn the_list_hangs_under_the_token_s_start_and_stays_there_as_letters_are_typed() {
    let (mut rt, _) = writing();
    typed(&mut rt, "Sow by [");
    let (at, list) = (rect(&rt, "tile/reader/complete-at"), rect(&rt, "tile/reader/complete"));
    let field = rect(&rt, "tile/reader/source");
    // The mark is on the caret's line, right of the words before the token; the list starts at it, under the line.
    assert!(at[0] > field[0] + 40.0 && at[0] < field[0] + 120.0, "the token starts after \"Sow by \": {at:?} in {field:?}");
    assert!((list[0] - at[0]).abs() <= 1.0 && list[1] >= at[1] + at[3], "the list's left edge is the token's start, and it is under the line: {list:?} by {at:?}");
    typed(&mut rt, "hea");
    let (after, moved) = (rect(&rt, "tile/reader/complete-at"), rect(&rt, "tile/reader/complete"));
    assert_eq!((after[0], moved[0], moved[1]), (at[0], list[0], list[1]), "three letters on, it hangs where it hung");
    // As wide as its rows need (within its floor and ceiling), no wider; and no taller than eight rows and a foot.
    assert!(moved[2] >= 280.0 && moved[2] <= 520.0 && moved[3] <= 8.0 * 28.0 + 40.0, "{moved:?}");
    // The foot is inside the box; the card beside it, at its right while the window has room, their tops level.
    let (foot, card) = (rect(&rt, "tile/reader/complete/foot"), rect(&rt, "tile/reader/complete-docs"));
    assert!(foot[1] >= moved[1] && foot[1] + foot[3] <= moved[1] + moved[3] + 1.0 && foot[0] >= moved[0], "the foot is in the box: {foot:?} in {moved:?}");
    assert!(card[0] >= moved[0] + moved[2] && (card[1] - moved[1]).abs() <= 1.5, "the card is at the list's right, level with its top: {card:?} by {moved:?}");
    assert!(card[2] <= 342.0 && card[0] + card[2] <= 1180.0, "a fixed width, inside the window: {card:?}");
}

/// Where the window has no room: near its bottom the list goes above the caret's line, and the card's bottom is
/// level with the list's (it never covers the line being typed); near its right edge the list stays inside the
/// window and the card goes to its left.
#[test]
fn near_the_window_s_edges_the_list_goes_above_the_line_and_the_card_to_the_other_side() {
    let (mut rt, _) = writing_in((1180.0, 420.0));
    for _ in 0..5 { chord(&mut rt, Key::Enter, Mods::default()); }
    typed(&mut rt, "::");
    let (at, list, card) = (rect(&rt, "tile/reader/complete-at"), rect(&rt, "tile/reader/complete"), rect(&rt, "tile/reader/complete-docs"));
    assert!(list[1] + list[3] <= at[1] + 0.5, "no room below in a short window: the list is above the line ({list:?} over {at:?})");
    assert!(card[1] + card[3] <= at[1] + 0.5, "and the card with it, never over the line being typed: {card:?}");
    assert!((card[1] + card[3] - (list[1] + list[3])).abs() <= 1.5, "their bottoms level: {card:?} by {list:?}");
    // The token far along its line: no room for the card at the list's right, so it is at its left, their tops level.
    let far = "Sow the early peas by the south wall and the late ones by the shed, then [h";
    let (mut rt, _) = writing();
    typed(&mut rt, far);
    let (at, list, card) = (rect(&rt, "tile/reader/complete-at"), rect(&rt, "tile/reader/complete"), rect(&rt, "tile/reader/complete-docs"));
    assert!((list[0] - at[0]).abs() <= 1.0 && 1180.0 - (list[0] + list[2]) < 340.0, "the list at the token, with less than a card's room at its right: {list:?}");
    assert!(card[0] >= 7.0 && card[0] + card[2] <= list[0] + 1.0 && (card[1] - list[1]).abs() <= 1.5, "the card is at the list's left: {card:?} by {list:?}");
    // By the window's right edge (a narrower window): the list is kept inside the window, under the line, and the
    // card is inside it too, beside the list or under it, never over it.
    let (mut rt, _) = writing_in((940.0, 760.0));
    typed(&mut rt, far);
    let (at, list, card) = (rect(&rt, "tile/reader/complete-at"), rect(&rt, "tile/reader/complete"), rect(&rt, "tile/reader/complete-docs"));
    assert!(at[0] + list[2] > 940.0 && list[0] >= 8.0 && list[0] + list[2] <= 940.0 - 7.0 && list[1] >= at[1] + at[3], "inside the window, under the line: {list:?} by {at:?}");
    assert!(card[0] >= 7.0 && card[0] + card[2] <= 940.0 - 7.0 && (card[0] + card[2] <= list[0] + 1.0 || card[1] >= list[1] + list[3]), "{card:?} by {list:?}");
    // No room at either side (narrower still): the card is under the list, inside the window.
    let (mut rt, _) = writing_in((860.0, 760.0));
    typed(&mut rt, far);
    let (list, card) = (rect(&rt, "tile/reader/complete"), rect(&rt, "tile/reader/complete-docs"));
    assert!(card[1] >= list[1] + list[3] && card[0] >= 7.0 && card[0] + card[2] <= 860.0 - 7.0, "under the list: {card:?} by {list:?}");
}

/// A row is read at a glance: what it is as a short tag, its name with the typed letters set apart (the service's
/// match, nothing worked out here), a value's look drawn in the row, one quiet detail; and the lit row's card draws
/// that look on an example, once the row has been lit a moment.
#[test]
fn a_row_shows_its_kind_its_matched_letters_its_look_and_one_detail_and_the_card_draws_the_lit_one() {
    let (mut rt, _) = writing();
    typed(&mut rt, "[hea");
    let found = rt.state.completing("reader").unwrap().clone();
    assert_eq!(labels(&rt), ["heading-pattern", "heading-style", "header"]);
    assert_eq!(found.rows[0].matches, [0, 1, 2], "the letters typed, as the service matched them");
    let row = within(&rt, "tile/reader/complete/row/0");
    assert_eq!(row, ["P", "heading-pattern", "1 note"], "a tag for what it is, its name, one detail: no kind spelled after every label");
    // Tab takes the key and its values open at once: each with its look in the row, a primitive built by the registry.
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(labels(&rt), ["dots", "uptime", "waffle", "stack", "rule"]);
    for n in 0..5 { let (sample, row) = (rect(&rt, &format!("tile/reader/complete/sample/{n}")), rect(&rt, &format!("tile/reader/complete/row/{n}"))); assert!(sample[2] >= 60.0 && sample[3] >= 8.0 && sample[1] >= row[1] && sample[1] + sample[3] <= row[1] + row[3], "row {n} draws its sample in the row: {sample:?} in {row:?}") }
    // The card: the lit value's own words, and its look on an example heading, drawn (a band, never "as drawn" over words).
    let card = within(&rt, "tile/reader/complete-docs");
    assert!(card.iter().any(|said| said == "sparse dots, now and then a bright one") && card.iter().any(|said| said == "Your calls") && !card.iter().any(|said| said == "As drawn"), "{card:?}");
    // Moving down draws no card a row: the card comes once the row has been lit a moment.
    rt.key(KeyEvent { key: Key::Down, mods: Mods::default() });
    for _ in 0..6 { rt.frame(1.0 / 60.0); }
    assert!(!within(&rt, "tile/reader/complete-docs").iter().any(|said| said == "an uptime strip's bars"), "a tenth of a second on, the new row's card isn't drawn yet");
    rest(&mut rt);
    assert!(within(&rt, "tile/reader/complete-docs").iter().any(|said| said == "an uptime strip's bars"));
}

/// Tab writes the lit row and does the next thing: a key's values open at once, a value closes its bracket (never
/// doubling one that is there) and puts the caret after it. Each a pick counted where every client's are.
#[test]
fn tab_accepts_a_key_then_its_value_and_never_doubles_a_bracket() {
    let (mut rt, asked) = writing();
    typed(&mut rt, "[st");
    assert_eq!(labels(&rt), ["heading-style", "harvest", "stage"]);
    chord(&mut rt, Key::Down, Mods::default());
    chord(&mut rt, Key::Down, Mods::default());
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!((words(&rt.state), last_step(&rt)), (format!("{PLOT}\n[stage::").as_str(), ("complete.accept".to_string(), true)));
    assert_eq!((rt.state.person().layer, labels(&rt)), (Layer::Complete, vec!["sown".to_string(), "sprouting".into(), "done".into()]), "its values, at once");
    chord(&mut rt, Key::Tab, Mods::default());
    let text = format!("{PLOT}\n[stage::sown]");
    assert_eq!((words(&rt.state), caret(&rt), rt.state.person().layer), (text.as_str(), (text.len(), text.len()), Layer::Draft), "the value, its bracket, the caret after it, and the list put away");
    assert_eq!(sent_all(&asked, "completion.picked").iter().map(|pick| pick["insert"].as_str().unwrap().to_string()).collect::<Vec<_>>(), ["pick-stage", "pick-sown"]);
    // One step of the way back each: undo takes the value out, and the key after it.
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[stage::"));
    // A bracket already there is the token's: a value chosen before it doesn't double it.
    typed(&mut rt, "]");
    chord(&mut rt, Key::Left, Mods::default());
    typed(&mut rt, "do");
    assert_eq!(labels(&rt), ["done"]);
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[stage::done]"));
}

/// Return is the field's until the person chose: a line is typed while a row says so and nothing was chosen (the
/// foot says which, in the row's own word); once a row is moved to, or the list is asked for by its key, Return
/// writes the lit row.
#[test]
fn return_is_the_field_s_until_a_row_is_chosen_or_the_list_is_asked_for() {
    let (mut rt, _) = writing();
    typed(&mut rt, "[");
    assert_eq!((rt.state.person().layer, labels(&rt).len()), (Layer::Complete, 6));
    let foot = |rt: &Runtime<App>| within(rt, "tile/reader/complete/foot");
    assert_eq!(foot(&rt), ["1 of 6 · properties", "Tab accept", "Enter new line", "Esc close"], "the foot, from the table and the row");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[\n"), "nothing was chosen: Return typed a line");
    // A row moved to is a choice: the foot says Return accepts now, and it does.
    typed(&mut rt, "[");
    chord(&mut rt, Key::Down, Mods::default());
    chord(&mut rt, Key::Down, Mods::default());
    assert_eq!(foot(&rt)[..3], ["3 of 6 · properties", "Tab accept", "Enter accept"]);
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[\n[header::"));
    // Escape closes the list and only the list; the key that asks for it opens it where the caret is, as a choice.
    chord(&mut rt, Key::Escape, Mods::default());
    chord(&mut rt, Key::Backspace, Mods::default());
    chord(&mut rt, Key::Backspace, Mods::default());
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((rt.state.person().layer, last_step(&rt).0.as_str(), draft(&rt.state).is_some()), (Layer::Draft, "complete.dismiss", true));
    rt.key(KeyEvent { key: Key::Text(" ".into()), mods: CTRL });
    rest(&mut rt);
    assert_eq!((last_step(&rt), rt.state.person().layer, labels(&rt)), (("complete.ask".to_string(), true), Layer::Complete, vec!["header".to_string()]), "asked for by its key, the list is open on the token at the caret");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[\n[header::"), "and Return took its row");
    // The next Escape after the list's is the field's own: it asks to leave the editor (which keeps unsaved words).
    chord(&mut rt, Key::Escape, Mods::default());
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((last_step(&rt).0.as_str(), draft(&rt.state).is_some()), ("edit.close", true));
}

/// The keys that move: Down and Up go round, Ctrl+N and Ctrl+P are the same, Page Down and Page Up go a list's
/// height and stop at an end, Home and End go to the ends; the lit row is brought into the list's own scroll.
#[test]
fn the_list_s_keys_move_the_lit_row_round_by_pages_and_to_the_ends_and_keep_it_in_view() {
    let (mut rt, _) = writing();
    typed(&mut rt, "::");
    let rows = labels(&rt).len();
    assert_eq!((rows, lit(&rt)), (18, 0));
    chord(&mut rt, Key::Up, Mods::default());
    assert_eq!(lit(&rt), rows - 1, "Up from the first goes round to the last");
    let shown = |rt: &Runtime<App>, n: usize| { let (row, view) = (rect(rt, &format!("tile/reader/complete/row/{n}")), rect(rt, "tile/reader/complete/rows-scroll")); row[1] >= view[1] - 1.0 && row[1] + row[3] <= view[1] + view[3] + 1.0 };
    assert!(shown(&rt, rows - 1), "the last row is scrolled into the list's view");
    chord(&mut rt, Key::Down, Mods::default());
    assert_eq!(lit(&rt), 0);
    chord(&mut rt, Key::PageDown, Mods::default());
    assert_eq!((lit(&rt), last_step(&rt).0), (8, "complete.move by=8".to_string()));
    chord(&mut rt, Key::PageDown, Mods::default());
    chord(&mut rt, Key::PageDown, Mods::default());
    assert_eq!(lit(&rt), rows - 1, "a page stops at the end, it doesn't go round");
    chord(&mut rt, Key::PageUp, Mods::default());
    assert_eq!(lit(&rt), rows - 9);
    chord(&mut rt, Key::Home, Mods::default());
    assert!(lit(&rt) == 0 && shown(&rt, 0));
    chord(&mut rt, Key::End, Mods::default());
    assert!(lit(&rt) == rows - 1 && shown(&rt, rows - 1));
    chord(&mut rt, Key::Text("p".into()), CTRL);
    assert_eq!((lit(&rt), words(&rt.state)), (rows - 2, format!("{PLOT}\n::").as_str()), "Ctrl+P is Up, and types nothing");
    chord(&mut rt, Key::Text("n".into()), CTRL);
    assert_eq!(lit(&rt), rows - 1);
    // The rows are under their sections' headers, each with how many it has.
    chord(&mut rt, Key::Home, Mods::default());
    assert_eq!(within(&rt, "tile/reader/complete/group/0"), ["links", "2"]);
}

/// Typing narrows the list, and the row the person chose stays lit wherever it now sits: kept by what it is, not
/// by its place.
#[test]
fn typing_narrows_the_list_and_the_chosen_row_stays_lit_where_it_now_sits() {
    let (mut rt, _) = writing();
    typed(&mut rt, "[");
    for _ in 0..4 { chord(&mut rt, Key::Down, Mods::default()); }
    assert_eq!((lit(&rt), labels(&rt)[4].as_str()), (4, "stage"));
    typed(&mut rt, "s");
    assert_eq!(labels(&rt), ["heading-style", "harvest", "stage"]);
    assert_eq!((lit(&rt), labels(&rt)[lit(&rt)].as_str()), (2, "stage"), "the row chosen is lit in the narrower list");
    assert!(within(&rt, "tile/reader/complete/foot").iter().any(|said| said == "3 of 3 · properties"));
    // A row never chosen isn't kept: the list that answers lights its first.
    let (mut rt, _) = writing();
    typed(&mut rt, "[h");
    typed(&mut rt, "a");
    assert_eq!((labels(&rt), lit(&rt)), (vec!["harvest".to_string()], 0));
}

/// The characters that end a token commit the lit row when they are exactly what it had left to write: typed out
/// by the person, the choice is counted as one made from the list, and nothing is written twice. Anything else
/// just types.
#[test]
fn the_character_that_ends_a_token_commits_the_row_it_finishes() {
    let (mut rt, asked) = writing();
    typed(&mut rt, "[stage::done");
    assert_eq!((labels(&rt), rt.state.completing("reader").unwrap().rows[0].rest.as_deref()), (vec!["done".to_string()], Some("]")));
    let before = sent_all(&asked, "completion.picked").len();
    typed(&mut rt, "]");
    assert_eq!((words(&rt.state), rt.state.person().layer), (format!("{PLOT}\n[stage::done]").as_str(), Layer::Draft));
    let picks = sent_all(&asked, "completion.picked");
    assert_eq!((picks.len(), picks.last().unwrap()["insert"].as_str(), picks.last().unwrap()["outcome"].as_str()), (before + 1, Some("pick-done"), Some("accepted")), "typed out, the value is counted as chosen");
    // A character that doesn't finish the lit row is typed, and counts nothing.
    typed(&mut rt, " [stage::s");
    typed(&mut rt, "]");
    assert_eq!((words(&rt.state), sent_all(&asked, "completion.picked").len()), (format!("{PLOT}\n[stage::done] [stage::s]").as_str(), before + 1));
}

/// What of the lit row is still to come is shown dimmed after the caret (never part of the field's words), and
/// Tab takes it.
#[test]
fn the_rest_of_the_lit_row_is_shown_dimmed_after_the_caret_and_tab_takes_it() {
    let (mut rt, _) = writing();
    typed(&mut rt, "[sta");
    assert_eq!(labels(&rt), ["stage"]);
    let rest_of = |rt: &Runtime<App>| rt.elements().into_iter().find(|e| !e.exiting && e.key.as_deref() == Some("tile/reader/complete-rest")).and_then(|e| e.text);
    assert_eq!(rest_of(&rt).as_deref(), Some("ge::"), "what choosing it would add, after the caret");
    assert_eq!(words(&rt.state), format!("{PLOT}\n[sta"), "and none of it is in the block's words");
    let (shown, at) = (rect(&rt, "tile/reader/complete-rest"), rect(&rt, "tile/reader/complete-at"));
    assert!(shown[0] > at[0] && (shown[1] - at[1]).abs() <= 1.0, "on the caret's line, right of the token's start: {shown:?} by {at:?}");
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\n[stage::"));
    // A row that doesn't go on from what is typed (letters from its middle) shows nothing after the caret.
    let (mut rt, _) = writing();
    typed(&mut rt, "[tag");
    assert_eq!((labels(&rt), rest_of(&rt)), (vec!["stage".to_string()], None));
}

/// A component accepted writes its skeleton and puts the caret in its first stop; Tab and Shift+Tab step the stops
/// while it is being filled in (the hint line says which Tab this is), typing in a stop keeps the others on their
/// words, and past the last the keys are the draft's again.
#[test]
fn a_component_s_skeleton_is_written_with_its_first_stop_selected_and_tab_steps_the_stops() {
    let (mut rt, _) = writing();
    typed(&mut rt, "::graph-st");
    assert_eq!(labels(&rt), ["Stat tiles"]);
    chord(&mut rt, Key::Tab, Mods::default());
    let skeleton = format!("{PLOT}\n::graph-stat\n---\nvalue: 12\nlabel: Beds sown\n---");
    assert_eq!(words(&rt.state), skeleton);
    let at = |text: &str, word: &str| { let from = text.rfind(word).unwrap(); (from, from + word.len()) };
    assert_eq!((caret(&rt), rt.state.person().layer), (at(&skeleton, "12"), Layer::Stops), "the first stop is selected, and the keys are the stops'");
    let hints = within(&rt, "tile/reader/editor-keys");
    assert!(hints.iter().any(|does| does == "next stop") && hints.iter().any(|does| does == "previous stop") && !hints.iter().any(|does| does == "indent"), "{hints:?}");
    // Typed over, the stop takes the words and the next stop stays on its own.
    typed(&mut rt, "7");
    let filled = skeleton.replace("value: 12", "value: 7");
    assert_eq!((words(&rt.state), rt.state.person().layer), (filled.as_str(), Layer::Stops));
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!((caret(&rt), last_step(&rt)), (at(&filled, "Beds sown"), ("snippet.next".to_string(), true)));
    chord(&mut rt, Key::Tab, SHIFT);
    assert_eq!((caret(&rt), last_step(&rt).0.as_str()), (at(&filled, "7"), "snippet.previous"));
    chord(&mut rt, Key::Tab, Mods::default());
    chord(&mut rt, Key::Tab, Mods::default());
    let end = at(&filled, "Beds sown").1;
    assert_eq!((caret(&rt), rt.state.person().layer), ((end, end), Layer::Draft), "past the last stop the caret is after it, and the stops are done");
    // Tab is the draft's again: it indents.
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(last_step(&rt), ("draft.indent".to_string(), true));
    // Escape leaves the stops where they are: the words stay, and the next Tab is the draft's.
    let (mut rt, _) = writing();
    typed(&mut rt, "::graph-st");
    chord(&mut rt, Key::Tab, Mods::default());
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((last_step(&rt).0.as_str(), rt.state.person().layer, words(&rt.state)), ("snippet.end", Layer::Draft, skeleton.as_str()));
}

/// The pointer: passing over a row lights it and chooses nothing (the caret and the keys stay in the field), the
/// wheel scrolls the list inside its box, and a press on a row writes it.
#[test]
fn the_pointer_lights_a_row_the_wheel_scrolls_the_list_and_a_press_accepts() {
    let (mut rt, _) = writing();
    typed(&mut rt, "::");
    let (third, before) = (rect(&rt, "tile/reader/complete/row/2"), caret(&rt));
    rt.pointer_move(third[0] + 40.0, third[1] + 10.0);
    rest(&mut rt);
    assert_eq!((lit(&rt), caret(&rt), rt.state.person().layer), (2, before, Layer::Complete), "the row under the pointer is lit, and the caret hasn't moved");
    assert!(!draft(&rt.state).unwrap().completing.moved, "a pointer passing over chose nothing: Return is still as the row says");
    typed(&mut rt, "g");
    assert!(words(&rt.state).ends_with("::g") && rt.state.person().layer == Layer::Complete, "the keys are still the field's: a letter narrows the list");
    chord(&mut rt, Key::Backspace, Mods::default());
    // The wheel moves the rows inside the list's own scroll; the box stays where it hangs.
    let (first, list) = (rect(&rt, "tile/reader/complete/row/0"), rect(&rt, "tile/reader/complete"));
    for _ in 0..6 { rt.wheel(first[0] + 40.0, first[1] + 40.0, -60.0); rt.frame(1.0 / 60.0); }
    rest(&mut rt);
    let scrolled = rect_of(&rt, "tile/reader/complete/row/0").map_or(f32::MIN, |row| row[1]);
    assert!(scrolled < first[1] - 20.0 && rect(&rt, "tile/reader/complete") == list, "the rows moved up in a box that stayed: {scrolled} from {}", first[1]);
    // A press on a row writes that row.
    let (mut rt, _) = writing();
    typed(&mut rt, "[[s");
    press(&mut rt, "tile/reader/complete/row/1");
    assert_eq!((words(&rt.state), last_step(&rt)), (format!("{PLOT}\n[[shed]]").as_str(), ("complete.accept n=2 tile=reader".to_string(), true)));
}

/// Nothing matches: the box says so in a line. A name long enough to be a page offers the row that makes it; lit
/// and never chosen, Tab and Return are still the field's (nothing is made by a key meant for the text), and once
/// chosen the page is made first, then linked. A page the service won't make is said, and nothing is written.
#[test]
fn a_page_nobody_has_written_is_offered_and_made_when_its_row_is_chosen() {
    let (mut rt, asked) = writing();
    typed(&mut rt, "[[zz");
    assert_eq!((rt.state.person().layer, within(&rt, "tile/reader/complete")), (Layer::Said, vec!["no page by that name yet".to_string(), "pages".into(), "Esc close".into()]));
    typed(&mut rt, "zz");
    assert_eq!(labels(&rt), ["+ new page [[zzzz]]"]);
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!((last_step(&rt).0.as_str(), sent_all(&asked, "pages.follow").len()), ("complete.accept", 0), "lit and not chosen, Tab is the field's: nothing is made");
    assert!(!words(&rt.state).contains("[[zzzz]]"));
    // Chosen (the list asked for by its key), it is made, then written.
    chord(&mut rt, Key::Command('z'), primary());
    rt.key(KeyEvent { key: Key::Text(" ".into()), mods: CTRL });
    rest(&mut rt);
    assert_eq!(labels(&rt), ["+ new page [[zzzz]]"]);
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(sent_all(&asked, "pages.follow").iter().map(|ask| ask["address"].as_str().unwrap().to_string()).collect::<Vec<_>>(), ["zzzz"]);
    assert_eq!(words(&rt.state), format!("{PLOT}\n[[zzzz]]"));
    // One the service won't make (its address is in the trash): said, and the words are as typed.
    typed(&mut rt, " [[compost-bin");
    rt.key(KeyEvent { key: Key::Text(" ".into()), mods: CTRL });
    rest(&mut rt);
    chord(&mut rt, Key::Enter, Mods::default());
    assert!(words(&rt.state).ends_with(" [[compost-bin") && rt.state.notice.as_ref().is_some_and(|notice| notice.said.contains("deleted")), "{:?}", rt.state.notice.as_ref().map(|notice| notice.said.clone()));
}

/// The line under the field is one line of one height whatever layer the keys are in: a list opening over the
/// block moves nothing under it, and the list is never drawn over a block of hints that reflowed.
#[test]
fn the_hint_line_under_the_field_keeps_its_height_when_a_list_opens() {
    let (mut rt, _) = writing();
    typed(&mut rt, "Sow by ");
    let (hints, under) = (rect(&rt, "tile/reader/editor-keys"), rect(&rt, "tile/reader/save"));
    assert!(hints[3] <= 24.0, "one line: {hints:?}");
    typed(&mut rt, "[");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    let now = rect(&rt, "tile/reader/editor-keys");
    assert_eq!(((now[1], now[3]), rect(&rt, "tile/reader/save")), ((hints[1], hints[3]), under), "the line and what is beside it are where they were");
    assert!(texts(&rt).iter().any(|said| said == "accept"), "and it says the list's keys now");
}
