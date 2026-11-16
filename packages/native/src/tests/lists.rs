//! One list, whatever it is of: the window draws what the service answers and decides nothing about it. A board's
//! lanes, a table, facets as chips, a long list built only where it shows, and the screens every door ships opened
//! from the bar's own row. The host is the garden's stand-in, with the screens extension as the service answers it.
use rune::Runtime;
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App};

fn keyed(rt: &Runtime<App>, prefix: &str) -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.key).filter(|key| key.starts_with(prefix)).collect() }
fn names(app: &App) -> Vec<String> { app.layout.all().iter().map(|id| app.layout.name(id)).collect() }
fn asked_lists(asked: &Asked, from: &str) -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == "lists.read" && a["from"] == from).cloned().collect() }

/// The bar's Screens lists the service's screens; a press on a row opens that screen, and its tiles are drawn.
fn open_from_the_bar(rt: &mut Runtime<App>, screen: &str) {
    rt.update(|s, _| { s.act("bar.open scope=screens", Actor::Person); });
    rest(rt);
    press(rt, &format!("bar/row/screens/{screen}"));
    assert_eq!((rt.state.screen.name.as_str(), rt.state.bar.open), (screen, false), "{screen} opened from its row, and the bar is put away");
}

#[test]
fn the_board_opens_from_the_bar_as_lanes_grouped_by_a_property_name_and_a_card_opens_beside() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    open_from_the_bar(&mut rt, "board");
    assert_eq!(names(&rt.state), ["lanes", "reader"]);
    // The lanes are asked as the screen's tile says: its source from its kind's row, its question, group and
    // arrangement from its spec, all by name.
    let ask = asked_lists(&asked, "query").pop().expect("the lanes were asked for");
    assert_eq!((ask["group"].as_str(), ask["arrange"].as_str(), ask["sort"].as_str(), ask["query"].as_str()), (Some("work-stage"), Some("lanes"), Some("updated desc"), Some("work-stage")));
    // Grouped by another property, by its name alone: a lane a value, each with its cards.
    rt.update(|s, _| { s.act("list.group by=area tile=lanes", Actor::Person); });
    rest(&mut rt);
    assert_eq!(asked_lists(&asked, "query").pop().unwrap()["group"], "area");
    for key in ["tile/lanes/lane/plot", "tile/lanes/lane/bed", "tile/lanes/group/plot", "tile/lanes/row/beans", "tile/lanes/row/onions"] { assert!(rt.find(key).is_some(), "{key} is on screen: {:?}", keyed(&rt, "tile/lanes/")) }
    let (plot, bed, beans) = (rect_of(&rt, "tile/lanes/lane/plot").unwrap(), rect_of(&rt, "tile/lanes/lane/bed").unwrap(), rect_of(&rt, "tile/lanes/row/beans").unwrap());
    assert!(bed[0] >= plot[0] + plot[2] - 1.0 && (plot[1] - bed[1]).abs() < 1.0, "the lanes sit side by side: {plot:?} {bed:?}");
    assert!(beans[0] >= plot[0] && beans[0] + beans[2] <= plot[0] + plot[2] + 1.0, "a card sits in its lane");
    // A card pressed runs its own act line from the lanes: the layout lands it in the reader their select feeds.
    open_row(&mut rt, "tile/lanes/row/onions");
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("onions"));
    assert!(rt.state.steps.iter().any(|step| step.line() == "list.pick id=onions tile=lanes" && step.ok), "{:?}", rt.state.steps.iter().map(crate::actions::Step::line).collect::<Vec<_>>());
    // Arranged another way, by the list's own word: the same rows under their groups.
    rt.update(|s, _| { s.act("list.layout layout=rows tile=lanes", Actor::Person); });
    rest(&mut rt);
    assert!(rt.find("tile/lanes/lane/plot").is_none() && rt.find("tile/lanes/group/plot").is_some() && rt.find("tile/lanes/row/beans").is_some());
}

