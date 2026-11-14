//! The window over the garden's stand-in host: what it asks, and what it does with the answers. Everything it is
//! told to do is an act line, as a key, a press or an agent would say it; every assertion that can be is on the wire.
use std::cell::RefCell;

use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, Field, Tone};
use crate::tiles::picture::Shown;
use crate::bar;
use crate::client::PROTOCOL;

fn problem(app: &App, words: &str) -> bool { app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains(words)) }
fn info(app: &App, words: &str) -> bool { app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.contains(words)) }
fn page_key(asked: &Asked, note: &str) -> String { watch_of(asked, "notes.page", |a| a["blockId"] == note) }
/// The watch the tree's list is kept under while these folders are open.
fn tree_key(asked: &Asked, open: &[&str]) -> String { watch_of(asked, "lists.read", |a| a["from"] == "children" && a["open"] == json!(open)) }
/// The lists asked for, by what each is of.
fn lists(asked: &Asked) -> Vec<String> { asked.borrow().iter().filter(|a| a["action"] == "lists.read").map(|a| a["from"].as_str().unwrap().to_string()).collect() }

#[test]
fn the_window_opens_with_its_reader_empty_and_asks_for_no_more_than_it_shows() {
    let Garden { mut app, asked, .. } = garden_unopened(ok());
    // Who answers and who this window is, then what a window is made of (the screens and kinds, what a list can be
    // of), then the one list on screen that is about no note: the tree. A reader told no note shows none and asks
    // for no page, and the lists about the note it shows have nothing to ask.
    assert_eq!(actions(&asked)[..4], ["ping", "events.subscribe", "screens.list", "lists.read"]);
    assert_eq!(lists(&asked), ["sources", "children"], "what a list can be of, and the tree: nothing about a note nobody opened");
    assert_eq!(actions(&asked).iter().filter(|a| *a == "notes.page").count(), 0, "no page is asked: the outline's first note is not shown in a reader told none");
    // The window registers as itself, for the acts of the scripts it starts and what the service asks of a draft it
    // holds, and nothing else of the event feed.
    let hello = asked.borrow()[1].clone();
    assert_eq!((hello["client"]["app"].as_str(), hello["client"]["clientId"].as_str(), &hello["kinds"]), (Some("native"), Some(app.store().client()), &serde_json::json!(["scripts.act", "scripts.ended", "draft.read", "draft.patch", "draft.revert", "draft.place"])));
    assert_eq!((app.at.outline.as_str(), app.machine.as_str()), ("garden", "box"));
    assert_eq!((app.screen.name.as_str(), app.steps.len(), app.journal.len()), ("desk", 0, 0), "it opened on the screen whose spec says windows start there: nobody's act, and nothing to undo");
    // What the reader draws and what the layout's rules read of it are one answer: no note.
    let reader = app.reader().expect("the desk has a reader");
    assert_eq!((app.subject(), app.page().is_some(), app.facts(&reader).showing), (None, false, None));
    assert_eq!(listed(&app), [(0, "Plot".to_string()), (0, "Shed".to_string())], "only the top level was asked for");
    // The plot opened, as a press on its row opens it: its page is asked once, though three tiles are about that note.
    assert!(act(&mut app, "open id=plot").ok);
    assert_eq!(lists(&asked), ["sources", "children", "properties", "links", "threads"], "the lists about the open note that are on screen, once there is one (a hidden tab asks nothing)");
    assert_eq!(actions(&asked).iter().filter(|a| *a == "notes.page").count(), 1, "the page is asked once");
    assert_eq!((app.page().unwrap().title.as_str(), app.facts(&reader).showing.as_deref()), ("Plot", Some("plot")));
    // Every read names the outline and is watched under a key of its own; a list is asked by what its source says it reads.
    let reads = asked.borrow();
    let tree = reads.iter().find(|a| a["from"] == "children").unwrap();
    let page = reads.iter().find(|a| a["action"] == "notes.page").unwrap();
    assert_eq!((tree["outline"].as_str(), &tree["open"], tree.get("of"), page["blockId"].as_str()), (Some("garden"), &json!([]), None, Some("plot")));
    assert_ne!(tree["watch"].as_str().expect("the tree is watched"), page["watch"].as_str().expect("the page is watched"));
    let about = reads.iter().find(|a| a["from"] == "links").unwrap();
    assert_eq!((about["of"].as_str(), about.get("query"), about.get("source")), (Some("plot"), None, None), "the links of the note the reader shows: only what the source reads is sent");
}

