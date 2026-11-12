//! About the note (W6): the tiles that list a note's comments, proposals and revisions follow the reader; a comment
//! is written on the words selected, a thread answered and resolved, a proposal applied and dismissed, a revision
//! opened and put back; and the keys and library screens are lists. Everything is a key, a press or an act line,
//! and every assertion that can be is on the wire.
use rune::{Key, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{self, Actor, App, Tone};
use crate::draft::Writes;
use crate::keys::{self, Layer};

/// The last thing the window asked of the host by this action.
fn sent(asked: &Asked, action: &str) -> Option<Value> { asked.borrow().iter().rev().find(|a| a["action"] == action).cloned() }
/// Every `lists.read` of one source the window asked, oldest first.
fn lists_of(asked: &Asked, from: &str) -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == "lists.read" && a["from"] == from).cloned().collect() }
fn keyed(rt: &Runtime<App>, prefix: &str) -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.key).filter(|key| key.starts_with(prefix)).collect() }
fn says(rt: &Runtime<App>, key: &str) -> Vec<String> { rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with(key))).filter_map(|e| e.text).collect() }
fn line(rt: &mut Runtime<App>, line: &str) -> actions::Outcome {
    let (line, out) = (line.to_string(), std::rc::Rc::new(std::cell::RefCell::new(None)));
    let took = out.clone();
    rt.update(move |s, _| { *took.borrow_mut() = Some(s.act(&line, Actor::Person)); });
    rest(rt);
    out.borrow_mut().take().expect("the act ran")
}

/// The tiles about a note follow the reader by the layout's own wire (`source: tile:reader`, `subject: follows`),
/// as the links tile does: each asks its list of the note the reader shows, asks again when the reader moves on,
/// and one behind another tab asks nothing until it is in front.
#[test]
fn the_tiles_about_a_note_follow_the_reader_and_a_hidden_one_asks_nothing() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    // The desk's dock holds the three as tabs: the comments in front, of the note the reader opened on.
    assert_eq!(lists_of(&asked, "threads").last().map(|a| a["of"].clone()), Some(json!("plot")));
    assert!(lists_of(&asked, "proposals").is_empty() && lists_of(&asked, "revisions").is_empty(), "a tab behind another asks nothing");
    assert_eq!(rt.state.subject_of(&rt.state.layout.named("threads").unwrap()).as_deref(), Some("plot"));
    assert!(rt.find("tile/threads/row/thread-plot").is_some(), "{:?}", keyed(&rt, "tile/threads/"));
    // The reader moves on: the list is asked of the note it shows now, and the row is that note's.
    press(&mut rt, "tile/tree/row/shed");
    assert_eq!(lists_of(&asked, "threads").last().map(|a| a["of"].clone()), Some(json!("shed")));
    assert!(rt.find("tile/threads/row/thread-shed").is_some() && rt.find("tile/threads/row/thread-plot").is_none());
    // Another tab in front: now it asks, of the same note, and the comments ask no more.
    press(&mut rt, "tile/threads/tab/proposals");
    assert_eq!(lists_of(&asked, "proposals").last().map(|a| a["of"].clone()), Some(json!("shed")));
    assert!(rt.find("tile/proposals/row/proposal-shed").is_some());
    let before = lists_of(&asked, "threads").len();
    press(&mut rt, "tile/tree/row/plot");
    assert_eq!(lists_of(&asked, "proposals").last().map(|a| a["of"].clone()), Some(json!("plot")));
    assert_eq!(lists_of(&asked, "threads").len(), before, "the comments are behind a tab now: nothing is asked for them");
    // What `peek` says of one: what it follows and the rows the service listed, each with its own presses.
    let facts = rt.state.cx(&rt.state.layout.named("proposals").unwrap()).map(|cx| (crate::tiles::list::DRAWER.facts)(&cx)).unwrap();
    assert_eq!((facts["follows"].as_str(), facts["rows"][0]["cells"][0]["act"].as_str(), facts["rows"][0]["shows"].as_str()), (Some("reader"), Some("proposal.apply id=\"proposal-plot\""), Some("diff")));
}