#[test]
fn the_navigator_s_facets_are_rows_and_chips_that_narrow_what_the_matches_list() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    open_from_the_bar(&mut rt, "navigator");
    assert_eq!(names(&rt.state), ["facets", "matches", "reader"]);
    for key in ["tile/facets/group/area", "tile/facets/row/area=plot", "tile/matches/row/beans", "tile/matches/row/onions"] { assert!(rt.find(key).is_some(), "{key} is on screen") }
    // A facet's row is the service's, and so is what a pick runs: the tile's question narrows, and the list that
    // follows it asks the narrowed question.
    open_row(&mut rt, "tile/facets/row/area=plot");
    assert_eq!((rt.state.question_of("facets").as_str(), rt.state.question_of("matches").as_str()), ("area=plot", "area=plot"));
    assert_eq!(asked_lists(&asked, "query").pop().unwrap()["query"], "area=plot");
    assert!(rt.find("tile/matches/row/beans").is_some() && rt.find("tile/matches/row/onions").is_none(), "only what the pick leaves is listed");
    // What it is narrowed by is a chip on the tile; pressed, it is taken back.
    press(&mut rt, "tile/facets/narrowed/area/plot");
    assert_eq!(rt.state.question_of("matches"), "");
    assert!(rt.find("tile/matches/row/onions").is_some());
    // The matches carry their own facets as chips too: a press narrows that list alone.
    press(&mut rt, "tile/matches/facet/area/bed");
    assert_eq!((rt.state.question_of("matches").as_str(), rt.state.question_of("facets").as_str()), ("area=bed", ""));
    // A match pressed opens where the tile's wires say.
    open_row(&mut rt, "tile/matches/row/onions");
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("onions"));
}

#[test]
fn last_callers_opens_from_the_bar_and_a_change_s_row_opens_its_note() {
    let mut rt = window(garden(ok()).app);
    open_from_the_bar(&mut rt, "lastcall");
    assert_eq!(names(&rt.state), ["activity", "reader"]);
    open_row(&mut rt, "tile/activity/row/beans");
    assert_eq!(rt.state.note_of("reader").as_deref(), Some("beans"));
}

#[test]
fn a_table_s_columns_are_the_list_s_and_a_header_sorts_by_its_property() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("seed-table", json!({ "focus": "beds", "root": { "t": "leaf", "kind": "query", "name": "beds", "query": "type=chore", "columns": "title area" } }), json!([]))]));
    let asked = g.asked.clone();
    assert!(act(&mut g.app, "screen.open name=seed-table").ok);
    let mut rt = window(g.app);
    assert_eq!(rt.state.list_of("beds").map(|a| (a.list.arrange.clone(), a.list.columns.clone())), Some(("table".to_string(), vec!["title".to_string(), "area".to_string()])));
    for key in ["tile/beds/column/title", "tile/beds/column/area", "tile/beds/row/beans"] { assert!(rt.find(key).is_some(), "{key} is on screen") }
    // A header pressed sorts by its column's property, by name; pressed again, the other way.
    press(&mut rt, "tile/beds/column/area");
    assert_eq!(asked_lists(&asked, "query").pop().unwrap()["sort"], "area asc");
    press(&mut rt, "tile/beds/column/area");
    assert_eq!(asked_lists(&asked, "query").pop().unwrap()["sort"], "area desc");
    // The properties of the open note are a table too, each value a question a pick opens the bar on.
    rt.update(|s, _| { s.act("screen.open name=desk", Actor::Person); });
    rest(&mut rt);
    assert!(rt.find("tile/props/column/property").is_some() && rt.find("tile/props/group/record").is_some());
    open_row(&mut rt, "tile/props/row/room=north#0");
    assert_eq!((rt.state.bar.open, rt.state.bar.scope.as_str(), rt.state.bar.edit.words()), (true, "query", "room=north"));
}

#[test]
fn a_long_list_builds_only_the_rows_in_view() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("seed-list", json!({ "focus": "seeds", "root": { "t": "leaf", "kind": "query", "name": "seeds", "query": "type=seed" } }), json!([]))]));
    assert!(act(&mut g.app, "screen.open name=seed-list").ok);
    let rt = window(g.app);
    assert_eq!(rt.state.rows_of("seeds").len(), 600, "every row is listed");
    let built = keyed(&rt, "tile/seeds/row/").len();
    assert!((1..120).contains(&built), "only the rows in view are built: {built}");
}

#[test]
fn a_list_the_service_refuses_says_why_on_its_tile() {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("odd", json!({ "focus": "odd", "root": { "t": "leaf", "kind": "query", "name": "odd", "query": "type!=chore" } }), json!([]))]));
    assert!(act(&mut g.app, "screen.open name=odd").ok);
    let rt = window(g.app);
    assert!(rt.find("tile/odd/refused").is_some(), "the service's words are on the tile: {:?}", keyed(&rt, "tile/odd/"));
    assert!(rt.state.notice.is_none(), "said where the rows would be, not as a window-wide problem");
}

