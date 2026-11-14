//! Wave A1: what Rune already does well is Rune's. The window draws its own title bar (the toolbar's row moves the
//! window and its buttons keep their presses), a right-click gives a tile's menu (the platform's own where the
//! window has those, the bar's list everywhere), and a control says what it is called and its key on a hover.
use rune::Runtime;

use super::support::*;
use crate::actions::{Actor, App};

fn agent() -> Actor { Actor::Agent("seedling-agent".into()) }

/// A right-click, then frames until what it opened is there.
fn right_click(rt: &mut Runtime<App>, key: &str) {
    let (x, y) = rt.find(key).unwrap_or_else(|| panic!("nothing on screen is keyed {key}"));
    rt.secondary_down(x, y);
    rt.secondary_up(x, y);
    rest(rt);
}

/// The titles of the platform menu that is open, in order, with whether each can be picked.
fn menu_titles(rt: &Runtime<App>) -> Vec<(String, bool)> {
    let menu = rt.popup_menu().expect("a menu of the platform's own is open");
    (0..).map_while(|n| menu.find(&n.to_string())).map(|item| (item.title().to_string(), item.is_enabled())).collect()
}

/// The run, on a Mac: AppKit's own title band lay over the toolbar's row, so the row was no handle of the window's
/// and a press meant for one of its buttons could be the band's. The window now draws its title bar itself
/// (`App::titlebar`): the toolbar's row is the band, as tall as the band is, it moves the window where nothing on
/// it takes the press, a button on it keeps its own, and it keeps clear of the window's own controls at both ends
/// (a Mac's traffic lights at its start, Windows' caption buttons at its end), as Rune says where they are. Run
/// here by telling the runtime the insets; on a Mac itself this was not run.
#[test]
fn the_toolbar_is_the_window_s_title_bar_and_keeps_clear_of_the_window_s_own_controls() {
    let g = garden(ok());
    let mut rt = window(g.app);
    let bar = rect_of(&rt, "toolbar").expect("the toolbar is drawn");
    assert_eq!(bar[3], crate::shell::TOOLBAR, "the row is the title bar's band");
    assert_eq!(crate::shell::titlebar().height(), crate::shell::TOOLBAR);
    // Held where nothing takes a press, the row moves the window.
    let name = rect_of(&rt, "outline-name").unwrap();
    rt.pointer_down(name[0] + 2.0, bar[1] + bar[3] / 2.0);
    assert_eq!(rt.take_titlebar_action(), Some(rune::TitlebarAction::Drag), "a press on the row's own ground drags the window");
    rt.pointer_up(name[0] + 2.0, bar[1] + bar[3] / 2.0);
    rest(&mut rt);
    // A button on it keeps its press: the bar opens, and the window is not moved.
    let (x, y) = rt.find("tool/bar.open").expect("the desk's toolbar has the bar's button");
    rt.pointer_down(x, y);
    assert_eq!(rt.take_titlebar_action(), None, "a press on a button is the button's");
    rt.pointer_up(x, y);
    rest(&mut rt);
    assert!(rt.state.bar.open, "the button ran its act");
    rt.update(|s, _| { s.act("bar.close", Actor::Person); });
    rest(&mut rt);
    // The window's own controls over the row, as Rune says where they are. A Mac's traffic lights at its start: the
    // row starts past them.
    let lead = |points: f32| { let mut insets = rune::ChromeInsets::default(); (insets.leading, insets.height) = (points, crate::shell::TOOLBAR); insets };
    rt.set_chrome_insets(lead(78.0));
    rest(&mut rt);
    let name = rect_of(&rt, "outline-name").unwrap();
    assert!(name[0] >= 78.0 + 8.0, "the name starts at {} and the window's buttons end at 78", name[0]);
    // Windows' caption buttons at its end: the row ends before them. (In a window torn from this one, whose row has
    // no button of a screen's: the desk's eleven fill a window this wide by themselves.)
    let Garden { mut app, .. } = garden(ok());
    assert!(act(&mut app, "tile.tear tile=reader").ok);
    let mut torn = window(app.born().pop().expect("the act asked for a window"));
    let mut insets = rune::ChromeInsets::default();
    (insets.trailing, insets.height) = (138.0, crate::shell::TOOLBAR);
    torn.set_chrome_insets(insets);
    rest(&mut torn);
    let (lock, width) = (rect_of(&torn, "tool/lock").unwrap(), rect_of(&torn, "toolbar").unwrap()[2]);
    assert!(lock[0] + lock[2] <= width - 138.0 - 8.0, "the last button ends at {}, and the caption buttons start at {}", lock[0] + lock[2], width - 138.0);
}

