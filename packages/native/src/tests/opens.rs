//! What opens where (K2): the person decides, as in the door. A press on a row selects and a second opens, a
//! modifier or the middle button opens fresh, and the layout's own placement says where each lands; a tile's wires
//! are set and cleared on screen; a reader pins; a list about a note is held on its subject or follows its home,
//! and is aimed by a key; a landing somewhere unexpected is said with its way back. By real pointer and key events
//! through the runtime, on the screen every door ships.
use rune::{Key, Mods, PhysicalInput, PointerButton, Runtime};
use serde_json::json;

use super::support::*;
use crate::actions::{Actor, App};

fn key(rt: &mut Runtime<App>, key: Key) { chord(rt, key, Mods::default()) }
fn letter(rt: &mut Runtime<App>, text: &str) { key(rt, Key::Text(text.to_string())) }
fn alt() -> Mods { Mods { alt: true, ..Mods::default() } }
fn focus(rt: &Runtime<App>) -> String { rt.state.layout.name(&rt.state.layout.focus) }
fn shows(rt: &Runtime<App>, tile: &str) -> Option<String> { rt.state.layout.named(tile).and_then(|id| rt.state.note_of(&id)) }
fn cursor(rt: &Runtime<App>, tile: &str) -> Option<String> { rt.state.ui(tile).cursor.clone() }
fn run(rt: &mut Runtime<App>, line: &str) { let line = line.to_string(); rt.update(move |s, _| { let ran = s.act(&line, Actor::Person); assert!(ran.ok, "{line}: {}", ran.said); }); rest(rt); }
fn lines(rt: &Runtime<App>, from: usize) -> Vec<String> { rt.state.steps[from..].iter().map(|step| step.line()).collect() }
fn names(rt: &Runtime<App>) -> Vec<String> { rt.state.layout.all().iter().map(|id| rt.state.layout.name(id)).collect() }
fn said(rt: &Runtime<App>) -> String { rt.state.notice.as_ref().map(|notice| notice.said.clone()).unwrap_or_default() }
fn asked_lists(asked: &Asked, from: &str) -> Vec<serde_json::Value> { asked.borrow().iter().filter(|a| a["action"] == "lists.read" && a["from"] == from).cloned().collect() }
fn words(rt: &Runtime<App>, tile: &str, verb: &str) -> String { rt.state.wire_words(&rt.state.layout.named(tile).unwrap(), verb) }
/// A press with a modifier held, as the platform says one: the modifiers change, the pointer goes down and up.
fn press_with(rt: &mut Runtime<App>, key: &str, mods: Mods) {
    rt.physical_input(PhysicalInput::Modifiers(mods));
    rt.frame(0.0);
    press(rt, key);
    rt.physical_input(PhysicalInput::Modifiers(Mods::default()));
    rt.frame(0.0);
}