#[test]
fn a_host_on_another_protocol_is_refused_naming_the_side_to_update() {
    let (asked, said): (Asked, Said) = Default::default();
    let answers: Answers = Box::new(|_| Ok(json!({ "protocolVersion": PROTOCOL - 1 })));
    let mut app = App::new(Box::new(Standin { answers, asked, said }), "garden");
    app.start();
    app.take();
    assert!(!app.online);
    assert!(problem(&app, "the outline host is older") && problem(&app, "ep0ch install --apply"), "{:?}", app.notice);
}

#[test]
fn opening_a_note_unfolds_the_way_to_it_from_the_page_s_ancestors() {
    let Garden { mut app, asked, said, .. } = garden(ok());
    act(&mut app, "open id=fork");
    let names = |app: &App| listed(app).into_iter().map(|(depth, title)| format!("{depth} {title}")).collect::<Vec<_>>();
    assert_eq!(names(&app), ["0 Plot", "1 Lift the onions", "2 Take the fork", "1 Water the beans", "0 Shed"]);
    let trees: Vec<Value> = asked.borrow().iter().filter(|a| a["from"] == "children").map(|a| a["open"].clone()).collect();
    assert_eq!(trees, [json!([]), json!(["onions", "plot"])], "the tree as it opened, then once more with the two folders above the note open: one list, not a read a folder");
    // Folding by hand holds: a later answer for the same note doesn't unfold it again.
    act(&mut app, "tree.fold id=plot");
    assert_eq!(names(&app), ["0 Plot", "0 Shed"]);
    changed(&mut app, &said, &page_key(&asked, "fork"), 1);
    assert_eq!(names(&app), ["0 Plot", "0 Shed"]);
    act(&mut app, "back");
    assert_eq!(open_note(&app).as_deref(), Some("plot"));
    assert!(app.ui("reader").history.is_empty(), "going back isn't itself a place to go back from");
}

#[test]
fn an_answer_only_lands_in_the_slot_of_its_own_ask() {
    let Garden { mut app, said, .. } = garden(ok());
    // Two notes opened before either answers, and the answers come the other way round: each has its own slot.
    let held: Vec<Value> = { app.act("open id=onions", Actor::Person); app.act("open id=shed", Actor::Person); said.borrow_mut().drain(..).collect() };
    for line in held.into_iter().rev() { said.borrow_mut().push_back(line) }
    app.settle();
    assert_eq!(app.page().unwrap().id, "shed");
    // The same for the bar: words typed on before the first answer came.
    app.act("bar.open scope=search query=on", Actor::Person);
    app.field(&Field::Bar).replace("onions");
    app.typed(&Field::Bar);
    app.settle();
    assert_eq!(bar::rows(&app)[0].label, "found for onions");
}

#[test]
fn a_watched_answer_that_moved_is_read_by_its_generation_and_nothing_else_is_asked() {
    let Garden { mut app, asked, said, .. } = garden(ok());
    let before = asked.borrow().len();
    let page = page_key(&asked, "plot");
    changed(&mut app, &said, &page, 4);
    assert_eq!(asked.borrow().len(), before + 1);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["watch"].as_str(), last(&asked)["generation"].as_u64()), (Some("notes.page"), Some(page.as_str()), Some(4)));
    changed(&mut app, &said, &tree_key(&asked, &[]), 2);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["generation"].as_u64(), last(&asked)["from"].as_str()), (Some("lists.read"), Some(2), Some("children")));
    // A folder folded since: the tree with it open isn't shown, so its change is nothing to read until it is shown again.
    act(&mut app, "tree.fold id=plot open=true");
    let plot = tree_key(&asked, &["plot"]);
    act(&mut app, "tree.fold id=plot open=false");
    let quiet = asked.borrow().len();
    changed(&mut app, &said, &plot, 1);
    assert_eq!(asked.borrow().len(), quiet);
    act(&mut app, "tree.fold id=plot open=true");
    assert_eq!((asked.borrow().len(), last(&asked)["watch"].as_str(), last(&asked)["generation"].as_u64()), (quiet + 1, Some(plot.as_str()), Some(1)), "unfolded again, it is read by the generation it moved to");
    // One the host dropped past its bounds is registered again, not read by a generation it no longer keeps.
    host_says(&mut app, &said, json!({ "event": { "action": "queries.changed", "changes": [{ "key": page, "generation": 4, "dropped": true }] } }));
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["watch"].is_string(), last(&asked).get("generation")), (Some("notes.page"), true, None));
}

