//! A comment in place (H4): the words picked are found as whole words before a comment is written on them; the
//! comment's field stands in the page under the part its words are in, with both in view; the words a thread is on
//! are marked on the page and its card stands beside them, opened by a press on either; the person's own send brings
//! the note's comments forward, and nobody else's does; and the keys of picked words are the door's, offered by
//! them as presses. Everything is a key, a press or an act line, over the stand-in garden (the sowing plan: a note
//! whose page the service's own functions wrote, `core-contract.json`).
use rune::{Key, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{self, Actor, App, Tone};
use crate::draft::{Writes, shortened};
use crate::keys::Layer;

fn sent(asked: &Asked, action: &str) -> Option<Value> { asked.borrow().iter().rev().find(|a| a["action"] == action).cloned() }
fn says(rt: &Runtime<App>, key: &str) -> Vec<String> { rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with(key))).filter_map(|e| e.text).collect() }
fn keyed(rt: &Runtime<App>, prefix: &str) -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.key).filter(|key| key.starts_with(prefix)).collect() }
fn line(rt: &mut Runtime<App>, line: &str) -> actions::Outcome {
    let (line, out) = (line.to_string(), std::rc::Rc::new(std::cell::RefCell::new(None)));
    let took = out.clone();
    rt.update(move |s, _| { *took.borrow_mut() = Some(s.act(&line, Actor::Person)); });
    rest(rt);
    out.borrow_mut().take().expect("the act ran")
}
/// An element by its key: where it is, and the part of it its tile's scroll leaves in view.
fn drawn(rt: &Runtime<App>, key: &str) -> ([f32; 4], [f32; 4]) { rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).map(|e| (e.rect, e.visible)).unwrap_or_else(|| panic!("nothing on screen is keyed {key}: {:?}", keyed(rt, "tile/reader/"))) }
/// A press as a hand makes one: the pointer comes to the point, goes down and comes up.
fn pressed(rt: &mut Runtime<App>, key: &str) {
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}: {:?}", keyed(rt, "tile/reader/")));
    rt.pointer_move(x, y);
    rt.frame(1.0 / 60.0);
    rt.pointer_down(x, y);
    rt.pointer_up(x, y);
    rest(rt);
}
/// The window at a size of its own, as `window` makes one.
fn sized(app: App, size: (f32, f32)) -> Runtime<App> {
    let mut rt = Runtime::new(app, crate::shell::view, size, rune::Env { system_dark: false, scale: 1.0 });
    rt.poll = Some(|s, _, tx| { let landed = s.take() | s.ran(); crate::keys::effects(s, tx) | crate::keys::follow(s, tx) | landed });
    rt.on_key = Some(crate::keys::press);
    for _ in 0..3 { rt.frame(0.0); }
    rt
}
fn sowing(g: Garden) -> Runtime<App> {
    let mut rt = window(g.app);
    assert!(line(&mut rt, &format!("open id={SOWING}")).ok);
    rt
}
fn within(part: usize) -> (usize, usize) { let span = &quotes()["quotedNote"]["parts"][part]["span"]; (span["start"].as_u64().unwrap() as usize, span["end"].as_u64().unwrap() as usize) }

