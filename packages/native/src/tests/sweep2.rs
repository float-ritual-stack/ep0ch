//! The second hydra sweep, held by what the window does: each test is a failure a second decider caused, pressed
//! through act lines alone, and goes red when one comes back. (`one_owner.rs` scans the source for the same thing;
//! `owners.rs` holds the first sweep's.) Every row a host answers here is as the service answers one.
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App};

fn leaf(kind: &str, name: &str) -> Value { json!({ "t": "leaf", "kind": kind, "name": name }) }
fn with(mut leaf: Value, more: Value) -> Value { for (key, value) in more.as_object().unwrap() { leaf[key] = value.clone() } leaf }
fn agent() -> Actor { Actor::Agent("seedling-agent".into()) }
fn note_in(app: &App, tile: &str) -> Option<String> { app.layout.named(tile).and_then(|id| app.note_of(&id)) }
fn row_of(spec: Value) -> Value {
    let mut row = screen_row("beds", json!(null), json!([]));
    row["spec"] = spec;
    row["spec"]["name"] = json!("beds");
    row["spec"]["title"] = json!("beds");
    row
}

/// A window laid out as the screen `beds`, whose spec is `spec`.
fn laid(spec: Value) -> Garden {
    let mut g = garden(ok());
    screens_are(&mut g, json!([row_of(spec)]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(opened.ok, "{}", opened.said);
    g
}

fn split(kids: Value) -> Value { let n = kids.as_array().unwrap().len(); json!({ "t": "split", "dir": "row", "weights": vec![1.0 / n as f64; n], "kids": kids }) }

/// The newest `lists.read` asked for a source, as the host got it.
fn asked_for(g: &Garden, from: &str) -> Value { g.asked.borrow().iter().rev().find(|a| a["action"] == "lists.read" && a["from"] == from).cloned().unwrap_or_else(|| panic!("no list was asked of {from}")) }

/// A script's act for this window, as the service sends one.
fn call(g: &mut Garden, request: &str, action: &str, args: Value) {
    let client = g.app.store().client().to_string();
    let line = json!({ "event": { "domain": "script", "action": "scripts.act", "script": { "requestId": request, "targetClientId": client, "action": action, "args": args, "actor": { "author": "agent", "actorId": "script:tidy" }, "requestedBy": { "author": "user" } } } });
    host_says(&mut g.app, &g.said, line);
}

// ── how a request is written as an act line: one writer, and a request is never written to be read again ──────────

/// A script's act and a screen's own new-note action are requests already. A backslash in an argument stays in it:
/// neither is written as a line and read back with another value.
#[test]
fn an_argument_with_a_backslash_runs_with_the_value_it_was_given() {
    let mut g = garden(ok());
    call(&mut g, "r1", "bar.open", json!({ "scope": "query", "query": "path=beds\\north" }));
    assert_eq!((g.app.bar.open, g.app.bar.edit.words()), (true, "path=beds\\north"), "a script's act runs with the argument it sent");
    assert_eq!(g.app.steps.last().unwrap().args["query"], "path=beds\\north");
    // The step's own line reads back as the same request.
    let again = crate::actline::parse(&g.app.steps.last().unwrap().line()).unwrap();
    assert_eq!(again.args["query"], "path=beds\\north", "{}", g.app.steps.last().unwrap().line());
    // A screen whose rule for new notes is another action altogether runs it with its arguments as they are.
    let mut g = laid(json!({ "newNote": [{ "action": "bar.open", "args": { "scope": "query", "query": "said=\"late\" path=beds\\north" } }], "layout": { "focus": "bed", "root": leaf("reader", "bed") } }));
    assert!(act(&mut g.app, "note.new").ok);
    assert_eq!(g.app.bar.edit.words(), "said=\"late\" path=beds\\north");
}

// ── which action picks a list's row, and which tile an act is about ─────────────────────────────────────────────────

fn two_trees() -> Garden {
    laid(json!({ "lands": "bed", "layout": { "focus": "rows", "root": split(json!([with(leaf("tree", "beds"), json!({ "wires": [{ "verb": "select", "to": "bed" }] })), with(leaf("tree", "rows"), json!({ "wires": [{ "verb": "select", "to": "bed" }] })), leaf("reader", "bed"), with(leaf("query", "found"), json!({ "query": "type=chore" }))])) } }))
}

/// One pick, whatever the list: a row the list doesn't hold is refused to anyone, a tile named that is no tree is
/// refused and never swapped for another, and the open note's row folds under the door's name and the list's alike.
#[test]
fn a_pick_in_a_tree_is_the_one_pick_of_a_row() {
    let mut g = two_trees();
    let before = note_in(&g.app, "bed");
    let lacks = g.app.act("tree.pick id=fork", agent());
    assert!(!lacks.ok && lacks.said.contains("lists no such row"), "a row the tree doesn't list is no pick: {}", lacks.said);
    assert_eq!(note_in(&g.app, "bed"), before, "and nothing opened");
    // A list that is no tree, named: refused, saying so, and no other tree is picked in.
    let wrong = act(&mut g.app, "tree.pick id=beans tile=found");
    assert!(!wrong.ok && wrong.said.contains("found is no tree"), "{}", wrong.said);
    assert_eq!(note_in(&g.app, "bed"), before);
    // The person's pick of a folder opens it and unfolds it; picked again while it is the open note, it folds: by
    // either name, in the tree it was picked in.
    let rows = g.app.layout.named("rows").unwrap();
    assert!(act(&mut g.app, "list.pick id=plot tile=rows").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), g.app.ui(&rows).unfolded.contains("plot")), (Some("plot"), true), "a pick by the list's name opens the folder and unfolds it");
    assert!(act(&mut g.app, "tree.pick id=plot tile=rows").ok);
    assert!(!g.app.ui(&rows).unfolded.contains("plot"), "picked again by the door's name, it folds");
    assert!(act(&mut g.app, "list.pick id=plot tile=rows").ok);
    assert!(g.app.ui(&rows).unfolded.contains("plot"), "and again by the list's, it unfolds");
    // An agent's pick runs the row's act line as itself and folds nothing.
    let unfolded = g.app.ui(&rows).unfolded.clone();
    let theirs = g.app.act("tree.pick id=shed tile=rows", agent());
    assert!(theirs.ok, "{}", theirs.said);
    assert_eq!(g.app.ui(&rows).unfolded, unfolded);
}