/// A comment is written on the words selected in the reader: the selection is told to the window as it is made,
/// the comment opens where the note is read, in the editor a block has, and saving sends it with the words it quotes.
#[test]
fn a_comment_is_written_on_the_words_selected_and_sent_by_the_key_that_saves() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    // The words of the note's first paragraph, selected as a drag across them would.
    rt.update(|_, tx| tx.select_all_text("tile/reader/part/0"));
    rest(&mut rt);
    assert_eq!(rt.selected_text().as_deref(), Some("Before the rain. See the shed and seeds."));
    let picked = rt.state.ui("reader").passage.clone().expect("the selection was told to the window");
    assert!(picked.starts_with("Before the rain."), "{picked}");
    assert!(rt.state.steps.iter().any(|step| step.action == "passage.select" && step.by == Actor::Person && step.ok));
    // The comment's chord opens it over the note, which stays as it reads; the keys are the draft's.
    chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
    let draft = rt.state.draft_on("reader").expect("a comment is being written in the reader");
    assert_eq!((&draft.writes, draft.note.as_str(), draft.hold_id()), (&Writes::Comment { quote: Some(picked.clone()), near: None }, "plot", None), "a comment is held by nobody");
    assert_eq!(rt.state.person().layer, Layer::Draft);
    assert!(rt.find("tile/reader/source").is_some() && rt.find("tile/reader/part/0").is_some() && rt.find("tile/reader/title").is_some(), "the field stands over the note: {:?}", keyed(&rt, "tile/reader/"));
    assert_eq!(says(&rt, "tile/reader/on"), [format!("On “{picked}”")]);
    assert!(sent(&asked, "drafts.hold").is_none(), "nothing is held on the service for a comment");
    // Typed in the same field, completed by the same list.
    typed(&mut rt, "Which rain? See [[sh");
    assert_eq!(rt.state.completing("reader").map(|found| found.rows.iter().map(|row| row.label.clone()).collect::<Vec<_>>()), Some(vec!["Shed".to_string()]));
    chord(&mut rt, Key::Tab, Mods::default());
    assert_eq!(words(&rt.state), "Which rain? See [[shed]]");
    // The key that saves sends it: the words it quotes, what was typed, recorded as the person.
    chord(&mut rt, Key::Command('s'), primary());
    let batch = sent(&asked, "annotations.batch").expect("the comment was sent");
    let input = &batch["operations"][0]["input"];
    assert_eq!((batch["operations"][0]["type"].as_str(), input["blockId"].as_str(), input["expectedRevision"].as_u64(), input["body"].as_str(), input["passage"]["quote"].as_str(), input["source"].as_str()),
        (Some("block-comment"), Some("plot"), Some(3), Some("Which rain? See [[shed]]"), Some(picked.as_str()), Some("user")));
    assert_eq!((batch["author"].as_str(), batch.get("mutation")), (Some("user"), None), "a comment is a block made: recorded by author, as a new note is");
    // Sent, its draft is done, the note reads as before and the list of its comments is read again.
    assert!(rt.state.drafts.is_empty() && rt.state.person().layer == Layer::Tile);
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said == "The comment is sent."), "{:?}", rt.state.notice);
    assert!(lists_of(&asked, "threads").len() >= 2, "the comments are read again once one is written");
}