/// Evan's quote lost its first letter twice: "ction Define", "DF and web pages". A press on a first letter lands past
/// its middle as often as not, and the selection Rune makes then starts after it (and a press in the gutter left of
/// a line starts none), so the words told to the window, shown over the comment and sent to the service were all a
/// character short. The window widens nothing itself: it asks the service where the words are as they are picked,
/// as whole words, and what a comment on them shows and sends is the passage the service found. From the first
/// letter of a paragraph and of a list item, as the selection says them (`passage.select`).
#[test]
fn words_picked_from_inside_a_word_are_the_whole_words_the_service_found() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = sowing(g);
    for (part, said, whole, exact) in [
        (0, "ow the early peas in Marc", "Sow the early peas in March", "Sow the [early peas](https://seeds.example/peas) in March"),
        (4, "et the peas against pigeons.\n- Stake the bea", "Net the peas against pigeons. Stake the beans", "Net the peas against pigeons.\n- Stake the beans"),
    ] {
        let (from, to) = within(part);
        assert!(line(&mut rt, &format!("passage.select quote={} from={from} to={to}", actions::word(said))).ok);
        // Asked as picked, as whole words; the answer is what the reader holds as picked.
        let find = sent(&asked, "passages.find").expect("the service is asked where the words are");
        assert_eq!((&find["passage"], find["whole"].as_str()), (&json!({ "quote": said, "drawn": true, "within": { "start": from, "end": to } }), Some("words")));
        let picked = rt.state.ui("reader").passage.clone().expect("the words are picked");
        let text = quotes()["quotedNote"]["text"].as_str().unwrap().to_string();
        let at = text.find(exact).unwrap();
        assert_eq!((picked.words.as_str(), picked.found.clone()), (whole, Some(Ok((at, at + exact.len())))), "part {part}");
        // The same words said again (a selection's release says them once more) are asked about no second time.
        let finds = asked.borrow().iter().filter(|a| a["action"] == "passages.find").count();
        assert!(line(&mut rt, &format!("passage.select quote={} from={from} to={to}", actions::word(said))).ok);
        assert_eq!((asked.borrow().iter().filter(|a| a["action"] == "passages.find").count(), rt.state.ui("reader").passage.as_ref().map(|quoted| quoted.words.clone())), (finds, Some(whole.to_string())));
        // The comment says the whole words over its field, and sends them.
        chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
        assert_eq!(says(&rt, "tile/reader/on"), [format!("On “{whole}”")], "part {part}");
        assert!(rt.find("tile/reader/on-problem").is_none());
        typed(&mut rt, "Here.");
        chord(&mut rt, Key::Command('s'), primary());
        assert_eq!(sent(&asked, "annotations.batch").unwrap()["operations"][0]["input"]["passage"], json!({ "quote": whole, "drawn": true, "within": { "start": from, "end": to } }), "part {part}");
        assert!(rt.state.drafts.is_empty() && rt.state.notice.as_ref().is_some_and(|n| n.said == "The comment is sent."), "{:?}", rt.state.notice);
    }
    // Words the note doesn't hold as picked: the service's why stands over the field before anything is written,
    // the comment can still be written, and the send says the same.
    let (from, to) = within(0);
    assert!(line(&mut rt, &format!("passage.select quote=\"Sow the late peas in May\" from={from} to={to}")).ok);
    assert!(line(&mut rt, "comment").ok);
    assert!(says(&rt, "tile/reader/on-problem").iter().any(|why| why.contains("Comment quote or context was not found")), "{:?}", says(&rt, "tile/reader/on"));
    assert_eq!(rt.state.person().layer, Layer::Draft);
}

/// A long passage is said by its start and its end: one or two lines over the field, whatever was picked.
#[test]
fn a_long_quote_is_said_by_its_start_and_its_end() {
    let long = "Action Define (ext.marginalia.define, on selected words, key d, writes): Look the words up in the note's glossary and write the meaning in the margin.\n- Action Cite (on selected words, key k, reads): Copy the passage with a citation to where it is from.\n\nAgent margin answers a question about a passage in its margin thread; a later @margin there resumes it.";
    let said = shortened(long);
    assert!(said.chars().count() <= 150 && !said.contains('\n'), "{said}");
    assert!(said.starts_with("Action Define (ext.marginalia.define, on selected words, key d, writes): Look the") && said.ends_with("a later @margin there resumes it.") && said.contains(" … "), "{said}");
    // Cut at words, never inside one; a short one is said whole, on one line.
    let (head, tail) = said.split_once(" … ").unwrap();
    assert!(long.replace('\n', " ").replace("  ", " ").contains(&format!("{head} ")) && long.contains(&format!(" {tail}")), "{said}");
    assert_eq!(shortened("Peas go in first.\n\nThe beans go in May."), "Peas go in first. The beans go in May.");
    assert_eq!(Writes::Comment { on: Some(crate::draft::Quoted::written(long, None)) }.on(), Some(format!("On “{said}”")));
}