/// With two trees, an act about "the tree" that names none is about the one with the keys, as an act about a list
/// is: never the first the layout happens to list.
#[test]
fn an_act_that_names_no_tile_is_about_the_one_with_the_keys_whatever_the_noun() {
    let mut g = two_trees();
    let (beds, rows) = (g.app.layout.named("beds").unwrap(), g.app.layout.named("rows").unwrap());
    assert_eq!(g.app.layout.name(&g.app.layout.focus), "rows");
    assert!(act(&mut g.app, "tree.fold id=plot open=true").ok);
    assert_eq!((g.app.ui(&beds).unfolded.contains("plot"), g.app.ui(&rows).unfolded.contains("plot")), (false, true), "the tree with the keys unfolds, not the first tree");
    // An agent's is the same act: the tree the person is in, as `list.sort` would be about it.
    assert!(g.app.act("tree.fold id=plot open=false", agent()).ok);
    assert_eq!((g.app.ui(&beds).unfolded.contains("plot"), g.app.ui(&rows).unfolded.contains("plot")), (false, false));
    // With the keys on a tile that is no tree, it is the first tree: said nowhere else than in the one rule.
    assert!(act(&mut g.app, "tile.focus tile=bed").ok && act(&mut g.app, "tree.fold id=plot open=true").ok);
    assert!(g.app.ui(&beds).unfolded.contains("plot"));
    // A tile named that is not of the sort is refused by every noun, in one sentence.
    for (line, sort) in [("list.sort by=crop tile=bed", "bed is no list"), ("tree.fold id=plot tile=found", "found is no tree"), ("back tile=beds", "beds is no tile that reads notes"), ("button.press label=Sow tile=found", "found is no tile that reads notes")] {
        let refused = act(&mut g.app, line);
        assert!(!refused.ok && refused.said.contains(sort), "{line}: {}", refused.said);
    }
}

// ── where a screen's `lands` points: one reading, for an agent's open, the person's and the reader an act means ─────

/// `lands` naming a container: an agent's open goes into it (the layout's rule), and so does the person's open
/// from a list that names no tile of its own, and the reader an act about the open note means is the one in it.
#[test]
fn lands_naming_a_container_is_where_every_open_and_every_act_about_the_open_note_goes() {
    let layout = json!({ "focus": "beds", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "almanac"), { "t": "columns", "key": "readers", "weights": [1], "kids": [leaf("reader", "bed")] }] } });
    let mut g = laid(json!({ "lands": "readers", "layout": layout }));
    assert_eq!(g.app.reader().map(|id| g.app.layout.name(&id)).as_deref(), Some("bed"), "the reader an act means is where the screen says opens land");
    let theirs = g.app.act("open id=shed", agent());
    assert_eq!((theirs.ok, theirs.answer["tile"].as_str()), (true, Some("bed")), "{}", theirs.said);
    let mine = act(&mut g.app, "open id=beans tile=beds");
    assert_eq!((mine.ok, mine.answer["tile"].as_str()), (true, Some("bed")), "the person's open from the tree lands there too: {}", mine.said);
    assert_eq!((note_in(&g.app, "almanac").as_deref(), note_in(&g.app, "bed").as_deref()), (Some("plot"), Some("beans")), "the first reader of the screen is left as it was");
}