/// The sentence, by the mouse: a press on a row selects it, a second opens it, and Option or the middle button opens
/// it fresh, each landing where the layout says.
#[test]
fn a_press_selects_a_second_press_opens_and_a_modifier_or_the_middle_button_opens_fresh() {
    let mut rt = window(garden(ok()).app);
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader").as_deref()), ("reader", Some("plot")));
    // The press that brings the tree the keys puts its cursor on the row, and nothing else: no note moves.
    let from = rt.state.steps.len();
    press(&mut rt, "tile/tree/row/shed");
    assert_eq!((focus(&rt).as_str(), cursor(&rt, "tree").as_deref(), shows(&rt, "reader").as_deref()), ("tree", Some("shed"), Some("plot")), "{:?}", lines(&rt, from));
    assert!(rt.state.steps[from..].iter().any(|step| step.action == "list.press" && step.ok));
    // A press with the keys there selects: the reader the tree's select wire names shows the row's note, and the
    // keys stay in the tree. No open ran.
    let from = rt.state.steps.len();
    press(&mut rt, "tile/tree/row/plot");
    press(&mut rt, "tile/tree/row/shed");
    assert_eq!((focus(&rt).as_str(), cursor(&rt, "tree").as_deref(), shows(&rt, "reader").as_deref()), ("tree", Some("shed"), Some("shed")));
    assert!(!rt.state.steps[from..].iter().any(|step| step.action == "open" || step.action == "list.pick"), "a select opens nothing: {:?}", lines(&rt, from));
    // What a select showed is marked on the tile that took it, as a preview, until it has been seen.
    let reader = rt.state.layout.named("reader").unwrap();
    assert!(rt.state.arrival(&reader).is_some_and(|arrived| arrived.preview && arrived.note == "shed") && rt.find("tile/reader/arrived").is_some());
    // Two presses on one row, the second at once, open it: the list's own pick ran, the note landed where the tree's
    // opens land, and the tree, which hands its keys on, gave them to that reader.
    let from = rt.state.steps.len();
    open_row(&mut rt, "tile/tree/row/plot");
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader").as_deref()), ("reader", Some("plot")));
    assert!(rt.state.steps[from..].iter().any(|step| step.line() == "list.pick id=plot tile=tree" && step.ok), "{:?}", lines(&rt, from));
    // Option held: an open fresh. The reader keeps its note, and the row's lands in a reader beside it.
    let before = names(&rt);
    let from = rt.state.steps.len();
    press_with(&mut rt, "tile/tree/row/shed", alt());
    let made: Vec<String> = names(&rt).into_iter().filter(|name| !before.contains(name)).collect();
    assert_eq!(made.len(), 1, "one reader was made for it: {:?} {:?}", names(&rt), lines(&rt, from));
    assert_eq!((shows(&rt, "reader").as_deref(), shows(&rt, &made[0]).as_deref()), (Some("plot"), Some("shed")));
    assert!(rt.state.steps[from..].iter().any(|step| step.line() == "list.open id=shed where=new tile=tree" && step.ok), "{:?}", lines(&rt, from));
    // The middle button is the same open fresh, with nothing held.
    let (x, y) = rt.find("tile/tree/row/plot").unwrap();
    let from = rt.state.steps.len();
    rt.button_down(x, y, PointerButton::Middle);
    rt.button_up(x, y, PointerButton::Middle);
    rest(&mut rt);
    assert!(rt.state.steps[from..].iter().any(|step| step.line() == "list.open id=plot where=new tile=tree" && step.ok), "{:?}", lines(&rt, from));
    assert_eq!(shows(&rt, "reader").as_deref(), Some("plot"));
    // A press on a fold's own mark folds at once, and selects and opens nothing.
    run(&mut rt, "tree.fold id=plot open=true");
    let was = cursor(&rt, "tree");
    press(&mut rt, "tile/tree/row/plot/fold");
    assert!(!rt.state.ui("tree").unfolded.contains("plot") && cursor(&rt, "tree") == was);
}

/// By the keys: the cursor's steps show in the reader the tree's select wire names, as one walk with one way back;
/// Return opens and hands the keys on; Alt+Return opens fresh.
#[test]
fn the_cursor_s_steps_show_where_the_select_wire_says_and_return_and_alt_return_open() {
    let mut rt = window(garden(ok()).app);
    press(&mut rt, "tile/tree/row/plot");
    run(&mut rt, "tree.fold id=plot open=true");
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader").as_deref()), ("tree", Some("plot")));
    // j, j: the reader follows the cursor, the keys stay in the tree, and the walk is one stop back.
    letter(&mut rt, "j");
    letter(&mut rt, "j");
    let on = cursor(&rt, "tree").unwrap();
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader")), ("tree", Some(on.clone())));
    assert_eq!(rt.state.ui("reader").history, ["plot"], "a walk keeps one way back: where it began");
    // The hint row says where each lands, in the layout's words, for the tile with the keys.
    let lands = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("hints/lands")).and_then(|e| e.text).unwrap_or_default();
    assert_eq!(plain(&lands), "select \u{2192} reader \u{b7} open \u{2192} reader \u{b7} alt \u{2192} beside tree");
    // Return opens the row where the tree's opens land: with no wire, the first reader not pinned, which takes the keys.
    key(&mut rt, Key::Enter);
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader")), ("reader", Some(on.clone())));
    // Alt+Return from the tree: fresh, in a reader beside, and the reader keeps its note.
    run(&mut rt, "tile.focus tile=tree");
    letter(&mut rt, "k");
    let other = cursor(&rt, "tree").unwrap();
    // (The step previewed it in the reader; Back puts the reader on the note it was opened on.)
    run(&mut rt, "back tile=reader");
    assert_eq!(shows(&rt, "reader"), Some(on.clone()));
    let before = names(&rt);
    chord(&mut rt, Key::Enter, alt());
    let made: Vec<String> = names(&rt).into_iter().filter(|name| !before.contains(name)).collect();
    assert_eq!(made.len(), 1, "{:?}", rt.state.steps.iter().rev().take(4).map(|step| step.line()).collect::<Vec<_>>());
    assert_eq!((shows(&rt, "reader"), shows(&rt, &made[0])), (Some(on), Some(other)));
}