/// Evan's comment box opened at the top of an 85-line note, far from the words he had selected. It stands in the
/// page under the part its words are in, as a block's draft stands where the block is read, with the page scrolled
/// so the words and the field are both in view; a comment on the whole note stands at the top; and a reply stands
/// under the part its thread is on.
#[test]
fn a_comment_is_written_under_the_part_its_words_are_in_with_both_in_view() {
    let g = garden(ok());
    // (A window short enough that the note runs past its reader: its last part starts out of view.)
    let mut rt = sized(g.app, (1180.0, 520.0));
    assert!(line(&mut rt, &format!("open id={SOWING}")).ok);
    let top = |rt: &Runtime<App>, key: &str| drawn(rt, key).0[1];
    let (last, seen) = drawn(&rt, "tile/reader/part/4");
    assert!(seen[3] < last[3], "the note's last part is below the fold: {seen:?} of {last:?}");
    // The note's last part, far down the page: picked there, the comment opens there.
    rt.update(|s, tx| { tx.scroll_into_view("tile/reader/part/4"); let _ = s; });
    rest(&mut rt);
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/4"));
    rest(&mut rt);
    let picked = rt.state.ui("reader").passage.clone().expect("the selection was told to the window");
    // (A Markdown view copies a list with each item after its marker; the passage is the two items.)
    let list = within(4);
    assert_eq!((picked.words.as_str(), picked.found.clone()), ("- Net the peas against pigeons.\n- Stake the beans before the wind.", Some(Ok((list.0 + 2, list.1)))));
    // (Its own actions are by it, under its part, before anything is written.)
    assert!(top(&rt, "tile/reader/picked") > top(&rt, "tile/reader/part/4"));
    chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
    assert!(rt.state.draft_on("reader").is_some_and(|draft| !draft.is_block()), "{:?}", rt.state.notice);
    let ((part, part_seen), (field, field_seen)) = (drawn(&rt, "tile/reader/part/4"), drawn(&rt, "tile/reader/editor"));
    assert!(field[1] >= part[1] + part[3] && field[1] - (part[1] + part[3]) < 40.0, "the field is directly under its part: part {part:?}, field {field:?}");
    assert!(top(&rt, "tile/reader/part/3") < part[1], "and nowhere near the top: the parts above are above");
    assert!(part_seen[3] >= part[3] - 1.0 && field_seen[3] >= field[3] - 1.0, "the words and the field are both in view: {part_seen:?} of {part:?}, {field_seen:?} of {field:?}");
    assert!(rt.find("tile/reader/picked").is_none(), "the field took the place of the row of its actions");
    pressed(&mut rt, "tile/reader/done");
    // In the middle of the page: under that part, over the next.
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/2"));
    rest(&mut rt);
    assert!(line(&mut rt, "comment").ok);
    let (field, part) = (drawn(&rt, "tile/reader/editor").0, drawn(&rt, "tile/reader/part/2").0);
    assert!(field[1] >= part[1] + part[3] && field[1] < top(&rt, "tile/reader/part/3"), "{field:?} {part:?}");
    pressed(&mut rt, "tile/reader/done");
    // Nothing picked: on the whole note, over its first part.
    pressed(&mut rt, "tile/reader/title");
    assert!(line(&mut rt, "comment").ok);
    assert_eq!(says(&rt, "tile/reader/on"), ["On the whole note"]);
    assert!(top(&rt, "tile/reader/editor") < top(&rt, "tile/reader/part/0"));
    pressed(&mut rt, "tile/reader/done");
    // A reply stands under the part its thread's words are in.
    assert!(line(&mut rt, "reply thread=thread-sowing").ok);
    let (field, part) = (drawn(&rt, "tile/reader/editor").0, drawn(&rt, "tile/reader/part/0").0);
    assert!(field[1] >= part[1] + part[3] && field[1] < top(&rt, "tile/reader/part/1"), "{field:?} {part:?}");
}