#[test]
fn saving_names_the_revision_read_and_never_ends_editing() {
    let Garden { mut app, asked, .. } = garden(ok());
    act(&mut app, "open id=onions");
    act(&mut app, "edit");
    assert!(!unsaved(&app));
    write(&mut app, "Lift the onions [type::chore]\nTake the fork.");
    app.act("edit.save", Actor::Person);
    let sent = last(&asked);
    assert_eq!((sent["action"].as_str(), sent["expectedRevision"].as_u64(), sent["text"].as_str(), sent["mutation"]["author"].as_str(), sent["mutation"]["actorId"].as_str()),
        (Some("update"), Some(3), Some("Lift the onions [type::chore]\nTake the fork."), Some("user"), Some("ep0ch-native:box")));
    assert!(app.saving());
    // Typed on while the save is out, and after it lands: the editor is still there for every key.
    write(&mut app, "Lift the onions [type::chore]\nTake the fork. And the trug.");
    app.settle();
    let editing = draft(&app).expect("a save doesn't close the editor");
    assert_eq!((editing.revision, unsaved(&app), app.saving()), (4, true, false));
    // After its own write the page is read now, unwatched: the kept answer is the one from before the write.
    let read = asked.borrow().iter().rev().find(|a| a["action"] == "notes.page").cloned().unwrap();
    assert_eq!((read.get("watch"), app.page().unwrap().revision), (None, 4));
    // The next save names the new revision.
    app.act("edit.save", Actor::Person);
    assert_eq!(last(&asked)["expectedRevision"].as_u64(), Some(4));
    app.settle();
    assert!(!unsaved(&app));
    assert!(act(&mut app, "edit.close").ok);
    assert!(draft(&app).is_none());
}

/// Capture comes before interpretation: what is typed is what is sent, whatever it refers to. A reference that
/// names nothing, one left unclosed and a property nobody has written are the service's to say of afterwards; the
/// window asks nothing about them first, and the save is the one request it makes.
#[test]
fn a_save_never_waits_on_a_reference_resolving() {
    let Garden { mut app, asked, .. } = garden(ok());
    act(&mut app, "open id=onions");
    act(&mut app, "edit");
    let typed = "Lift the onions [type::chore] [frost::\nSee ((no-such-bed)) and [[A page nobody wrote]] and ((left open";
    write(&mut app, typed);
    let before = asked.borrow().len();
    assert!(act(&mut app, "edit.save").ok);
    let sent: Vec<Value> = asked.borrow()[before..].iter().filter(|a| !["notes.page", "lists.read", "drafts.heartbeat"].contains(&a["action"].as_str().unwrap())).cloned().collect();
    assert_eq!(sent.iter().map(|a| a["action"].as_str().unwrap()).collect::<Vec<_>>(), ["update"], "the save is the only thing asked: nothing is resolved first");
    assert_eq!(sent[0]["text"], typed);
    assert!(info(&app, "Saved") && !unsaved(&app) && draft(&app).is_some());
}

