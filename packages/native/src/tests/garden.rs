//! The window over the garden's stand-in host: what it asks, and what it does with the answers. Everything it is
//! told to do is an act line, as a key, a press or an agent would say it; every assertion that can be is on the wire.
use std::cell::RefCell;

use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, Field, Shown, Tone};
use crate::bar;
use crate::client::PROTOCOL;

fn problem(app: &App, words: &str) -> bool { app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains(words)) }
fn info(app: &App, words: &str) -> bool { app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.contains(words)) }
fn page_key(asked: &Asked, note: &str) -> String { watch_of(asked, "notes.page", |a| a["blockId"] == note) }
fn level_key(asked: &Asked, under: Option<&str>) -> String { watch_of(asked, "blocks.read", |a| a["under"].as_str() == under) }

#[test]
fn the_window_opens_on_the_first_note_and_asks_for_no_more_than_it_shows() {
    let Garden { app, asked, .. } = garden(ok());
    assert_eq!(actions(&asked), ["ping", "events.subscribe", "blocks.read", "screens.list", "notes.page"], "who answers and who this window is, then the tree's top level, the outline's screens and the first note's page: asked once, though three tiles show it");
    // The window registers as itself, for the acts of the scripts it starts and nothing else of the event feed.
    let hello = asked.borrow()[1].clone();
    assert_eq!((hello["client"]["app"].as_str(), hello["client"]["clientId"].as_str(), &hello["kinds"]), (Some("native"), Some(app.store().client()), &serde_json::json!(["scripts.act", "scripts.ended"])));
    assert_eq!((app.at.outline.as_str(), app.machine.as_str()), ("garden", "box"));
    assert_eq!(app.page().unwrap().title, "Plot");
    assert_eq!(listed(&app), [(0, "Plot".to_string()), (0, "Shed".to_string())], "only the top level was asked for");
    // Every read names the outline and is watched under a key of its own.
    let reads = asked.borrow();
    assert_eq!((reads[2]["outline"].as_str(), reads[2]["under"].is_null(), reads[4]["blockId"].as_str()), (Some("garden"), true, Some("plot")));
    let (tree, page) = (reads[2]["watch"].as_str().expect("the level is watched"), reads[4]["watch"].as_str().expect("the page is watched"));
    assert_ne!(tree, page);
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
    let levels: Vec<String> = asked.borrow().iter().filter(|a| a["action"] == "blocks.read").map(|a| a["watch"].as_str().unwrap().to_string()).collect();
    assert_eq!(levels.len(), 3, "the top level and the two folders above the note, each asked once: {levels:?}");
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
    app.act("bar.open scope=notes query=on", Actor::Person);
    app.field(Field::Bar).replace_text("onions");
    app.typed(Field::Bar);
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
    changed(&mut app, &said, &level_key(&asked, None), 2);
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["generation"].as_u64(), last(&asked)["under"].is_null()), (Some("blocks.read"), Some(2), true));
    // A folder folded since: its level isn't shown, so its change is nothing to read until it is shown again.
    act(&mut app, "tree.fold id=plot open=true");
    let plot = level_key(&asked, Some("plot"));
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
    assert!(!app.unsaved());
    app.field(Field::Draft).replace_text("Lift the onions [type::chore]\nTake the fork.");
    app.act("edit.save", Actor::Person);
    let sent = last(&asked);
    assert_eq!((sent["action"].as_str(), sent["expectedRevision"].as_u64(), sent["text"].as_str(), sent["mutation"]["author"].as_str(), sent["mutation"]["actorId"].as_str()),
        (Some("update"), Some(3), Some("Lift the onions [type::chore]\nTake the fork."), Some("user"), Some("ep0ch-native:box")));
    assert!(app.saving());
    // Typed on while the save is out, and after it lands: the editor is still there for every key.
    app.field(Field::Draft).replace_text("Lift the onions [type::chore]\nTake the fork. And the trug.");
    app.settle();
    let editing = app.editing.as_ref().expect("a save doesn't close the editor");
    assert_eq!((editing.revision, app.unsaved(), app.saving()), (4, true, false));
    // After its own write the page is read now, unwatched: the kept answer is the one from before the write.
    let read = asked.borrow().iter().rev().find(|a| a["action"] == "notes.page").cloned().unwrap();
    assert_eq!((read.get("watch"), app.page().unwrap().revision), (None, 4));
    // The next save names the new revision.
    app.act("edit.save", Actor::Person);
    assert_eq!(last(&asked)["expectedRevision"].as_u64(), Some(4));
    app.settle();
    assert!(!app.unsaved());
    assert!(act(&mut app, "edit.close").ok);
    assert!(app.editing.is_none());
}