// ── which new-note rule applies: asked once, with the kind the tile is ───────────────────────────────────────────────

/// A reader the person split off here is the same kind as the one the screen came with: the screen's rule for new
/// notes made in a reader holds for both. (The rule's kinds are the service's, resolved as a tile's are.)
#[test]
fn a_new_note_rule_holds_for_a_tile_made_here_as_for_one_the_screen_came_with() {
    let rules = json!([{ "opens": "tab", "only": ["screens.reader"] }, { "opens": "lands" }]);
    let mut g = laid(json!({ "lands": "bed", "newNote": rules, "layout": { "focus": "bed", "root": split(json!([leaf("screens.tree", "beds"), leaf("screens.reader", "bed")])) } }));
    assert!(act(&mut g.app, "tile.split tile=bed name=seeds").ok && act(&mut g.app, "tile.focus tile=seeds").ok);
    assert!(act(&mut g.app, "note.new").ok);
    let made = g.app.editing.as_ref().map(|e| e.tile.clone()).expect("the new note is open to be written");
    let tabs = |tile: &str| crate::layout::tree::tabs_of(g.app.layout.tree(), tile);
    assert!(tabs(&made).is_some() && tabs(&made) == tabs(&g.app.layout.named("seeds").unwrap()), "a tab on the reader it was made in, as the rule for a reader says: {:?}", g.app.layout.save());
    assert_eq!(note_in(&g.app, "bed").as_deref(), Some("plot"), "and not where the screen's opens land, which is the rule for every other kind");
}

// ── what a follower's subject is when unsaid ─────────────────────────────────────────────────────────────────────────

/// A tile that names its home and says nothing of its subject keeps the note it first listed, as it does in the
/// door; one that says its subject follows lists whatever its home shows now.
#[test]
fn a_tile_that_names_its_home_keeps_its_subject_unless_it_says_it_follows() {
    let held = with(leaf("backlinks", "held"), json!({ "source": "tile:bed" }));
    let follows = with(leaf("backlinks", "follows"), json!({ "source": "tile:bed", "subject": "follows" }));
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), held, follows])) } }));
    let of = |g: &Garden, tile: &str| { let id = g.app.layout.named(tile).unwrap(); g.app.list_ask(&id).map(|ask| ask.params["of"].clone()) };
    assert!(act(&mut g.app, "open id=plot").ok);
    assert_eq!((of(&g, "held"), of(&g, "follows")), (Some(json!("plot")), Some(json!("plot"))), "both list the note their home shows when they first list");
    assert!(act(&mut g.app, "open id=shed").ok);
    assert_eq!(note_in(&g.app, "bed").as_deref(), Some("shed"));
    assert_eq!((of(&g, "held"), of(&g, "follows")), (Some(json!("plot")), Some(json!("shed"))), "the one that says it follows moves on; the other keeps its subject");
}

// ── what a list is asked for: a tile's and the bar's, by one fill ─────────────────────────────────────────────────────