#[test]
fn nothing_drops_unsaved_text_but_discard() {
    let saves = ok();
    let Garden { mut app, .. } = garden(saves.clone());
    act(&mut app, "open id=onions");
    act(&mut app, "edit");
    write(&mut app, "Mine, typed for a while");
    // The service refuses the save: the text stays, and the notice says what to do.
    *saves.borrow_mut() = Err(("stale-revision", "Block changed since editing began: onions".into()));
    act(&mut app, "edit.save");
    assert!(problem(&app, "changed since you opened it"));
    assert_eq!((words(&app), app.saving()), ("Mine, typed for a while", false));
    // Leaving doesn't drop it, and neither does going back or the Trash.
    assert!(!act(&mut app, "edit.close").ok);
    assert!(draft(&app).is_some() && problem(&app, "Unsaved text"));
    for line in ["back", "note.trash"] {
        assert!(!act(&mut app, line).ok, "{line} is refused over unsaved text");
        assert_eq!((open_note(&app).as_deref(), words(&app)), (Some("onions"), "Mine, typed for a while"), "after {line}");
    }
    // Opening another note doesn't either: the layout opens it in a reader of its own beside the one the block is
    // being written in (the door's rule for a tile that holds an edit), and the draft stays where it is.
    // The keys stay where the person types. The reader opened beside it takes the next open aimed there too (what
    // placement remembers, the door's `PlacementMemory`): one reader beside the draft, not one more an open, and
    // the note it showed before is a step back in it.
    for line in ["open id=shed", "link.follow ref=ep0ch:b/beans tile=reader"] {
        assert!(act(&mut app, line).ok, "{line} opens beside the draft");
        assert_eq!((app.layout.name(&app.layout.focus).as_str(), draft(&app).map(|d| (d.tile.as_str(), d.note.as_str())), words(&app)), ("reader", Some(("reader", "onions")), "Mine, typed for a while"), "after {line}");
        assert_eq!(app.note_of("reader").as_deref(), Some("onions"), "the draft's reader still shows its note");
    }
    assert_eq!((app.note_of("reader2").as_deref(), app.layout.named("reader3")), (Some("beans"), None), "the reader beside the draft took the second open, and no third reader was made");
    assert_eq!(app.memory.beside, [("reader".to_string(), "reader2".to_string())], "opens from the reader a block is written in go beside it, in reader2");
    assert_eq!(app.ui("reader2").history.last().map(String::as_str), Some("shed"), "the note it showed is the way back in it");
    // A new note is a block of its own, written in a tile of its own: the first draft is as it was, beside it.
    assert!(act(&mut app, "note.new").ok);
    assert_eq!((app.drafts.len(), words(&app), app.drafts[1].note.as_str()), (2, "Mine, typed for a while", "new"));
    assert_ne!(app.drafts[1].tile, app.drafts[0].tile, "each block is written in its own tile");
    let beside = app.layout.name(&app.drafts[1].tile);
    assert!(act(&mut app, &format!("edit.close tile={beside}")).ok, "the new note's draft holds nothing unsaved: it closes");
    // Only Discard, asked for by name.
    assert!(act(&mut app, "edit.close discard=true").ok);
    assert!(draft(&app).is_none());
}

#[test]
fn a_new_note_opens_to_be_written_at_the_revision_the_service_made_it_at() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.act("note.new", Actor::Person);
    let made = asked.borrow().iter().rev().find(|a| a["action"] == "create").cloned().expect("a create was sent");
    assert_eq!((made["parentId"].as_str(), made["author"].as_str(), made.get("mutation"), made.get("provenance")), (Some("plot"), Some("user"), None, None));
    app.settle();
    let editing = draft(&app).unwrap();
    assert_eq!((editing.note.as_str(), editing.revision), ("new", 7));
    assert_eq!(open_note(&app).as_deref(), Some("new"));
    // The tree that shows the folder it went into is read again now, with that folder open.
    assert!(asked.borrow().iter().any(|a| a["from"] == "children" && a["open"] == json!(["plot"]) && a.get("watch").is_none()));
}

#[test]
fn a_binned_note_s_notice_carries_the_act_line_that_brings_it_back() {
    let Garden { mut app, asked, .. } = garden(ok());
    act(&mut app, "open id=onions");
    act(&mut app, "note.trash");
    let undo = app.notice.as_ref().and_then(|n| n.undo.clone()).expect("the notice knows what to bring back");
    assert_eq!(undo, "note.untrash id=onions");
    assert_eq!(open_note(&app).as_deref(), Some("plot"), "the window moves to the note above");
    app.act(&undo, Actor::Person);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["blockId"].as_str()), (Some("trash.restore"), Some("onions")));
    app.settle();
    assert_eq!(open_note(&app).as_deref(), Some("onions"));
    // With nothing named it is the note this actor trashed last.
    act(&mut app, "note.trash");
    app.act("note.untrash", Actor::Person);
    assert_eq!(last(&asked)["blockId"].as_str(), Some("onions"));
}