/// A run of prose is one part of the page however long it is: a note of nothing but headings, paragraphs and lists
/// is one part, and a comment "under the part its words are in" then opens a screen below them, as far away as the
/// top was. So the reader says which part its picked words end in when it asks where they are, the service answers
/// where they are in the text that part is drawn from, and the field stands in the part, under the block of it
/// the words end in, with the rest of the part under the field. The words a thread is on stay marked on both sides.
#[test]
fn a_comment_on_words_in_the_middle_of_a_part_is_written_under_the_block_they_end_in() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = sowing(g);
    // The sowing plan's first part is two paragraphs. Words of the first, a press late at each end.
    let (from, to) = within(0);
    assert!(line(&mut rt, &format!("passage.select quote={} from={from} to={to}", actions::word("ow the early peas in Marc"))).ok);
    // Asked with the part the words end in, as it was drawn: its span of the note, the text of its view.
    let find = sent(&asked, "passages.find").expect("the service is asked where the words are");
    assert_eq!(find["part"], json!({ "start": from, "end": to, "text": quotes()["quotedNote"]["parts"][0]["view"]["text"] }));
    let picked = rt.state.ui("reader").passage.clone().expect("the words are picked");
    assert_eq!(picked.at, Some(crate::parts::Anchor { part: 1, range: Some((0, 57)) }), "where they are in that part's own text is the service's word");
    chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
    let said = |rt: &Runtime<App>, words: &str| rt.elements().into_iter().find(|e| e.role != "mark" && e.text.as_deref().is_some_and(|text| text.starts_with(words))).map(|e| e.rect).unwrap_or_else(|| panic!("no text drawn starts with {words}"));
    let (field, first, second, part) = (drawn(&rt, "tile/reader/editor").0, said(&rt, "Sow the "), said(&rt, "Water the beds at dusk."), drawn(&rt, "tile/reader/part/0").0);
    assert!(field[1] >= first[1] + first[3] && field[1] + field[3] <= second[1], "the field is between the paragraph its words are in and the next: first {first:?}, field {field:?}, second {second:?}");
    assert!(field[1] > part[1] && field[1] + field[3] < part[1] + part[3], "inside its part: {field:?} in {part:?}");
    // The part is still one part: its thread's words are marked on both sides of the field, a line a mark.
    let marks: Vec<(String, String)> = rt.elements().into_iter().filter(|e| e.role == "mark").filter_map(|e| Some((e.key?, e.text?))).collect();
    assert_eq!(marks, [("tile/reader/mark/thread-sowing/1/0".to_string(), "the last frost.".to_string()), ("tile/reader/mark/thread-sowing/1/1".to_string(), "Water the beds at dusk.".to_string())]);
    // Sent as the whole words; with the field gone the part is drawn in one piece again.
    typed(&mut rt, "Under glass?");
    chord(&mut rt, Key::Command('s'), primary());
    assert_eq!(sent(&asked, "annotations.batch").unwrap()["operations"][0]["input"]["passage"]["quote"], "Sow the early peas in March");
    assert!(rt.state.drafts.is_empty() && rt.find("tile/reader/editor").is_none() && rt.find("tile/reader/part/0/rest").is_none(), "{:?}", rt.state.notice);
    // Words that end in a part's last block (or a list's last item: a list is one block) have nothing of the part
    // under them: the field is under the part, as it was.
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/2"));
    rest(&mut rt);
    assert!(line(&mut rt, "comment").ok);
    let (field, part) = (drawn(&rt, "tile/reader/editor").0, drawn(&rt, "tile/reader/part/2").0);
    assert!(field[1] >= part[1] + part[3] && rt.find("tile/reader/part/2/rest").is_none(), "{field:?} {part:?}");
}