/// A list is asked the parameters its source says it reads, whoever asks: a tile over the screens is told which
/// drawers this window has (as the bar's is), and the bar's question is asked nothing its source doesn't read.
#[test]
fn a_tile_and_the_bar_ask_a_source_the_parameters_it_says_it_reads() {
    let mut g = laid(json!({ "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), with(leaf("who", "screens"), json!({ "from": "screens" }))])) } }));
    let tile = asked_for(&g, "screens");
    assert_eq!(tile["drawers"], json!(crate::tiles::drawers()), "a tile over the screens says which drawers the window has: {tile}");
    assert!(act(&mut g.app, "bar.open scope=screens").ok);
    let bar = asked_for(&g, "screens");
    assert_eq!((bar["drawers"].clone(), bar["query"].as_str()), (json!(crate::tiles::drawers()), Some("")), "{bar}");
    assert!(act(&mut g.app, "bar.open scope=search query=beans").ok);
    let search = asked_for(&g, "search");
    assert!(search.get("drawers").is_none() && search.get("kinds").is_none(), "the search reads its words and nothing of the window: {search}");
}

// ── what a facet pick adds to a question ──────────────────────────────────────────────────────────────────────────────

/// Two values picked of one property are either of them, as the door's facets write a selection (outline-core's
/// `selectionQuery`); a question with connectives of its own is grouped before a pick follows it.
#[test]
fn values_picked_of_one_property_are_any_of_them_and_a_typed_question_keeps_its_own_grouping() {
    let mut g = laid(json!({ "layout": { "focus": "found", "root": split(json!([leaf("reader", "bed"), with(leaf("query", "found"), json!({ "query": "type=chore OR type=bed" }))])) } }));
    let found = g.app.layout.named("found").unwrap();
    assert!(act(&mut g.app, "facets.set key=area value=plot").ok && act(&mut g.app, "facets.set key=area value=bed").ok && act(&mut g.app, "facets.set key=crop value=\"runner beans\"").ok);
    assert_eq!(g.app.question_of(&found), "(type=chore OR type=bed) (area=plot OR area=bed) crop=\"runner beans\"");
    assert_eq!(asked_for(&g, "query")["query"], "(type=chore OR type=bed) (area=plot OR area=bed) crop=\"runner beans\"");
    // The bar's question is narrowed by the same writer.
    assert!(act(&mut g.app, "bar.open scope=query query=\"type=bed OR type=row\"").ok && act(&mut g.app, "bar.narrow key=stage value=sown").ok);
    assert_eq!(g.app.bar.edit.words(), "(type=bed OR type=row) stage=sown");
}

// ── what a screen is while it is open ──────────────────────────────────────────────────────────────────────────────────

/// What a screen says of itself is the service's row, read while it is open: a screen note whose `lands`, toolbar
/// or rule changed is followed at once, the change is said, and the file the arrangement is kept in holds no copy
/// of the spec to fall behind.
#[test]
fn what_an_open_screen_says_of_itself_is_the_service_s_row_and_the_file_keeps_no_copy() {
    let root = split(json!([leaf("tree", "beds"), leaf("reader", "bed"), leaf("reader", "seeds")]));
    let file = std::env::temp_dir().join(format!("ep0ch-native-sweep2-{}.layout.json", std::process::id()));
    let _ = std::fs::remove_file(&file);
    let mut g = garden(ok());
    g.app = std::mem::replace(&mut g.app, App::new(Box::new(Standin { answers: Box::new(|_| Err(("failed", "gone".into()))), asked: Default::default(), said: Default::default() }), "garden")).arranged_in(file.clone());
    screens_are(&mut g, json!([row_of(json!({ "lands": "bed", "toolbar": ["back"], "layout": { "focus": "beds", "root": root } }))]));
    assert!(act(&mut g.app, "screen.open name=beds").ok);
    assert_eq!(g.app.act("open id=shed", agent()).answer["tile"], "bed");
    // Someone edits the screen note: opens land in the other reader now, and its toolbar gained a button.
    let mut moved = row_of(json!({ "lands": "seeds", "toolbar": ["back", "note.new"], "layout": { "focus": "beds", "root": root } }));
    moved["note"]["revision"] = json!(3);
    screens_are(&mut g, json!([moved]));
    assert_eq!(g.app.act("open id=beans", agent()).answer["tile"], "seeds", "an open lands where the screen says now");
    assert!(g.app.notice.as_ref().is_some_and(|notice| notice.said.contains("The screen beds changed in the outline")), "the change is said: {:?}", g.app.notice);
    // The file holds the screen's name and the revision of its note, never its spec.
    let kept: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert_eq!((kept["screen"].as_str(), kept["note"]["revision"].as_u64(), kept.get("spec")), (Some("beds"), Some(3), None), "{kept}");
    let _ = std::fs::remove_file(&file);
}

/// A screen opened on a target carries its words in the tile and field its spec says (outline-core's
/// `targetFilled`, by `Spec::filled`): the argument is the window's one `target=`, whatever the spec calls it.
#[test]
fn a_screen_opened_on_a_target_carries_it_in_the_tile_its_spec_says() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([row_of(json!({ "target": { "arg": "query", "fills": "found.query" }, "layout": { "focus": "found", "root": split(json!([leaf("reader", "bed"), { "t": "tabs", "active": 0, "tabs": [leaf("query", "found")] }])) } }))]));
    assert!(act(&mut g.app, "screen.open name=beds target=\"type=chore area=plot\"").ok);
    let found = g.app.layout.named("found").unwrap();
    assert_eq!(g.app.question_of(&found), "type=chore area=plot");
}