/// A tile's wires are the person's to set and clear in the window: Alt+L then a letter begins one, every tile says
/// what a press on it does, a press sends the wire there, and the layout's own step sets it.
#[test]
fn a_wire_is_set_by_picking_its_tile_on_screen_and_cleared_the_same_way() {
    let mut rt = window(garden(ok()).app);
    run(&mut rt, "tile.split tile=reader");
    assert!(names(&rt).contains(&"reader2".to_string()));
    press(&mut rt, "tile/tree/row/shed");
    assert_eq!((focus(&rt).as_str(), words(&rt, "tree", "open").as_str()), ("tree", "reader"));
    // Alt+L, then o: the open wire is being set from the tree. The keys are that mode's, and the tiles say so.
    chord(&mut rt, Key::Text("l".into()), alt());
    assert!(rt.state.hinted().iter().any(|hint| hint.line == "wire.pick verb=open"), "the hint row lists what Alt+L can become: {:?}", rt.state.hinted());
    letter(&mut rt, "o");
    assert_eq!(rt.state.linking.as_ref().map(|linking| (rt.state.layout.name(&linking.from), linking.verb.clone())), Some(("tree".to_string(), "open".to_string())));
    assert_eq!(rt.state.person().json()["layer"], "linking");
    let offers = |rt: &Runtime<App>, tile: &str| rt.elements().into_iter().find(|e| e.key.as_deref() == Some(&format!("link/{tile}"))).and_then(|e| e.label);
    assert_eq!((offers(&rt, "reader2").as_deref(), offers(&rt, "tree").as_deref(), offers(&rt, "props")), (Some("reader2: press to link here"), Some("tree: press to open in place"), None));
    let foot = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("linking")).and_then(|e| e.text).unwrap_or_default();
    assert!(plain(&foot).starts_with("open from tree lands in reader"), "{foot}");
    assert!(rt.state.hinted().iter().any(|hint| hint.line == "wire.pick on=false") && rt.state.hinted().iter().any(|hint| hint.line == "wire.pick unlink=true"));
    // A press on the second reader: the tree's opens land there from then, by the layout's own link.
    let from = rt.state.steps.len();
    press(&mut rt, "link/reader2");
    assert!(rt.state.linking.is_none());
    assert!(rt.state.steps[from..].iter().any(|step| step.line() == "tile.link to=reader2 verb=open tile=tree" && step.ok), "{:?}", lines(&rt, from));
    assert_eq!(words(&rt, "tree", "open"), "reader2");
    assert!(said(&rt).contains("tree: open \u{2192} reader2"), "{}", said(&rt));
    // Return in the tree now opens in reader2, and a routed open keeps the keys in the list.
    key(&mut rt, Key::Enter);
    assert_eq!((focus(&rt).as_str(), shows(&rt, "reader2").as_deref()), ("tree", Some("shed")));
    // The select wire by its number: Alt+L s, then the digit on reader2's title.
    chord(&mut rt, Key::Text("l".into()), alt());
    letter(&mut rt, "s");
    let stop = rt.state.tab_stops().iter().position(|id| rt.state.layout.name(id) == "reader2").unwrap() + 1;
    letter(&mut rt, &stop.to_string());
    assert_eq!(words(&rt, "tree", "select"), "reader2");
    // Unlinked the same way: Alt+L o, then x. Its opens go by the layout's rule again; Escape lets go of a pick.
    chord(&mut rt, Key::Text("l".into()), alt());
    letter(&mut rt, "o");
    letter(&mut rt, "x");
    assert_eq!((rt.state.linking.is_none(), words(&rt, "tree", "open").as_str()), (true, "reader"));
    chord(&mut rt, Key::Text("l".into()), alt());
    letter(&mut rt, "a");
    key(&mut rt, Key::Escape);
    assert!(rt.state.linking.is_none() && rt.state.steps.last().is_some_and(|step| step.line() == "wire.pick on=false"));
    // Picking on screen is the person's; an agent names the tile, and the layout's rule answers it.
    rt.update(|s, _| { let theirs = s.act("wire.pick verb=open tile=tree", Actor::Agent("compost-agent".into())); assert!(!theirs.ok && theirs.said.contains("tile.link to=<tile>"), "{}", theirs.said); });
}