/// A control with no words of its own says what it is called and its key to a pointer resting on it, both read from
/// the action's row and the key table; and what a screen reader meets first has a role: the toolbar, a tile's tabs
/// with the one in front marked, the tree's rows with their depth.
#[test]
fn a_control_says_its_name_and_key_on_a_hover_and_the_window_s_parts_say_what_they_are() {
    let g = garden(ok());
    let rt = window(g.app);
    let of = |key: &str| rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).unwrap_or_else(|| panic!("{key} is drawn"));
    let close = of("tile/reader/close");
    let help = close.help.clone().expect("the cross on a tile's title has a tooltip");
    assert!(help.contains(&crate::actions::label("tile.close")), "it says what the row calls it: {help}");
    assert!(help.contains(&crate::keys::cap("tile.close").unwrap()), "and the key the table binds: {help}");
    // The three dots open the tile's menu, and say so the same way.
    assert!(of("tile/reader/menu").help.is_some_and(|help| help.contains(&crate::actions::label("tile.menu"))));
    assert_eq!(of("toolbar").role, "toolbar");
    let tab = of("tile/threads/tab/threads");
    assert_eq!((tab.role, tab.item_selected), ("tab", true), "the tab in front says so");
    assert!(!of("tile/threads/tab/proposals").item_selected);
    let row = of("tile/tree/row/plot");
    assert_eq!((row.role, row.level), ("treeitem", Some(1)));
}

/// A right-click on a row of the tree, in a window with the platform's own menus: the tile takes the keys, and the
/// menu is one of the platform's, at the pointer. Its first row is what a pick of that row runs, called what the
/// action's row calls it; then the tile's own actions under their groups, each a `menu` row of an action. Picking
/// one runs its line from the tile, and leaves the step any press leaves.
#[test]
fn a_right_click_on_a_row_opens_the_tile_s_menu_about_that_row_and_a_pick_runs_its_line() {
    let g = garden(ok());
    let mut app = g.app.with_native_menus(true);
    assert!(act(&mut app, "tree.fold id=plot open=true").ok);
    let mut rt = window(app);
    rest(&mut rt);
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "reader");
    right_click(&mut rt, "tile/tree/row/beans");
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "tree", "a right-click gives the tile the keys");
    assert!(!rt.state.bar.open, "the menu is the platform's, not the bar's");
    let titles = menu_titles(&rt);
    assert_eq!(titles[0], (crate::actions::label("open"), true), "the row's own act comes first: {titles:?}");
    for line in ["tile.close", "tile.split", "tile.zoom"] { assert!(titles.contains(&(crate::actions::label(line), true)), "{line}'s menu row is in the menu: {titles:?}") }
    // Nothing is in a menu twice, and nothing that needs words the menu can't give.
    let mut seen = std::collections::HashSet::new();
    assert!(rt.state.menu_open().unwrap().1.iter().all(|item| seen.insert(item.line.clone())), "a line is in the menu once");
    // The first row picked: the note opens, as a press on the row opens it.
    let from = rt.state.steps.len();
    rt.resolve_popup(Some("0")).expect("the menu takes the pick");
    rest(&mut rt);
    assert_eq!(open_note(&rt.state).as_deref(), Some("beans"));
    assert!(rt.state.steps[from..].iter().any(|step| step.action == "open" && step.ok && step.by == Actor::Person));
    assert!(rt.state.menu.is_none() && rt.popup_menu().is_none(), "a pick closes the menu, and one right-click opened one menu");
    // A right-click on the tile's own ground is about the tile alone; put away, nothing runs.
    right_click(&mut rt, "tile/reader/bar");
    let titles = menu_titles(&rt);
    assert_ne!(titles[0].0, crate::actions::label("open"), "no row was under the pointer: {titles:?}");
    assert!(titles.contains(&(crate::actions::label("note.copy-ref kind=id"), true)), "a reader's menu copies its note's address: {titles:?}");
    let from = rt.state.steps.len();
    rt.resolve_popup(None).expect("the menu is dismissed");
    rest(&mut rt);
    assert_eq!(rt.state.steps.len(), from, "a menu put away runs nothing");
    assert!(rt.state.menu.is_none());
}