/// Capture comes first for a comment too: one the service refuses (its words aren't in the note as written) stays
/// in its field with why, and leaving with words unsent is refused until they are dropped by name.
#[test]
fn a_comment_the_service_refuses_keeps_its_words_and_is_only_dropped_by_name() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    assert!(line(&mut rt, "comment quote=\"words nobody wrote\"").ok);
    typed(&mut rt, "Is this right?");
    chord(&mut rt, Key::Enter, primary());
    assert!(sent(&asked, "annotations.batch").is_some());
    assert_eq!(words(&rt.state), "Is this right?", "what was written is still in its field");
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains("Comment quote or context was not found")), "the service's own words: {:?}", rt.state.notice);
    // Esc doesn't lose it; Discard, by name, does.
    chord(&mut rt, Key::Escape, Mods::default());
    assert!(rt.state.draft_on("reader").is_some());
    press(&mut rt, "tile/reader/discard");
    assert!(rt.state.drafts.is_empty());
    // A tile takes one thing being written: a block open for editing there says so to a comment, and the other way.
    press(&mut rt, "tile/reader/edit");
    let second = line(&mut rt, "comment");
    assert!(!second.ok && second.said.contains("an edit of this note is being written in reader"), "{}", second.said);
    assert!(line(&mut rt, "edit.close").ok && line(&mut rt, "comment").ok);
    let edit = line(&mut rt, "edit");
    assert!(!edit.ok && edit.said.contains("is being written"), "{}", edit.said);
}

/// A thread's own presses are the row's cells: Reply opens the same editor where the note is read (the list follows
/// that reader), and Resolve is one write. An agent's reply names its words and is recorded as the agent's.
#[test]
fn a_thread_is_answered_where_the_note_is_read_and_resolved_by_its_own_press() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    // The thread, with what it is on and its replies under it, as the service listed it.
    assert!(rt.find("tile/threads/row/thread-plot/view").is_some(), "{:?}", keyed(&rt, "tile/threads/"));
    assert!(says(&rt, "tile/threads/row/thread-plot/view").iter().any(|said| said == "“Before the rain.”"));
    press(&mut rt, "tile/threads/row/thread-plot/press/0");
    let draft = rt.state.draft_on("reader").expect("the reply is written in the reader the list follows");
    assert_eq!(draft.writes, Writes::Reply { thread: "thread-plot".into(), to: "Which rain?".into() });
    assert_eq!(says(&rt, "tile/reader/on"), ["In reply to “Which rain?”"]);
    assert_eq!(rt.state.steps.last().map(|step| (step.line(), step.tile.clone())), Some(("reply thread=thread-plot tile=reader".to_string(), Some("reader".to_string()))), "a press in the list is about the reader it follows");
    typed(&mut rt, "Friday's, I think.");
    press(&mut rt, "tile/reader/save");
    let reply = sent(&asked, "annotations.reply").expect("the reply was sent");
    assert_eq!((reply["input"]["annotationId"].as_str(), reply["input"]["body"].as_str(), reply["input"]["source"].as_str(), reply["author"].as_str()), (Some("thread-plot"), Some("Friday's, I think."), Some("user"), Some("user")));
    assert!(rt.state.drafts.is_empty());
    // Resolve: the thread's lifecycle, recorded as whoever pressed.
    press(&mut rt, "tile/threads/row/thread-plot/press/1");
    let resolved = sent(&asked, "annotations.lifecycle").expect("the thread was resolved");
    assert_eq!((resolved["input"]["annotationId"].as_str(), resolved["input"]["lifecycle"].as_str(), resolved["mutation"]["author"].as_str()), (Some("thread-plot"), Some("resolved"), Some("user")));
    // An agent's: with its words it is sent at once as the agent, and opens nothing; without them it is refused.
    let mut app = rt.state;
    let agent = Actor::Agent("compost-agent".into());
    let said = app.act("reply thread=thread-plot body=\"Moved to Friday.\"", agent.clone());
    app.settle();
    assert!(said.ok && app.drafts.is_empty());
    let reply = sent(&asked, "annotations.reply").unwrap();
    assert_eq!((reply["input"]["source"].as_str(), reply["author"].as_str(), reply["provenance"]["actorId"].as_str()), (Some("agent"), Some("agent"), Some("compost-agent")));
    let wordless = app.act("comment quote=\"Before the rain.\"", agent.clone());
    assert!(!wordless.ok && wordless.said.contains("names its words: body="), "{}", wordless.said);
    let selecting = app.act("passage.select quote=\"Before the rain.\"", agent.clone());
    assert!(!selecting.ok && selecting.said.contains("the selection in a reader is whoever reads there"), "{}", selecting.said);
    let reopened = app.act("resolve thread=thread-plot open=true", agent);
    app.settle();
    assert!(reopened.ok);
    let lifecycle = sent(&asked, "annotations.lifecycle").unwrap();
    assert_eq!((lifecycle["input"]["lifecycle"].as_str(), lifecycle["mutation"]["actorId"].as_str()), (Some("open"), Some("compost-agent")));
}