/// A reader pins and unpins by its key and by the control on its title; an open aimed at a pinned reader lands
/// beside it and says so with the way back.
#[test]
fn a_pinned_reader_keeps_its_note_and_an_open_aimed_at_it_lands_beside_it_and_says_so() {
    let mut rt = window(garden(ok()).app);
    assert_eq!(focus(&rt), "reader");
    letter(&mut rt, "p");
    let reader = rt.state.layout.named("reader").unwrap();
    assert!(rt.state.pinned(&reader) && rt.state.facts(&reader).pinned);
    assert!(said(&rt).contains("pinned reader"), "{}", said(&rt));
    // A select wire waits on a pinned reader: the tree's cursor moves and the reader keeps its note.
    press(&mut rt, "tile/tree/row/shed");
    press(&mut rt, "tile/tree/row/plot");
    press(&mut rt, "tile/tree/row/shed");
    assert_eq!((cursor(&rt, "tree").as_deref(), shows(&rt, "reader").as_deref()), (Some("shed"), Some("plot")));
    // Opened, the note lands beside the pinned reader, and the notice says why with the way back.
    let before = names(&rt);
    open_row(&mut rt, "tile/tree/row/shed");
    let made: Vec<String> = names(&rt).into_iter().filter(|name| !before.contains(name)).collect();
    assert_eq!(made.len(), 1);
    assert_eq!((shows(&rt, "reader").as_deref(), shows(&rt, &made[0]).as_deref()), (Some("plot"), Some("shed")));
    assert!(said(&rt).starts_with(&format!("opened in {} \u{b7} reader is pinned: opened beside it", made[0])) && said(&rt).contains("unpins it"), "{}", said(&rt));
    // The control on its title lets it go, and opens land in it again.
    press(&mut rt, "tile/reader/pin");
    assert!(!rt.state.pinned(&reader));
    run(&mut rt, "open id=beans tile=reader");
    assert_eq!(shows(&rt, "reader").as_deref(), Some("beans"));
    // An agent pins a reader the person is not in, and it is said on the status line as any act of an agent's is.
    run(&mut rt, "tile.focus tile=tree");
    rt.update(|s, _| { assert!(s.act("reader.pin on=true tile=reader", Actor::Agent("compost-agent".into())).ok); });
    rest(&mut rt);
    assert!(rt.state.pinned(&reader) && rt.state.agent_said.as_deref().is_some_and(|said| said.contains("compost-agent") && said.contains("reader.pin")));
}