/// The same menu where the platform has none of its own, and whenever it is asked with words: the bar's list. It
/// is typed into, a row's key is beside it from the key table, and Return runs the lit row from the tile.
#[test]
fn where_the_platform_has_no_menus_the_tile_s_menu_is_the_bar_s_list_typed_into_and_picked_by_key() {
    let g = garden(ok());
    let mut rt = window(g.app);
    right_click(&mut rt, "tile/reader/bar");
    assert!(rt.state.bar.open && rt.state.bar.scope == crate::bar::MENU, "the menu is the bar's list here");
    assert!(rt.popup_menu().is_none());
    let rows = crate::bar::rows(&rt.state);
    let close = rows.iter().find(|row| row.line == "tile.close").expect("the tile's close is a row");
    assert_eq!((close.label.clone(), close.keycap.clone()), (crate::actions::label("tile.close"), crate::keys::cap("tile.close")));
    // Typed into: only the rows that match.
    typed(&mut rt, "zoom");
    let rows = crate::bar::rows(&rt.state);
    assert_eq!(rows.iter().map(|row| row.line.as_str()).collect::<Vec<_>>(), ["tile.zoom"]);
    chord(&mut rt, rune::Key::Enter, rune::Mods::default());
    assert!(!rt.state.bar.open && rt.state.menu.is_none());
    assert_eq!(rt.state.layout.zoom.as_ref().map(|zoom| rt.state.layout.name(zoom)).as_deref(), Some("reader"), "the row ran about the tile the menu was of");
    // By its key, from the tile with the keys: the same menu.
    rt.update(|s, _| { s.act("tile.zoom on=false", Actor::Person); });
    chord(&mut rt, rune::Key::Command('.'), primary());
    assert!(rt.state.bar.open && rt.state.bar.scope == crate::bar::MENU);
    chord(&mut rt, rune::Key::Escape, rune::Mods::default());
    assert!(!rt.state.bar.open && rt.state.menu.is_none(), "Escape puts the menu away with the bar");
}

/// An agent's `tile.menu` opens nothing: it is answered the rows as data, each with the act it runs and why the
/// agent would be refused it. What the pointer is on is the person's to say.
#[test]
fn an_agent_s_tile_menu_is_answered_as_rows_and_opens_nothing() {
    let mut g = garden(ok());
    let answered = g.app.act("tile.menu tile=reader q=copy", agent());
    assert!(answered.ok && g.app.menu.is_none() && !g.app.bar.open);
    let rows = answered.answer["rows"].as_array().unwrap();
    assert!(!rows.is_empty() && rows.iter().all(|row| row["group"] == "Copy"), "{rows:?}");
    assert!(rows.iter().any(|row| row["act"] == "note.copy-ref kind=id"));
    // The editor's own rows say why an agent is refused them.
    let all = g.app.act("tile.menu tile=reader", agent()).answer["rows"].as_array().unwrap().clone();
    let edit = all.iter().find(|row| row["act"] == "edit").expect("a reader's menu has Edit");
    assert!(edit["refused"].as_str().is_some_and(|why| !why.is_empty()), "{edit}");
    assert!(!g.app.act("tile.point row=beans tile=tree", agent()).ok, "what the pointer is on is the person's");
}

/// `note.copy-ref`: the person's copy of the open note's id is on its way to their clipboard and said in the
/// notice; an agent's is answered and the clipboard left alone. The web link is asked of the service.
#[test]
fn a_note_s_address_is_copied_for_the_person_and_answered_to_an_agent() {
    let mut g = garden(ok());
    let copied = g.app.act("note.copy-ref", Actor::Person);
    assert!(copied.ok, "{}", copied.said);
    assert_eq!(copied.answer["text"], "plot");
    assert_eq!(g.app.copying().as_deref(), Some("plot"), "the window's hands write it on the next frame");
    assert!(g.app.notice.as_ref().is_some_and(|notice| notice.said.contains("plot")));
    let theirs = g.app.act("note.copy-ref ref=beans", agent());
    assert_eq!((theirs.answer["text"].as_str(), theirs.answer["clipboard"].as_bool()), (Some("beans"), Some(false)));
    assert_eq!(g.app.copying(), None, "an agent's copy leaves the clipboard alone");
    // The web link is the service's to say.
    assert!(g.app.act("note.copy-ref kind=link", Actor::Person).ok);
    g.app.settle();
    assert!(actions(&g.asked).contains(&"notes.address".to_string()));
    assert_eq!(g.app.copying().as_deref(), Some("https://garden.example/o/garden/p/plot"), "the link the service said is what is copied");
}