/// After Evan sent his comment nothing on the page showed it. The words a thread is on are marked where they are
/// drawn, from the marks the service puts on the page's parts (a range of the Markdown each part is drawn from: the
/// window reads no source), and the thread is beside them: its first words as a card, which a press on the card or
/// on the marked words opens whole, with the thread's own Reply and Resolve.
#[test]
fn the_words_a_thread_is_on_are_marked_and_a_press_on_them_shows_the_thread_beside_them() {
    let g = garden(ok());
    let asked = g.asked.clone();
    // (A window wide enough for the reader to have a margin beside its measure.)
    let mut rt = sized(g.app, (1760.0, 900.0));
    assert!(line(&mut rt, &format!("open id={SOWING}")).ok);
    // The mark is on the words, a line of the text a mark: the end of one paragraph and the whole of the next.
    let marks: Vec<(String, String)> = rt.elements().into_iter().filter(|e| e.role == "mark").filter_map(|e| Some((e.key?, e.text?))).collect();
    assert_eq!(marks, [("tile/reader/mark/thread-sowing/1/0".to_string(), "the last frost.".to_string()), ("tile/reader/mark/thread-sowing/1/1".to_string(), "Water the beds at dusk.".to_string())]);
    // The thread is the row of the list the mark names, asked of this note: beside the words, folded to its line.
    assert!(asked.borrow().iter().any(|a| a["action"] == "lists.read" && a["from"] == "threads" && a["of"] == SOWING));
    let (card, part) = (drawn(&rt, "tile/reader/card/thread-sowing").0, drawn(&rt, "tile/reader/part/0").0);
    assert!(card[0] >= part[0] + part[2] && card[1] < part[1] + part[3], "in the margin beside its part: card {card:?}, part {part:?}");
    assert!(says(&rt, "tile/reader/card/thread-sowing").is_empty() && rt.elements().iter().any(|e| e.text.as_deref() == Some("Which rain?") && e.path.contains("tile/reader/card/thread-sowing")));
    assert!(rt.find("tile/reader/margin/thread-sowing/press/0").is_none(), "folded, it has no presses of its own");
    let facts = rt.state.cx("reader").map(|cx| (crate::tiles::page::DRAWER.facts)(&cx)).unwrap();
    assert_eq!(facts["marks"], json!([{ "kind": "thread", "id": "thread-sowing", "part": 2, "range": [70, 110], "act": "thread.toggle thread=\"thread-sowing\"", "from": "threads", "whole": false, "says": "Which rain?" }]));
    // A press on the marked words: the mark's own act, as the person, and the card is whole.
    pressed(&mut rt, "tile/reader/mark/thread-sowing/1/1");
    assert_eq!(rt.state.steps.last().map(|step| (step.line(), step.by.clone(), step.ok)), Some(("thread.toggle thread=thread-sowing tile=reader".to_string(), Actor::Person, true)));
    assert!(rt.state.ui("reader").unfolded.contains("thread-sowing"));
    let whole = rt.elements().into_iter().filter(|e| e.path.contains("tile/reader/card/thread-sowing")).filter_map(|e| e.text).collect::<Vec<_>>();
    assert!(whole.iter().any(|said| plain(said) == "Friday's.") && whole.iter().any(|said| said == "Reply") && whole.iter().any(|said| said == "Resolve"), "the comment, its reply and its own presses: {whole:?}");
    // Its own press, from the page: the reply is written under the part its words are in.
    pressed(&mut rt, "tile/reader/margin/thread-sowing/press/0");
    assert_eq!(rt.state.draft_on("reader").map(|draft| draft.writes.clone()), Some(Writes::Reply { thread: "thread-sowing".into(), to: "Which rain?".into() }));
    pressed(&mut rt, "tile/reader/done");
    // A press on the card's own line folds it again; a press on words that carry no mark does nothing.
    pressed(&mut rt, "tile/reader/margin/thread-sowing/head");
    assert!(!rt.state.ui("reader").unfolded.contains("thread-sowing"));
    let steps = rt.state.steps.len();
    pressed(&mut rt, "tile/reader/title");
    assert_eq!(rt.state.steps.iter().skip(steps).filter(|step| step.action == "thread.toggle").count(), 0);
    // How a note is read is anybody's to change, and takes no keys: an agent opens the card, and the person's
    // focus and selection are where they were.
    pressed(&mut rt, "tile/tree/row/plot");
    assert!(line(&mut rt, &format!("open id={SOWING}")).ok);
    let focus = rt.state.layout.focus.clone();
    rt.update(|s, _| { assert!(s.act("thread.toggle thread=thread-sowing expand=true", Actor::Agent("compost-agent".into())).ok); });
    rest(&mut rt);
    assert!(rt.state.ui("reader").unfolded.contains("thread-sowing") && rt.state.layout.focus == focus);
    // A note with nothing attached to its words is drawn as it always was: no margin, no card.
    assert!(line(&mut rt, "open id=shed").ok);
    assert!(keyed(&rt, "tile/reader/card/").is_empty() && rt.elements().iter().all(|e| e.role != "mark"));
}