#[test]
fn a_query_is_a_watched_read_its_facets_narrow_it_and_a_refusal_is_the_service_s_words() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.act("bar.open scope=query query=type=chore", Actor::Person);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["from"].as_str(), last(&asked)["watch"].is_string(), last(&asked)["query"].as_str()), (Some("lists.read"), Some("query"), true, Some("type=chore")));
    app.settle();
    // The rows are the service's, each with the act line a pick runs: the bar maps nothing.
    let rows = bar::rows(&app);
    assert_eq!((rows[0].source.as_str(), rows[0].label.as_str(), rows[0].detail.as_str(), rows[0].line.as_str(), bar::facets(&app)[0].key.as_str()), ("query", "Water the beans", "2026-03-01", "open id=\"beans\"", "area"));
    app.act("bar.narrow key=area value=plot", Actor::Person);
    assert_eq!(last(&asked)["query"], "type=chore area=plot");
    app.act("bar.narrow key=area value=plot", Actor::Person);
    assert_eq!(app.bar.edit.words(), "type=chore area=plot", "picked twice is still once");
    app.field(&Field::Bar).replace("type!=chore");
    app.typed(&Field::Bar);
    app.settle();
    assert_eq!(bar::hint(&app).as_deref(), Some("There is no != ; put NOT before the clause."));
    assert!(app.notice.is_none(), "said where the rows would be, not as a window-wide problem");
}

#[test]
fn a_link_in_prose_opens_its_note_and_a_page_nobody_made_says_so() {
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "link.follow ref=ep0ch:b/shed");
    assert_eq!(app.page().unwrap().id, "shed");
    act(&mut app, "link.follow ref=ep0ch:p/Seed%20list");
    assert!(info(&app, "No note has that page address yet"));
    assert_eq!(open_note(&app).as_deref(), Some("shed"));
}

#[test]
fn a_lost_link_is_made_again_and_everything_wanted_is_asked_for_afresh() {
    let Garden { mut app, said, .. } = garden(ok());
    act(&mut app, "open id=fork");
    host_says(&mut app, &said, crate::client::lost("the outline host closed the connection"));
    assert!(!app.online && problem(&app, "the outline host closed the connection"));
    // The link made again is another garden's: what it is asked is everything this window wants, from nothing.
    let Garden { asked, said, .. } = garden(ok());
    asked.borrow_mut().clear();
    let fresh = RefCell::new(Some((asked.clone(), said)));
    let mut app = app.reaching(std::rc::Rc::new(move |_: &crate::store::OutlineAt| {
        let (asked, said) = fresh.borrow_mut().take().expect("made once");
        Ok(crate::client::Way { link: Box::new(Standin { answers: Box::new(|ask| if ask["action"] == "ping" { Ok(json!({ "protocolVersion": PROTOCOL, "location": { "machine": "box" } })) } else { Err(("unavailable", "still starting".into())) }), asked, said }), kept: None })
    }));
    assert!(app.reconnect());
    assert!(app.online && info(&app, "Back online."));
    let again = actions(&asked);
    assert_eq!(again[0], "ping");
    assert_eq!(asked.borrow().iter().filter(|a| a["from"] == "children").map(|a| a["open"].clone()).collect::<Vec<_>>(), [json!(["onions", "plot"])], "the tree, with both folders it had open: {again:?}");
    assert!(again.contains(&"notes.page".to_string()) && again.contains(&"screens.list".to_string()));
    // What the window showed stays shown while the host that came back isn't answering yet.
    app.settle();
    assert_eq!((app.page().map(|p| p.id.as_str()), listed(&app).len()), (Some("fork"), 5));
}