/// A made-up file in a scratch folder of this test's own: its path.
fn scratch_file(test: &str, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-{test}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

/// A file dragged from a file manager and let go over a part of a note (a real drop event through the window):
/// the note opens for editing, and the file's line goes in after the part it was let go on, on a line of its own,
/// as one step of the editor's undo. The service keeps the file and writes the line (`media.keep`): the window
/// hands over its bytes, its name and where it is, and puts in what is answered. A page a note runs is named where
/// it is; a file a note doesn't keep is refused in the service's words, and nothing is put in.
#[test]
fn a_file_dropped_on_a_part_of_a_note_goes_in_after_that_part_as_the_line_the_service_kept_it_under() {
    let picture = scratch_file("drop", "bed-at-dusk.png", &[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1]);
    let g = garden(ok());
    let (asked, mut rt) = (g.asked.clone(), window(g.app));
    assert!(draft(&rt.state).is_none());
    let at = rt.find("tile/reader/part/0").expect("the note's prose is its first part");
    rt.drop_files(vec![picture.clone()], Some(at));
    rest(&mut rt);
    let kept = asked.borrow().iter().find(|ask| ask["action"] == "media.keep").cloned().expect("the service is asked to keep the file");
    assert_eq!((kept["name"].as_str(), kept["path"].as_str()), (Some("bed-at-dusk.png"), picture.to_str()));
    assert_eq!(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, kept["base64"].as_str().unwrap()).unwrap().len(), 13, "its bytes are handed over");
    // The prose is the note's second line: the line went in after it, and the note is being written.
    assert_eq!(words(&rt.state), "Plot [type::chore]\nBefore the rain.\n[img::/made/up/garden/media/2026-11-14-bed-at-dusk.png]\n");
    assert!(unsaved(&rt.state));
    assert!(rt.state.steps.iter().any(|step| step.action == "note.drop" && step.ok && step.tile.as_deref() == Some("reader") && step.args["line"] == 2.0));
    // The editor's own undo takes the line back out, whole.
    chord(&mut rt, rune::Key::Command('z'), primary());
    assert_eq!(words(&rt.state), "Plot [type::chore]\nBefore the rain.");
    // A page a note runs, dropped on the block now being written: named where it is, at the caret.
    let page = scratch_file("drop", "night shift.html", b"<p>beds</p>");
    let field = rt.find("tile/reader/source").expect("the block's field");
    rt.drop_files(vec![page.clone()], Some(field));
    rest(&mut rt);
    assert!(words(&rt.state).ends_with(&format!("\n[artifact::{}]\n", page.display())), "{}", words(&rt.state));
    // A file a note doesn't keep: the service's refusal is the notice, and nothing is put in.
    let seeds = scratch_file("drop", "seeds.csv", b"peas,3\n");
    let before = words(&rt.state).to_string();
    rt.drop_files(vec![seeds], Some(field));
    rest(&mut rt);
    assert_eq!(words(&rt.state), before);
    assert!(rt.state.notice.as_ref().is_some_and(|notice| notice.said.contains("no picture and no page")));
    let _ = std::fs::remove_dir_all(picture.parent().unwrap());
}

/// A picture pasted into a block being written (a paste event that holds a picture and no words): kept by the
/// service as a dropped picture is, and its line put in at the caret. An agent is refused the editor's own actions.
#[test]
fn a_picture_pasted_into_a_block_is_kept_and_its_line_put_in() {
    let g = garden(ok());
    let (asked, mut rt) = (g.asked.clone(), window(g.app));
    rt.update(|s, _| { s.act("edit", Actor::Person); });
    rest(&mut rt);
    // The start of a PNG, two pixels by two: what Rune takes as a clipboard's picture.
    let png: Vec<u8> = [&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13][..], b"IHDR", &[0, 0, 0, 2, 0, 0, 0, 2]].concat();
    let picture = rune::ClipboardImage::from_png(png.clone()).expect("the bytes read as a PNG's start");
    rt.paste_content(rune::ClipboardContent::new("").with_image(picture));
    rest(&mut rt);
    let kept = asked.borrow().iter().find(|ask| ask["action"] == "media.keep").cloned().expect("the picture is handed to the service");
    assert!(kept["name"].is_null() && kept["path"].is_null(), "a clipboard's picture has no name and is nowhere: {kept}");
    assert_eq!(base64::Engine::decode(&base64::engine::general_purpose::STANDARD, kept["base64"].as_str().unwrap()).unwrap(), png);
    assert!(words(&rt.state).ends_with("\n[img::/made/up/garden/media/2026-11-14-clipboard.png]\n"), "{}", words(&rt.state));
    assert!(!rt.state.act("draft.image path=/made/up/bed.png", agent()).ok, "the editor is the person's");
}