/// A proposal's change is drawn from what the service answered (a `diff`: the window compares no text), and its
/// two presses are writes on the wire, recorded as whoever acts; a refusal is said in the service's words.
#[test]
fn a_proposal_s_change_is_drawn_as_served_and_applied_and_dismissed_on_the_wire() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/threads/tab/proposals");
    // The change, line by line, as the list's row carries it: what is taken out and what is written.
    let drawn = keyed(&rt, "tile/proposals/row/proposal-plot/view");
    assert!(drawn.iter().any(|key| key.ends_with("/line/1")) && drawn.iter().any(|key| key.ends_with("/line/2")), "{drawn:?}");
    let lines: Vec<String> = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with("tile/proposals/row/proposal-plot/view/line/"))).filter_map(|e| e.label).collect();
    assert_eq!(lines, ["del: Before the rain.", "add: Before Friday's rain."]);
    // Apply, pressed: the service's write, as the person; what the window shows of the note is read again.
    let pages = asked.borrow().iter().filter(|a| a["action"] == "notes.page").count();
    press(&mut rt, "tile/proposals/row/proposal-plot/press/0");
    let applied = sent(&asked, "draft.proposal.apply").expect("apply was sent");
    assert_eq!((applied["proposalId"].as_str(), applied["mutation"]["author"].as_str()), (Some("proposal-plot"), Some("user")));
    assert!(asked.borrow().iter().filter(|a| a["action"] == "notes.page").count() > pages, "the note is read again once the edit is in it");
    // Dismiss, by an agent over an act line: recorded as the agent.
    let mut app = rt.state;
    let dismissed = app.act("proposal.dismiss id=proposal-plot", Actor::Agent("tidy-agent".into()));
    app.settle();
    assert!(dismissed.ok, "{}", dismissed.said);
    let sent_dismiss = sent(&asked, "draft.proposal.dismiss").expect("dismiss was sent");
    assert_eq!((sent_dismiss["proposalId"].as_str(), sent_dismiss["mutation"]["author"].as_str(), sent_dismiss["mutation"]["actorId"].as_str()), (Some("proposal-plot"), Some("agent"), Some("tidy-agent")));
    // One whose passage is gone: the service says so, and the window says it as it came.
    assert!(act(&mut app, "proposal.apply id=proposal-gone").ok, "the act is sent; what became of it comes back");
    assert!(app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains("passage is no longer in the note")), "{:?}", app.notice);
}