#[test]
fn a_page_s_pictures_are_asked_of_the_host_once_and_kept_decoded_behind_it() {
    let Garden { app, asked, said, .. } = garden(ok());
    let mut app = app.blocking(true);
    act(&mut app, "open id=shed");
    let read: Vec<String> = asked.borrow().iter().filter(|a| a["action"] == "media.read").map(|a| a["path"].as_str().unwrap().to_string()).collect();
    assert_eq!(read, ["pictures/banner.svg", "pictures/beds.svg", "pictures/missing.png"], "each file once; the fence's picture is its own text and asks nothing");
    let page = app.page().unwrap().clone();
    let shown: Vec<bool> = page.pictures().iter().map(|p| matches!(app.picture(p), Some(Shown::Ready { image, .. }) if image.size().is_some())).collect();
    assert_eq!(shown, [true, true, true, false], "the header, the file and the fence are decoded; the missing one isn't");
    let missing = page.pictures().last().unwrap();
    assert!(matches!(app.picture(missing), Some(Shown::Failed(why)) if why.contains("isn't on the outline's machine")));
    // The page read again (its watched answer moved) asks for nothing it already holds.
    let before = asked.borrow().len();
    changed(&mut app, &said, &page_key(&asked, "shed"), 1);
    assert!(asked.borrow().len() > before && !asked.borrow()[before..].iter().any(|a| a["action"] == "media.read"));
    // Another note's page: the shed's pictures are behind it, still decoded, and the one that failed is let go.
    act(&mut app, "open id=plot");
    let held: Vec<bool> = page.pictures().iter().map(|p| matches!(app.picture(p), Some(Shown::Ready { image, .. }) if image.size().is_some())).collect();
    assert_eq!(held, [true, true, true, false]);
    assert!(app.picture(missing).is_none(), "a picture that never came is asked for again when its page is back");
    // Back on the shed: its pictures are drawn at once. Nothing decoded is read or decoded again (a 3 MB photo took
    // a moment each time its note was come back to); only the one that failed is asked for once more.
    let before = asked.borrow().len();
    act(&mut app, "back");
    assert_eq!(app.page().map(|p| p.id.as_str()), Some("shed"));
    let again: Vec<String> = asked.borrow()[before..].iter().filter(|a| a["action"] == "media.read").map(|a| a["path"].as_str().unwrap().to_string()).collect();
    assert_eq!(again, ["pictures/missing.png"]);
    let shown: Vec<bool> = page.pictures().iter().map(|p| matches!(app.picture(p), Some(Shown::Ready { image, .. }) if image.size().is_some())).collect();
    assert_eq!(shown, [true, true, true, false]);
}

/// How many pictures stay decoded behind the pages shown is bounded: the ones let go last are the ones kept.
#[test]
fn the_pictures_kept_behind_the_pages_shown_are_the_last_few_let_go() {
    use crate::tiles::picture::Pictures;
    use std::collections::HashSet;
    let svg = |n: usize| format!("<svg xmlns='http://www.w3.org/2000/svg' width='{0}' height='{0}'><rect width='{0}' height='{0}'/></svg>", 8 + n).into_bytes();
    let mut pictures = Pictures::default();
    let shown = |keys: &[usize]| keys.iter().map(|n| format!("bed-{n}.svg")).collect::<HashSet<String>>();
    // Twelve pages come and go, a picture each.
    for n in 0..12 {
        pictures.decode(format!("bed-{n}.svg"), svg(n), "image/svg+xml", true);
        pictures.keep(&shown(&[n]));
    }
    let held: Vec<usize> = (0..12).filter(|n| pictures.holds(&format!("bed-{n}.svg"))).collect();
    assert_eq!(held, [3, 4, 5, 6, 7, 8, 9, 10, 11], "the one shown, and the eight let go last");
    // One shown again is no longer behind, and its place is nobody's until another is let go.
    pictures.keep(&shown(&[5]));
    assert!((3..12).all(|n| pictures.holds(&format!("bed-{n}.svg"))));
    pictures.keep(&shown(&[0]));
    assert!(pictures.holds("bed-5.svg") && !pictures.holds("bed-3.svg"), "the oldest behind goes first");
    // A picture asked for and never come, and one that failed, are not kept behind.
    pictures.asked("bed-90.svg".into());
    pictures.failed("bed-91.svg".into(), "it isn't on the outline's machine".into());
    pictures.keep(&shown(&[0]));
    assert!(!pictures.holds("bed-90.svg") && !pictures.holds("bed-91.svg"));
}