#[test]
fn nothing_drops_unsaved_text_but_discard() {
    let saves = ok();
    let Garden { mut app, .. } = garden(saves.clone());
    act(&mut app, "open id=onions");
    act(&mut app, "edit");
    app.field(Field::Draft).replace_text("Mine, typed for a while");
    // The service refuses the save: the text stays, and the notice says what to do.
    *saves.borrow_mut() = Err(("stale-revision", "Block changed since editing began: onions".into()));
    act(&mut app, "edit.save");
    assert!(problem(&app, "changed since you opened it"));
    assert_eq!((app.editor.text.as_str(), app.saving()), ("Mine, typed for a while", false));
    // Leaving doesn't drop it, and neither does going back, a new note or the Trash.
    assert!(!act(&mut app, "edit.close").ok);
    assert!(app.editing.is_some() && problem(&app, "Unsaved text"));
    for line in ["back", "note.new", "note.trash"] {
        assert!(!act(&mut app, line).ok, "{line} is refused over unsaved text");
        assert_eq!((open_note(&app).as_deref(), app.editor.text.as_str()), (Some("onions"), "Mine, typed for a while"), "after {line}");
    }
    // Opening another note doesn't either: the layout opens it in a reader of its own beside the one that holds the
    // draft (the door's rule for a tile that holds an edit), and the draft stays where it is.
    // The keys stay where the person types.
    for line in ["open id=shed", "link.follow ref=ep0ch:b/beans tile=reader"] {
        assert!(act(&mut app, line).ok, "{line} opens beside the draft");
        assert_eq!((app.layout.name(&app.layout.focus).as_str(), app.editing.as_ref().map(|e| (e.tile.as_str(), e.note.as_str())), app.editor.text.as_str()), ("reader", Some(("reader", "onions")), "Mine, typed for a while"), "after {line}");
        assert_eq!(app.note_of("reader").as_deref(), Some("onions"), "the draft's reader still shows its note");
    }
    assert_eq!((app.note_of("reader2").as_deref(), app.note_of("reader3").as_deref()), (Some("shed"), Some("beans")));
    // Only Discard, asked for by name.
    assert!(act(&mut app, "edit.close discard=true").ok);
    assert!(app.editing.is_none());
}

#[test]
fn a_new_note_opens_to_be_written_at_the_revision_the_service_made_it_at() {
    let Garden { mut app, asked, .. } = garden(ok());
    app.act("note.new", Actor::Person);
    let made = asked.borrow().iter().rev().find(|a| a["action"] == "create").cloned().expect("a create was sent");
    assert_eq!((made["parentId"].as_str(), made["author"].as_str(), made.get("mutation"), made.get("provenance")), (Some("plot"), Some("user"), None, None));
    app.settle();
    let editing = app.editing.as_ref().unwrap();
    assert_eq!((editing.note.as_str(), editing.revision), ("new", 7));
    assert_eq!(open_note(&app).as_deref(), Some("new"));
    // The folder it went into is read again now.
    assert!(asked.borrow().iter().any(|a| a["action"] == "blocks.read" && a["under"] == "plot" && a.get("watch").is_none()));
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
    assert_eq!((last(&asked)["action"].as_str(), last(&asked)["watch"].is_string(), last(&asked)["query"]["where"].as_str()), (Some("blocks.query"), true, Some("type=chore")));
    app.settle();
    let rows = bar::rows(&app);
    assert_eq!((rows[0].label.as_str(), rows[0].detail.as_str(), rows[0].line.as_str(), bar::facets(&app)[0].key.as_str()), ("Water the beans", "2026-03-01", "open id=beans", "area"));
    app.act("bar.narrow key=area value=plot", Actor::Person);
    assert_eq!(last(&asked)["query"]["where"], "type=chore area=plot");
    app.act("bar.narrow key=area value=plot", Actor::Person);
    assert_eq!(app.bar.edit.text, "type=chore area=plot", "picked twice is still once");
    app.field(Field::Bar).replace_text("type!=chore");
    app.typed(Field::Bar);
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
    let mut app = app.reconnecting(Box::new(move || {
        let (asked, said) = fresh.borrow_mut().take().expect("made once");
        Box::new(Standin { answers: Box::new(|ask| if ask["action"] == "ping" { Ok(json!({ "protocolVersion": PROTOCOL, "location": { "machine": "box" } })) } else { Err(("unavailable", "still starting".into())) }), asked, said })
    }));
    assert!(app.reconnect());
    assert!(app.online && info(&app, "Back online."));
    let again = actions(&asked);
    assert_eq!(again[0], "ping");
    assert_eq!(again.iter().filter(|a| *a == "blocks.read").count(), 3, "the top level and both unfolded folders: {again:?}");
    assert!(again.contains(&"notes.page".to_string()));
    // What the window showed stays shown while the host that came back isn't answering yet.
    app.settle();
    assert_eq!((app.page().map(|p| p.id.as_str()), listed(&app).len()), (Some("fork"), 5));
}

#[test]
fn a_page_s_pictures_are_asked_of_the_host_once_and_let_go_with_the_page() {
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
    // Another note's page: the shed's pictures are let go.
    act(&mut app, "open id=plot");
    assert!(page.pictures().iter().all(|p| app.picture(p).is_none()));
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

/// An agent's `bar.open` is a question. The actions are this window's own to list; the notes and a query's matches
/// are the service's answers, which an act (answered at once) can't wait for: said, never an empty list that
/// reads as "nothing matches".
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
    for (line, what) in [("bar.open scope=notes query=beans", "notes"), ("bar.open scope=query query=type=chore", "query")] {
        let refused = app.act(line, agent());
        assert!(!refused.ok && refused.said.contains(&format!("the bar's {what}")) && refused.said.contains("ep0ch find"), "{line}: {refused:?}");
        assert!(refused.answer.is_null(), "no rows are answered, least of all none: {refused:?}");
    }
    assert_eq!((asked.borrow().len(), app.bar.open), (before, false), "nothing was asked of the host and the person's bar is as it was");
    // The person's own bar on the same words is the service's search, as ever.
    act(&mut app, "bar.open scope=notes query=beans");
    assert_eq!(bar::rows(&app)[0].label, "found for beans");
}