/// A revision is opened by picking its row, which folds like any row that does: the list is asked with it open and
/// answers its change. Restore puts its text into the editor, where saving writes it and Discard leaves the note.
#[test]
fn a_revision_s_change_opens_under_its_row_and_restore_puts_its_text_in_the_editor() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/threads/tab/revisions");
    assert!(rt.find("tile/revisions/row/2").is_some() && rt.find("tile/revisions/row/2/view").is_none(), "{:?}", keyed(&rt, "tile/revisions/"));
    // A press on the earlier one opens it: asked of the service, which answers its change against the note now.
    press(&mut rt, "tile/revisions/row/2");
    assert_eq!(lists_of(&asked, "revisions").last().map(|a| (a["of"].clone(), a["open"].clone())), Some((json!("plot"), json!(["2"]))));
    let lines: Vec<String> = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with("tile/revisions/row/2/view/line/"))).filter_map(|e| e.label).collect();
    assert_eq!(lines, ["same: Take the fork [type::chore]", "del: After the rain.", "add: Before the rain."]);
    // Its line pressed again folds it; an agent's pick opens it the same way (the tile's own state, whoever picks).
    press(&mut rt, "tile/revisions/row/2/head");
    assert!(rt.find("tile/revisions/row/2/view").is_none());
    let picked = rt.state.act("list.pick id=2 tile=revisions", Actor::Agent("compost-agent".into()));
    assert!(picked.ok && picked.answer["open"] == true, "{} {}", picked.said, picked.answer);
    // The one the note is at folds nothing and runs nothing.
    let now = line(&mut rt, "list.pick id=3 tile=revisions");
    assert!(!now.ok && now.said.contains("runs nothing when picked"), "{}", now.said);
    // Restore: that revision's text is asked for, and goes into the block's draft in the reader the list follows.
    press(&mut rt, "tile/revisions/row/2/press/0");
    let read = sent(&asked, "block.revisions").expect("the revision's text was asked for");
    assert_eq!((read["blockId"].as_str(), read["revision"].as_u64()), (Some("plot"), Some(2)));
    let draft = rt.state.draft_on("reader").expect("the editor is open on the note");
    assert_eq!((draft.is_block(), draft.revision, draft.base.as_str(), words(&rt.state)), (true, 3, "Plot [type::chore]\nBefore the rain.", "Plot [type::chore]\nAfter the rain."));
    assert!(unsaved(&rt.state) && sent(&asked, "update").is_none(), "nothing is written until it is saved");
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.starts_with("Revision 2's text (saved 2031-03-30 18:00) is in the editor.")), "{:?}", rt.state.notice);
    // Saved: an ordinary update at the revision the note was at, recorded as the person.
    chord(&mut rt, Key::Command('s'), primary());
    let update = sent(&asked, "update").expect("the restored text was saved");
    assert_eq!((update["blockId"].as_str(), update["text"].as_str(), update["expectedRevision"].as_u64(), update["mutation"]["author"].as_str()), (Some("plot"), Some("Plot [type::chore]\nAfter the rain."), Some(3), Some("user")));
    // An agent doesn't put a text in the editor, and a revision nobody kept is the service's to say.
    let theirs = rt.state.act("revision.restore revision=2", Actor::Agent("compost-agent".into()));
    assert!(!theirs.ok && theirs.said.contains("the editor is whoever writes there"), "{}", theirs.said);
    assert!(line(&mut rt, "edit.close").ok);
    assert!(line(&mut rt, "revision.restore revision=1").ok);
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains("Revision 1 of plot isn't kept")), "{:?}", rt.state.notice);
    assert!(rt.state.drafts.is_empty());
}