#[test]
fn an_act_line_that_does_not_read_is_refused_in_words_and_recorded() {
    let Garden { mut app, asked, .. } = garden(ok());
    let before = asked.borrow().len();
    for (line, why) in [
        ("", "act needs an action name"),
        ("note.bin", "no action named note.bin · `actions` lists them"),
        ("note.trsh", "no action named note.trsh; did you mean note.trash?"),
        ("note.move", "Missing required `step`"),
        ("note.move step=sideways", "note.move: step is up, down, in, out, not sideways."),
        ("open id=shed tile=attic", "no tile attic here"),
        // A row declares only the arguments its action reads: a press on a tree row opens, and nothing unsays that.
        ("tree.pick id=shed open=false", "`open` is not an argument of tree.pick"),
    ] {
        let outcome = act(&mut app, line);
        assert!(!outcome.ok && outcome.said.contains(why) && outcome.kind == Some("invalid"), "{line:?}: {outcome:?}");
        let step = app.steps.last().unwrap();
        assert_eq!((step.ok, step.said.as_str(), &step.by), (false, outcome.said.as_str(), &Actor::Person));
    }
    assert_eq!(asked.borrow().len(), before, "nothing was asked of the host");
    assert!(act(&mut app, "open id=shed tile=reader").ok && act(&mut app, "open id=plot tile=role:reader").ok, "the reader is the one tile, by name or by role");
}

/// An agent's `bar.open` is a question. The actions are this window's own to list; a served source's rows are the
/// service's answer, which an act (answered at once) can't wait for: it answers the rows the store holds with the
/// ask that lists them, so an agent asks the service the same thing, and an empty list never reads as "nothing matches".
#[test]
fn an_agent_s_bar_lists_the_actions_and_says_what_is_the_service_s_to_answer() {
    let Garden { mut app, asked, .. } = garden(ok());
    let agent = || Actor::Agent("compost-agent".into());
    let before = asked.borrow().len();
    for line in ["bar.open query=trash", "bar.open scope=actions query=trash"] {
        let listed = app.act(line, agent());
        assert!(listed.ok, "{line}: {listed:?}");
        assert_eq!((listed.answer["scope"].as_str(), listed.answer["rows"][0]["act"].as_str(), listed.answer["rows"][0]["source"].as_str()), (Some("actions"), Some("note.trash"), Some("actions")), "{line}: the scope answered is the one its rows are from");
    }
    for (line, from, words) in [("bar.open scope=search query=beans", "search", "beans"), ("bar.open scope=query query=type=chore", "query", "type=chore"), ("bar.open scope=screens", "screens", "")] {
        let said = app.act(line, agent());
        assert!(said.ok, "{line}: {said:?}");
        assert_eq!((said.answer["scope"].as_str(), said.answer["answered"].as_bool(), said.answer["rows"].as_array().map(Vec::len)), (Some(from), Some(false), Some(0)), "{line}: the store holds no answer yet, and says so");
        assert_eq!((said.answer["ask"]["action"].as_str(), said.answer["ask"]["from"].as_str(), said.answer["ask"]["query"].as_str()), (Some("lists.read"), Some(from), Some(words)), "{line}: the ask that lists them, for the agent to make of the service");
    }
    assert_eq!((asked.borrow().len(), app.bar.open), (before, false), "nothing was asked of the host and the person's bar is as it was");
    assert!(!app.act("bar.open scope=wheelbarrows", agent()).ok);
    // The person's own bar on the same words is the service's search; an agent asking after it is answered what the store holds.
    act(&mut app, "bar.open scope=search query=beans");
    assert_eq!(bar::rows(&app)[0].label, "found for beans");
    let held = app.act("bar.open scope=search query=beans", agent());
    assert_eq!((held.answer["answered"].as_bool(), held.answer["rows"][0]["label"].as_str(), held.answer["rows"][0]["act"].as_str()), (Some(true), Some("found for beans"), Some("open id=\"beans\"")));
    // The screens are a source like any other: each row is the act line that opens one.
    act(&mut app, "bar.open scope=screens");
    let screens = bar::rows(&app);
    assert!(screens.iter().any(|row| row.source == "screens" && row.line.starts_with("screen.open name=")), "{screens:?}");
    let other = screens.iter().find(|row| row.key != app.screen.name).unwrap().key.clone();
    assert!(act(&mut app, &format!("bar.pick source=screens key={other}")).ok);
    assert_ne!(app.screen.name, "desk", "a screen picked in the bar is opened");
}