/// A list about a note holds its subject until the person aims it again: held or following by the control on its
/// title, aimed by `b` in a reader and in the list, and never re-aimed by an agent while it is held.
#[test]
fn a_list_about_a_note_is_held_or_follows_by_its_own_control_and_is_aimed_by_b() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    let of = |from: &str| asked_lists(&asked, from).pop().map(|ask| ask["of"].clone());
    let backlinks = rt.state.layout.named("backlinks").unwrap();
    // As its screen ships it, the links tile follows its reader: it says so on its title, and moves with the note.
    assert_eq!(rt.state.held_on(&backlinks).map(|(held, _, home)| (held, home)), Some((false, Some("reader".to_string()))));
    run(&mut rt, "open id=shed tile=reader");
    assert_eq!(of("links"), Some(json!("shed")));
    // A press on that control holds it on the note it lists: the reader moves on without it.
    press(&mut rt, "tile/backlinks/subject");
    assert_eq!(rt.state.held_on(&backlinks).map(|(held, ..)| held), Some(true));
    assert!(rt.state.steps.iter().any(|step| step.line() == "tile.hold tile=backlinks" && step.ok));
    run(&mut rt, "open id=plot tile=reader");
    assert_eq!((rt.state.subject_of(&backlinks).as_deref(), of("links")), (Some("shed"), Some(json!("shed"))), "held, it keeps its subject");
    let title = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("tile/backlinks/subject")).and_then(|e| e.text).unwrap_or_default();
    assert!(plain(&title).starts_with("held"), "its title says what it is held on: {title}");
    // An agent's open moves no held list, and its aim leaves a held list on its note. (In the reader the person
    // has the keys in, an agent's aim waits as any act in their tile does.)
    rt.update(|s, _| { let theirs = s.act("tile.aim tile=reader", Actor::Agent("compost-agent".into())); assert!(!theirs.ok && theirs.said.contains("reader has the person's keys"), "{}", theirs.said); });
    run(&mut rt, "tile.focus tile=tree");
    rt.update(|s, _| { assert!(s.act("open id=beans", Actor::Agent("compost-agent".into())).ok); let aimed = s.act("tile.aim tile=reader", Actor::Agent("compost-agent".into())); assert_eq!(aimed.answer["aimed"].as_array().map(|aimed| aimed.iter().any(|tile| tile == "backlinks")), Some(false), "{:?}", aimed); });
    rest(&mut rt);
    assert_eq!(rt.state.subject_of(&backlinks).as_deref(), Some("shed"));
    // b in the reader aims the lists about a note at the note it shows: they are held on it, the reader is their
    // home, and the first of them takes the keys.
    run(&mut rt, "open id=plot tile=reader");
    run(&mut rt, "tile.focus tile=reader");
    letter(&mut rt, "b");
    assert_eq!((rt.state.subject_of(&backlinks).as_deref(), rt.state.follows(&backlinks)), (Some("plot"), false));
    assert!(rt.state.aims(&rt.state.layout.focus), "the keys went to a list about the note: {}", focus(&rt));
    // The reader moves on; b in the list aims it at its reader's note again.
    run(&mut rt, "open id=shed tile=reader");
    assert_eq!(rt.state.subject_of(&backlinks).as_deref(), Some("plot"));
    run(&mut rt, "tile.focus tile=backlinks");
    letter(&mut rt, "b");
    assert_eq!(rt.state.subject_of(&backlinks).as_deref(), Some("shed"));
    // Let go by its key (Shift+B), it follows its reader again.
    chord(&mut rt, Key::Text("b".into()), Mods { shift: true, ..Mods::default() });
    assert!(rt.state.follows(&backlinks));
    run(&mut rt, "open id=beans tile=reader");
    assert_eq!(rt.state.subject_of(&backlinks).as_deref(), Some("beans"));
}