/// Without the screens extension the service lists no screen and no kind. The window says so and draws no tile;
/// when the extension is installed its watched list moves, and the window opens on the screen that says start.
#[test]
fn with_no_screens_extension_the_window_says_so_and_opens_when_it_is_installed() {
    let g = garden_on(ok(), false);
    assert!(g.app.screen.is_nowhere() && g.app.layout.all().is_empty() && g.app.kinds().is_empty());
    assert!(g.app.notice.as_ref().is_some_and(|n| n.said.contains("no screens to open")), "{:?}", g.app.notice);
    // Drawn, it is a window with no tile and the notice that says why; the bar still opens.
    let (shipped, screens, asked, said) = (g.shipped.clone(), g.screens.clone(), g.asked.clone(), g.said.clone());
    let mut rt = window(g.app);
    assert!(rt.find("notice").is_some() && keyed(&rt, "tile/").is_empty());
    let mut g = Garden { app: rt.state, asked, said, screens, shipped, elsewhere: Default::default(), outlines: Default::default(), reached: Default::default() };
    // The bar still lists what this window has of its own, and the service's own words for the screens.
    assert!(act(&mut g.app, "bar.open scope=screens").ok);
    assert!(crate::bar::rows(&g.app).is_empty());
    assert!(act(&mut g.app, "bar.close").ok);
    let opened = act(&mut g.app, "open id=shed");
    assert!(!opened.ok && opened.said.contains("no tile kind here reads notes"), "{}", opened.said);
    // Installed: the host says its list moved.
    g.shipped.set(true);
    screens_are(&mut g, json!([]));
    assert_eq!((g.app.screen.name.as_str(), names(&g.app)), ("desk", vec!["tree".to_string(), "reader".to_string(), "props".to_string(), "backlinks".to_string(), "threads".to_string(), "proposals".to_string(), "revisions".to_string()]));
    assert!(g.app.notice.is_none() && g.app.journal.is_empty(), "{:?}", g.app.notice);
    assert_eq!((g.app.reader().map(|id| g.app.layout.name(&id)).as_deref(), g.app.subject()), (Some("reader"), None), "its reader is there, told no note and showing none");
}

/// A fold's mark is the row's own word, and the service says it of a note only when a note is under it (its
/// `hasNotes`, by outline-core's `isNoteUnder`). The beans have a comment thread under them and no note: their row
/// has no mark, a press on it opens them and folds nothing, and the tree is never asked to list under them. The
/// onions have a note under them: their row has the mark, and unfolding it lists that note.
#[test]
fn the_tree_marks_a_fold_only_on_a_row_that_opens_onto_notes() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    let opened = |asked: &Asked| -> Vec<String> { asked_lists(asked, "children").iter().flat_map(|ask| ask["open"].as_array().cloned().unwrap_or_default()).filter_map(|id| id.as_str().map(str::to_string)).collect() };
    // The plot is the open note and a folder: a press on its row unfolds it.
    open_row(&mut rt, "tile/tree/row/plot");
    assert_eq!(listed(&rt.state), [(0, "Plot".to_string()), (1, "Lift the onions".to_string()), (1, "Water the beans".to_string()), (0, "Shed".to_string())]);
    let marked: Vec<String> = keyed(&rt, "tile/tree/row/").into_iter().filter(|key| key.ends_with("/fold")).collect();
    assert_eq!(marked, ["tile/tree/row/plot/fold", "tile/tree/row/onions/fold"], "a mark on the rows the service says fold, and on no other");
    // The beans: a comment is under them (their thread is listed where comments are), and no note.
    open_row(&mut rt, "tile/tree/row/beans");
    assert_eq!(rt.state.subject().as_deref(), Some("beans"));
    assert_eq!(asked_lists(&asked, "threads").pop().map(|ask| ask["of"].clone()), Some(json!("beans")), "their comments are asked for, as a list about them");
    open_row(&mut rt, "tile/tree/row/beans");
    let tree = rt.state.layout.named("tree").unwrap();
    assert!(!rt.state.ui(&tree).unfolded.contains("beans") && !opened(&asked).contains(&"beans".to_string()), "a row with no fold opens its note and unfolds nothing: {:?}", rt.state.ui(&tree).unfolded);
    assert!(rt.find("tile/tree/row/beans/fold").is_none());
    // The onions: the mark opens onto their note.
    open_row(&mut rt, "tile/tree/row/onions");
    assert!(rt.state.ui(&tree).unfolded.contains("onions") && opened(&asked).contains(&"onions".to_string()));
    assert_eq!(listed(&rt.state), [(0, "Plot".to_string()), (1, "Lift the onions".to_string()), (2, "Take the fork".to_string()), (1, "Water the beans".to_string()), (0, "Shed".to_string())]);
    assert!(rt.find("tile/tree/row/fork").is_some() && rt.find("tile/tree/row/fork/fold").is_none(), "what the fold opened onto is on screen: {:?}", keyed(&rt, "tile/tree/row/"));
    // Every mark on screen is on a row with rows under it, once it is open.
    let rows = rt.state.tree().to_vec();
    for (at, row) in rows.iter().enumerate().filter(|(_, row)| row.folds && row.open) {
        assert!(rows.get(at + 1).is_some_and(|next| next.depth == row.depth + 1), "{} is open onto nothing", row.label);
    }
}