/// In a tile too narrow for a margin the card is under the part its words are in, never beside it and never cut.
#[test]
fn in_a_narrow_reader_the_thread_is_under_its_part() {
    let g = garden(ok());
    let mut rt = sized(g.app, (760.0, 760.0));
    assert!(line(&mut rt, &format!("open id={SOWING}")).ok);
    let (card, part) = (drawn(&rt, "tile/reader/card/thread-sowing").0, drawn(&rt, "tile/reader/part/0").0);
    assert!(card[1] >= part[1] + part[3] && card[0] < part[0] + part[2], "under its part: card {card:?}, part {part:?}");
}

/// The tile at the lower left had threads, proposals and revisions as tabs, with revisions in front: Evan's comment
/// was sent and the list that had it was behind a tab. The person's own send brings the tile that lists the note's
/// comments to the front of its tab set, by the dispatcher, as their act; an agent's comment moves no tab.
#[test]
fn the_person_s_send_brings_the_comments_forward_and_an_agent_s_moves_no_tab() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    let front = |rt: &Runtime<App>| ["threads", "proposals", "revisions"].into_iter().find(|tab| rt.find(&format!("tile/{tab}/title")).is_some()).map(str::to_string);
    press(&mut rt, "tile/threads/tab/revisions");
    assert_eq!(front(&rt).as_deref(), Some("revisions"));
    // An agent comments: sent, recorded as the agent's, and the tabs are as they were; so are the person's keys.
    let focus = rt.state.layout.focus.clone();
    rt.update(|s, _| { assert!(s.act("comment body=\"Which rain?\" quote=\"Before the rain.\"", Actor::Agent("compost-agent".into())).ok); });
    rest(&mut rt);
    assert_eq!(sent(&asked, "annotations.batch").unwrap()["operations"][0]["input"]["source"], "agent");
    assert_eq!((front(&rt).as_deref(), rt.state.layout.focus == focus, rt.state.steps.iter().any(|step| step.action == "threads")), (Some("revisions"), true, false));
    // The person comments on the note: written in the reader, sent by the key that saves.
    press(&mut rt, "tile/reader/title");
    assert!(line(&mut rt, "comment quote=\"Before the rain.\"").ok);
    typed(&mut rt, "Friday's.");
    chord(&mut rt, Key::Command('s'), primary());
    assert!(rt.state.drafts.is_empty() && rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said == "The comment is sent."), "{:?}", rt.state.notice);
    assert_eq!(front(&rt).as_deref(), Some("threads"), "the comments are in front");
    assert_eq!(rt.state.steps.last().map(|step| (step.action.clone(), step.by.clone(), step.ok)), Some(("threads".to_string(), Actor::Person, true)), "by the dispatcher, as the person's own act");
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "reader", "and the keys are where the person was reading");
    // By its act line too, from behind another tab; and where no tile lists the note's comments it says so.
    press(&mut rt, "tile/threads/tab/proposals");
    assert!(line(&mut rt, "threads").ok);
    assert_eq!(front(&rt).as_deref(), Some("threads"));
    assert!(line(&mut rt, "tile.close tile=threads").ok && line(&mut rt, "tile.close tile=proposals").ok && line(&mut rt, "tile.close tile=revisions").ok);
    let none = line(&mut rt, "threads");
    assert!(!none.ok && none.said.contains("no tile here lists the comments"), "{}", none.said);
    // With none to bring forward, a comment sent is only said: no refusal takes the notice's place.
    assert!(line(&mut rt, "comment quote=\"Before the rain.\"").ok);
    typed(&mut rt, "Again.");
    chord(&mut rt, Key::Command('s'), primary());
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said == "The comment is sent."), "{:?}", rt.state.notice);
}