/// A preview is joined to its list in one step, and run again it shows the one that is there and says how to
/// unlink it; a list wired to itself reads its notes in place, and Back returns to the list.
#[test]
fn a_preview_is_wired_in_one_step_and_a_list_wired_to_itself_opens_in_place() {
    let mut rt = window(garden(ok()).app);
    // The reader's preview: a second reader where its opens land, joined by an open wire.
    chord(&mut rt, Key::Text("o".into()), Mods { shift: true, ..Mods::default() });
    let made = names(&rt).into_iter().find(|name| name.starts_with("reader-preview")).expect("a preview opened beside the reader");
    assert_eq!(words(&rt, "reader", "open"), made);
    // Again: nothing new is made, the one there is shown, and the way to unlink it is said.
    let count = names(&rt).len();
    run(&mut rt, "tile.preview tile=reader");
    assert_eq!(names(&rt).len(), count);
    assert!(said(&rt).starts_with(&format!("reader already opens into {made}: showed it")) && said(&rt).contains("unlinks it"), "{}", said(&rt));
    // The tree already selects into the reader: its preview is that reader.
    run(&mut rt, "tile.preview tile=tree");
    assert!(said(&rt).starts_with("tree already selects into reader: showed it"), "{}", said(&rt));
    // A list wired to itself: a row opened shows its note in the list's own tile, and Back puts the list back.
    run(&mut rt, "wire.pick verb=open tile=tree");
    press(&mut rt, "link/tree");
    assert_eq!(words(&rt, "tree", "open"), "in place");
    run(&mut rt, "list.pick id=shed tile=tree");
    let tree = rt.state.layout.named("tree").unwrap();
    assert_eq!((rt.state.in_place(&tree), rt.state.note_of(&tree).as_deref()), (true, Some("shed")), "{:?} {}", rt.state.steps.last().map(|step| (step.line(), step.said.clone())), said(&rt));
    assert!(rt.find("tile/tree/row/shed").is_none() && rt.find("tile/tree/note").is_some(), "the note is read in the tree's tile: {:?}", rt.elements().into_iter().filter_map(|e| e.key).filter(|key| key.starts_with("tile/tree/")).take(12).collect::<Vec<_>>());
    run(&mut rt, "back tile=tree");
    assert!(!rt.state.in_place(&tree) && rt.find("tile/tree/row/shed").is_some(), "back past its first note lists again");
}

/// What the person set is kept with the arrangement and written with a screen: the next launch opens things the
/// same way.
#[test]
fn pins_holds_and_wires_are_kept_with_the_arrangement_and_written_with_a_saved_screen() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-opens-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let kept = dir.join("native-garden.layout.json");
    let mut g = garden_kept(ok(), &kept);
    for line in ["tile.split tile=reader", "reader.pin on=true tile=reader2", "tile.hold on=true tile=backlinks", "tile.link to=reader2 verb=open tile=tree", "open id=shed tile=reader", "tile.aim tile=reader"] { assert!(act(&mut g.app, line).ok, "{line}") }
    let backlinks = g.app.layout.named("backlinks").unwrap();
    assert_eq!((g.app.subject_of(&backlinks).as_deref(), g.app.follows(&backlinks)), (Some("shed"), false));
    // A screen saved carries each in the words a screen is written in: every door opens it the same way.
    assert!(act(&mut g.app, "screen.save name=\"Garden desk\"").ok);
    let saved = g.asked.borrow().iter().rev().find(|ask| ask["action"] == "screens.save").cloned().expect("the screen was written");
    let text = saved["spec"]["layout"].to_string();
    assert!(text.contains("\"mode\":\"pinned\"") && text.contains("\"verb\":\"open\""), "{text}");
    fn leaf<'a>(node: &'a serde_json::Value, name: &str) -> Option<&'a serde_json::Value> {
        if node["t"] == "leaf" { return (node["name"] == name).then_some(node) }
        ["kids", "tabs"].iter().flat_map(|key| node[*key].as_array().into_iter().flatten()).chain(node.get("kid")).find_map(|kid| leaf(kid, name))
    }
    let links = leaf(&saved["spec"]["layout"]["root"], "backlinks").expect("the links tile is in the saved layout");
    assert_eq!((links.get("subject"), links["source"].as_str()), (None, Some("tile:reader")), "held is a list with no `subject: follows`");
    // The next launch, from the arrangement's file: the pin, the hold and its subject, the wire.
    drop(g);
    let again = garden_kept(ok(), &kept);
    let (reader2, backlinks) = (again.app.layout.named("reader2").unwrap(), again.app.layout.named("backlinks").unwrap());
    assert!(again.app.pinned(&reader2), "the reader comes back pinned");
    assert_eq!((again.app.subject_of(&backlinks).as_deref(), again.app.follows(&backlinks)), (Some("shed"), false), "the list comes back held on its note");
    assert_eq!(again.app.wire_words(&again.app.layout.named("tree").unwrap(), "open"), "reader2", "the tree's opens still go to the reader it was wired to");
    let _ = std::fs::remove_file(&kept);
    let _ = std::fs::remove_dir(&dir);
}