/// The keys screen is a list the service makes from the rows this window hands it: the window keeps no second
/// table for it. What it hands over is every action's row, as `actions` over the control socket lists them.
#[test]
fn the_keys_screen_is_a_list_made_from_the_rows_the_window_hands_over() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    assert!(line(&mut rt, "screen.open name=keys").ok);
    let ask = lists_of(&asked, "actions").last().cloned().expect("the keys screen asks the list of its actions");
    let handed: Vec<&Value> = ask["actions"].as_array().expect("the window hands over its rows").iter().collect();
    assert_eq!(handed.iter().map(|row| row["id"].as_str().unwrap()).collect::<Vec<_>>(), actions::all().map(|action| action.row.id).collect::<Vec<_>>(), "every action, in the order its noun lists it");
    for (row, action) in handed.iter().zip(actions::all()) { assert_eq!(**row, serde_json::to_value(action.row).unwrap(), "{}: the row as it is", action.row.id) }
    // What comes back is drawn as any table is, and its rows are the key table's: each chord with the line it runs.
    let rows = rt.state.rows_of(&rt.state.layout.named("keys").unwrap()).to_vec();
    let listed: Vec<(String, crate::actline::Request, String)> = rows.iter().map(|row| (crate::page::ListRow::cell(&row.cells[0]), crate::actline::parse(&crate::page::ListRow::cell(&row.cells[1])).unwrap(), crate::page::ListRow::cell(&row.cells[2]))).collect();
    let table: Vec<(String, crate::actline::Request, String)> = keys::table().iter().map(|bind| (bind.spec.clone(), crate::actline::parse(&bind.line).unwrap(), bind.layer.map_or("everywhere", Layer::name).to_string())).collect();
    assert_eq!(listed, table, "the keys screen and the key table are the same rows");
    assert!(rt.find("tile/keys/columns").is_some() && rt.find(&format!("tile/keys/row/{}", rows[0].id)).is_some(), "{:?}", keyed(&rt, "tile/keys/").iter().take(8).collect::<Vec<_>>());
    // A pick runs the line, where the same line typed in the bar would.
    let back = rows.iter().find(|row| row.act.as_deref() == Some("bar.open")).expect("the bar's chord is listed");
    press(&mut rt, &format!("tile/keys/row/{}", back.id));
    assert!(rt.state.bar.open);
}

/// The library screen is a list of the components; one picked shows what it is and its own example, the primitives
/// the service lowered it to, built by the registry every page's parts go through.
#[test]
fn the_library_s_components_fold_and_an_open_one_draws_its_own_example() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    assert!(line(&mut rt, "screen.open name=library").ok);
    assert!(rt.find("tile/components/row/callout").is_some() && rt.find("tile/components/group/figures").is_some(), "{:?}", keyed(&rt, "tile/components/"));
    assert!(rt.find("tile/components/row/graph-stat/view").is_none());
    press(&mut rt, "tile/components/row/graph-stat");
    assert_eq!(lists_of(&asked, "components").last().map(|a| a["open"].clone()), Some(json!(["graph-stat"])));
    let drawn = keyed(&rt, "tile/components/row/graph-stat/view");
    assert!(drawn.len() > 4, "what it is, as written, as drawn: {drawn:?}");
    assert!(rt.elements().iter().any(|e| e.text.as_deref() == Some("4")), "the example's stat is drawn");
    // An example that lists notes is a list under a row of this list: its rows are built whole (rows built only in
    // view can't hold rows built only in view), and a press on one is the row's own act line, as on a page.
    let nested: Vec<String> = keyed(&rt, "tile/components/row/graph-stat/view").into_iter().filter(|key| key.ends_with("/beans")).collect();
    assert_eq!(nested.len(), 1, "{:?}", keyed(&rt, "tile/components/row/graph-stat/view"));
    assert!(rt.elements().iter().any(|e| e.text.as_deref() == Some("Water the beans") && e.path.contains("tile/components/row/graph-stat/view")));
}

/// The hint row under a field says the keys of where the person is: the editor's while they write, and the open
/// list's while the list that completes a word is over it (its keys come first, so they are the ones to say).
#[test]
fn the_hint_row_under_a_field_says_the_keys_of_where_the_person_is() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    let hints = |rt: &Runtime<App>| -> Vec<String> { rt.elements().into_iter().filter(|e| e.path.contains("tile/reader/editor-keys")).filter_map(|e| e.text).collect() };
    let said = hints(&rt);
    assert!(said.iter().any(|does| does == "save") && said.iter().any(|does| does == "leave the editor, when everything is saved"), "{said:?}");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "See [[s");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    let said = hints(&rt);
    assert!(said.iter().any(|does| does == "write the lit row") && said.iter().any(|does| does == "put the list away") && !said.iter().any(|does| does == "save"), "{said:?}");
    chord(&mut rt, Key::Escape, Mods::default());
    assert!(hints(&rt).iter().any(|does| does == "save"), "the list put away, the keys are the editor's again");
}