/// The pointer resting on a row of the tree: after the door's 300 ms of rest the note that row is keyed by is asked
/// of the service (read once, never watched) and shown in a card beside the row, its title and how it starts, each
/// part built by the registry as on a page. Nothing opens: the reader keeps its note. The card goes as the pointer
/// leaves the row, and an agent has no pointer to rest.
#[test]
fn a_row_the_pointer_rests_on_shows_its_note_in_a_card_beside_it_and_opens_nothing() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "tree.fold id=plot open=true").ok);
    let (asked, mut rt) = (g.asked.clone(), window(g.app));
    rest(&mut rt);
    let (x, y) = rt.find("tile/tree/row/beans").expect("the beans are a row of the tree");
    rt.pointer_move(x, y);
    // Not at once: a pointer passing over rows shows nothing.
    for _ in 0..6 { rt.frame(1.0 / 60.0); }
    assert!(rt.state.glance.is_none(), "100 ms is no rest");
    rest(&mut rt);
    assert_eq!(rt.state.glance.as_ref().map(|glance| (rt.state.layout.name(&glance.tile), glance.row.clone())), Some(("tree".to_string(), "beans".to_string())));
    let read = asked.borrow().iter().filter(|ask| ask["action"] == "notes.page" && ask["blockId"] == "beans").cloned().collect::<Vec<_>>();
    assert!(!read.is_empty() && read.iter().all(|ask| ask.get("watch").is_none_or(|watch| watch.is_null())), "the note is read, and not watched: {read:?}");
    let says = |rt: &Runtime<App>, key: &str| rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with(key))).filter_map(|e| e.text).map(|text| plain(&text)).collect::<Vec<_>>().join(" ");
    assert_eq!(says(&rt, "tile/tree/glance/title"), "Water the beans");
    // The card stands beside its row, inside the window, and how the note starts is drawn in it.
    let (card, row) = (rect_of(&rt, "tile/tree/glance").unwrap(), rect_of(&rt, "tile/tree/row/beans").unwrap());
    let within = |e: &rune::ElementInfo| e.rect[0] >= card[0] - 1.0 && e.rect[1] >= card[1] - 1.0 && e.rect[0] + e.rect[2] <= card[0] + card[2] + 1.0 && e.rect[1] + e.rect[3] <= card[1] + card[3] + 1.0;
    let drawn = rt.elements().into_iter().filter(within).filter_map(|e| e.text).map(|text| plain(&text)).collect::<Vec<_>>().join(" ");
    assert!(drawn.contains("Before the rain."), "how the note starts is in the card: {drawn}");
    assert!(card[0] >= row[0] + row[2] - 1.0 && card[0] + card[2] <= 1180.0, "the card {card:?} is beside the row {row:?}");
    assert_eq!(open_note(&rt.state).as_deref(), Some("plot"), "nothing was opened");
    // The pointer leaves: the card goes.
    let (rx, ry) = rt.find("tile/reader/bar").unwrap();
    rt.pointer_move(rx, ry);
    rest(&mut rt);
    assert!(rt.state.glance.is_none() && rect_of(&rt, "tile/tree/glance").is_none());
    assert!(!rt.state.act("glance row=beans tile=tree", agent()).ok, "the card follows the person's pointer");
}