/// The keys to comment "seem to differ a bit from the TUI": in the door a selection's keys are `a` then a letter,
/// `a` `c` to comment, and its line offers them as chips. Here the same two keys comment while words are picked in
/// the reader with the keys (and only then: `a` alone is nobody's key otherwise), and the actions of picked words
/// are a row of buttons by them, each labelled and capped from its own row.
#[test]
fn the_keys_of_picked_words_are_the_door_s_and_are_offered_by_the_words() {
    let g = garden(ok());
    let mut rt = sowing(g);
    // Nothing picked: the keys are the tile's, `a` starts nothing, and nothing is offered.
    assert_eq!(rt.state.person().layer, Layer::Tile);
    let steps = rt.state.steps.len();
    typed(&mut rt, "ac");
    assert!(rt.state.steps.len() == steps && rt.state.drafts.is_empty() && rt.find("tile/reader/picked").is_none());
    // Words picked in the reader with the keys: the layer is theirs, over the tile's own.
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/2"));
    rest(&mut rt);
    let picked = rt.state.ui("reader").passage.clone().expect("the selection was told to the window");
    assert_eq!((rt.state.person().layer, rt.state.person().busy), (Layer::Selection, false));
    let bind = crate::keys::table().iter().find(|bind| bind.layer == Some(Layer::Selection)).expect("the comment's row binds the keys of picked words");
    assert_eq!((bind.spec.as_str(), bind.line.as_str()), ("a then c", "comment"), "the door's keys for it (passage.act's `a then c`)");
    // The row by the words is the table's rows for that layer: the action's own label, its key from the table.
    assert_eq!(rt.state.offered("reader"), ["comment"]);
    let offered = rt.elements().into_iter().filter(|e| e.path.contains("tile/reader/picked/comment")).filter_map(|e| e.text).collect::<Vec<_>>();
    assert!(offered.iter().any(|said| *said == actions::label("comment")) && offered.iter().any(|said| said.contains('M') || said.contains('m')), "{offered:?}");
    // A press on it leaves the selection, so the comment is on those words.
    let (x, y) = rt.find("tile/reader/picked/comment").unwrap();
    rt.pointer_down(x, y);
    rest(&mut rt);
    assert_eq!(rt.selected_text().as_deref(), Some("Water the beds at dusk, and again at dawn."), "a press on the row leaves the selection");
    rt.pointer_up(x, y);
    rest(&mut rt);
    assert_eq!(rt.state.draft_on("reader").map(|draft| draft.writes.clone()), Some(Writes::Comment { on: Some(picked.clone()) }));
    pressed(&mut rt, "tile/reader/done");
    // By the keys: `a`, then `c`.
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/2"));
    rest(&mut rt);
    typed(&mut rt, "a");
    assert!(rt.state.drafts.is_empty(), "the first key of the two waits for the second");
    typed(&mut rt, "c");
    assert_eq!(rt.state.draft_on("reader").map(|draft| draft.writes.clone()), Some(Writes::Comment { on: Some(picked) }));
    assert_eq!(rt.state.steps.last().map(|step| (step.line(), step.by.clone())), Some(("comment".to_string(), Actor::Person)));
    // What is typed next is the comment's: the keys are the draft's, and `a` is a letter again.
    typed(&mut rt, "a c");
    assert_eq!(words(&rt.state), "a c");
    // The keys screen's row for it says where it holds, as the table does.
    let rows = crate::keys::rows(&rt.state);
    assert!(rows.as_array().unwrap().iter().any(|row| row["chord"] == "a then c" && row["line"] == "comment" && row["layer"] == "selection"), "{rows}");
}