/// Every story of the playground stands on its recording: a window opened over what a scratch host once answered
/// (`stories/recorded.json`), with the story's lines run, asks nothing the recording has no answer for, and is in
/// the state its name says. No host runs here.
#[test]
fn every_story_of_the_playground_stands_on_what_a_host_once_answered() {
    let stories = crate::stories::all();
    assert!(stories.len() >= 10, "the recording lists the stories: {}", stories.len());
    let story = |name: &str| crate::story(stories.iter().find(|story| story.name == name).unwrap_or_else(|| panic!("no story {name}: {:?}", stories.iter().map(|story| story.name).collect::<Vec<_>>())));
    for told in stories {
        let app = crate::story(told);
        assert!(app.online && !app.screen.is_nowhere(), "{} opens on a screen: {:?}", told.name, app.notice);
        assert!(!told.about.is_empty(), "{} says what it shows", told.name);
        assert!(app.steps.iter().all(|step| step.ok), "{}: every line of it ran: {:?}", told.name, app.steps.iter().filter(|step| !step.ok).map(|step| (step.line(), step.said.clone())).collect::<Vec<_>>());
        assert!(!app.notice.as_ref().is_some_and(|notice| notice.said.contains("a recording answers")), "{} asked what nobody recorded: {:?}", told.name, app.notice);
    }
    // Each is in the state its name says.
    assert_eq!(story("Tiles/Reader").shown().map(|page| page.title.clone()).as_deref(), Some("Seed list"));
    assert!(story("Tiles/Tree").tree().iter().any(|row| row.label == "Water the beans" && row.depth == 1), "the folder is open in the tree");
    assert!(story("Shell/A tile held by its title").moving.is_some());
    let menu = story("Shell/A tile's menu");
    assert!(menu.bar.open && menu.bar.scope == crate::bar::MENU && crate::bar::rows(&menu).iter().any(|row| row.line == "tile.close"));
    assert!(story("Shell/A notice").notice.is_some(), "the refusal is the notice");
    let card = story("Page/A thread's card");
    assert!(card.reader().is_some_and(|reader| !card.ui(&reader).unfolded.is_empty()), "the thread is shown whole");
    let glance = story("Page/A note's card on a hover");
    assert_eq!(glance.glance.as_ref().and_then(|at| glance.glanced(&at.tile)).and_then(|(_, page)| page).map(|page| page.title.clone()).as_deref(), Some("Water the beans"));
    let written = story("Page/A block being written");
    assert!(written.reader().and_then(|reader| written.completing(&reader)).is_some_and(|list| !list.rows.is_empty() && list.heading.as_deref() == Some("pages")), "the list that completes a page's name is open, with the pages the host listed");
}

/// The playground, in the window (Rune's `App::playground`), run headless as `--playground <story>` would: a story
/// opens on a stage of its own, drawn by the window's own view over the story's own state, and what is pressed
/// there acts on that state alone. The window's real state is as it was.
#[test]
fn a_story_opens_in_the_playground_on_a_state_of_its_own_and_is_pressed_there() {
    let mut rt = rune::App::new(crate::made(crate::nobody)).playground(crate::playground()).headless_runtime((1400.0, 860.0), rune::Env { system_dark: true, scale: 1.0 });
    rt.frame(0.0);
    let real = rt.state.steps.len();
    rt.open_playground("Page/A thread's card", None);
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
    let stage = rt.playground_state::<App>().expect("the story has a state of its own");
    assert_eq!(stage.shown().map(|page| page.title.clone()).as_deref(), Some("Seed list"));
    let thread = stage.reader().and_then(|reader| stage.ui(&reader).unfolded.iter().next().cloned()).expect("its thread is open");
    assert!(rt.playground_element(&format!("tile/reader/card/{thread}")).is_some(), "the thread's card is drawn on the stage");
    assert!(rt.playground_element("toolbar").is_some(), "the stage is the window's own view");
    // A press on the stage acts on the story's state: the tree's first row opens there.
    let stage_steps = rt.playground_state::<App>().unwrap().steps.len();
    let row = rt.playground_state::<App>().unwrap().tree().first().map(|row| format!("tile/tree/row/{}", row.id)).expect("the tree lists the garden");
    let at = rt.playground_element(&row).map(|e| (e.rect[0] + e.rect[2] / 2.0, e.rect[1] + e.rect[3] / 2.0)).expect("the row is on the stage");
    rt.pointer_down(at.0, at.1);
    rt.pointer_up(at.0, at.1);
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
    assert!(rt.playground_state::<App>().unwrap().steps.len() > stage_steps, "the press ran in the story");
    assert_eq!(rt.state.steps.len(), real, "the window's own state is untouched");
    // Another story, another state: the list that completes a page's name hangs in a block being written.
    rt.open_playground("Page/A block being written", None);
    for _ in 0..30 { rt.frame(1.0 / 60.0); }
    assert!(rt.playground_element("tile/reader/source").is_some(), "the block's field is on the stage");
}
