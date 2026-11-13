//! W7: extensions and outlines, and a second window. The window installs an extension from the bar's own row, uses
//! the tile its script draws, changes its settings in a form made from its schema, and removes it; switches outline
//! and comes back to a block as it was being written; and tears a tile out into a second window over the same store.
//! The host is the stand-in (`support.rs`): the same sentence against a scratch host is in `live.rs`.
use std::sync::mpsc::{Receiver, Sender, channel};

use rune::{Key, Mods};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App};
use crate::control::{self, Job, Ui};
use crate::keys::Layer;
use crate::store::OutlineAt;

fn said(app: &App) -> String { app.notice.as_ref().map(|notice| notice.said.clone()).unwrap_or_default() }
fn sent(asked: &Asked, action: &str) -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == action).cloned().collect() }

#[test]
fn waiting_is_installed_from_the_bar_s_own_row_used_configured_by_its_form_and_removed() {
    let Garden { app, asked, said: said_by_host, .. } = garden(ok());
    let mut rt = window(app);
    // The bar's Extensions is the service's list: the row that installs it carries the act line a pick runs.
    rt.update(|s, _| { s.act("bar.open scope=extensions", Actor::Person); });
    rest(&mut rt);
    let rows = crate::bar::rows(&rt.state);
    assert_eq!(rows.iter().map(|row| (row.label.as_str(), row.line.as_str())).collect::<Vec<_>>(), [("Install Waiting", "extensions.install id=\"waiting\"")], "a row with nothing to run is no row of a bar: {rows:?}");
    press(&mut rt, "bar/row/extensions/install:waiting");
    assert_eq!(sent(&asked, "extensions.install").last().map(|a| (a["extension"].clone(), a["mutation"]["author"].clone())), Some((json!("waiting"), json!("user"))));
    assert_eq!(said(&rt.state), "Installed Waiting. copied it into this outline's extensions · wrote its page and 2 demo notes under Extensions", "what it did, in the service's words");
    // What it adds is here without the window being told what Waiting is: its screen, and a kind the view drawer draws.
    assert!(rt.state.screens().iter().any(|screen| screen.name == "waiting") && rt.state.kind_row("waiting.list").is_some_and(|row| row.drawer.as_deref() == Some("view")));
    let parts: Vec<(String, String)> = rt.state.extensions().unwrap().entry("waiting").unwrap().parts().into_iter().map(|part| (part.part.to_string(), part.name)).collect();
    assert_eq!(parts, [("screen".into(), "waiting".into()), ("kind".into(), "waiting.list".into()), ("setting".into(), "warn-days".into())], "each thing it adds is a row");

    // Used: its screen opens, its tile is what its script draws, and a row picked opens beside (the screen's own wire).
    rt.update(|s, _| { s.act("screen.open name=waiting", Actor::Person); });
    rest(&mut rt);
    assert_eq!(sent(&asked, "tiles.view").last().map(|a| (a["kind"].clone(), a["watch"].is_string())), Some((json!("waiting.list"), true)));
    assert!(rt.find("tile/waiting/part/beans").is_some(), "the view's list is drawn by the list drawer, a row keyed by the note it opens: {:?}", rt.elements().into_iter().filter_map(|e| e.key).filter(|key| key.starts_with("tile/waiting")).collect::<Vec<_>>());
    press(&mut rt, "tile/waiting/part/beans");
    assert_eq!(rt.state.note_of(&rt.state.layout.named("reader").unwrap()).as_deref(), Some("beans"));

    // Configured: its settings row opens a form made from its schema, a field as the schema names it. (The list of
    // extensions is watched: the host says it moved, as it does when one is installed.)
    changed(&mut rt.state, &said_by_host, &watch_of(&asked, "lists.read", |a| a["from"] == "extensions"), 9);
    rt.update(|s, _| { s.act("bar.open scope=extensions", Actor::Person); });
    rest(&mut rt);
    assert_eq!(crate::bar::rows(&rt.state).iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["Waiting", "Settings of Waiting"]);
    press(&mut rt, "bar/row/extensions/settings:waiting");
    assert_eq!((rt.state.person().layer, rt.state.bar.open), (Layer::Form, false));
    let form = rt.state.form.as_ref().expect("the form is open");
    assert_eq!((form.extension.as_str(), form.fields.iter().map(|field| (field.name.as_str(), field.edit.words())).collect::<Vec<_>>()), ("waiting", vec![("warn-days", "")]));
    assert!(rt.find("form/field/warn-days").is_some() && rt.find("form/about/warn-days").is_some() && rt.find("form/save").is_some());
    // Words that are no value of the field never leave, and a value the service refuses keeps the form: every word stays, with why.
    typed(&mut rt, "soon");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!((sent(&asked, "extensions.configure").len(), rt.state.form.as_ref().and_then(|form| form.said.clone()).as_deref()), (0, Some("warn-days is a whole number, not soon")));
    rt.update(|s, _| { s.field(&crate::actions::Field::Form("warn-days".into())).replace("0"); s.typed(&crate::actions::Field::Form("warn-days".into())); });
    chord(&mut rt, Key::Enter, Mods::default());
    let form = rt.state.form.as_ref().expect("refused, the form stays");
    assert_eq!((form.fields[0].edit.words(), form.said.as_deref()), ("0", Some("config.json: config doesn't match the config schema in extension.json (warn-days must be >= 1)")));
    rt.update(|s, _| { s.field(&crate::actions::Field::Form("warn-days".into())).replace("1"); s.typed(&crate::actions::Field::Form("warn-days".into())); });
    let views = sent(&asked, "tiles.view").len();
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(sent(&asked, "extensions.configure").last().map(|a| (a["extension"].clone(), a["set"].clone(), a["unset"].clone())), Some((json!("waiting"), json!({ "warn-days": 1 }), json!([]))), "the value its type says, not words");
    assert!(rt.state.form.is_none() && said(&rt.state) == "Saved Waiting's settings: warn-days=1.");
    assert!(sent(&asked, "tiles.view").len() > views, "its tile is read again: the script reads the setting");
    assert_eq!(control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().find(|tile| tile["name"] == "waiting").map(|tile| tile["facts"]["rows"][0]["act"].clone()), Some(json!("open id=\"beans\"")));

    // Removed by an act line, as an agent, and said: what is left is its tile, drawn as its spec, and its screen is gone.
    rt.update(|s, _| { assert!(s.act("extensions.uninstall demo=keep id=waiting", Actor::Agent("compost-agent".into())).ok); s.settle(); });
    rest(&mut rt);
    assert_eq!(sent(&asked, "extensions.uninstall").last().map(|a| (a["demo"].clone(), a["mutation"].clone())), Some((json!("keep"), json!({ "author": "agent", "actorId": "compost-agent" }))));
    assert_eq!(said(&rt.state), "Removed Waiting. removed its folder · kept its 2 demo notes under its page · kept its settings for a reinstall");
    assert!(!rt.state.screens().iter().any(|screen| screen.name == "waiting") && rt.state.kind_row("waiting.list").is_none());
    assert!(rt.find("tile/waiting/data").is_some(), "the tile nobody draws now is its spec, as data: nothing is hidden");
    // An agent reads an extension's settings by the same act; with none installed it is told so.
    assert_eq!(rt.state.act("extensions.configure id=waiting", Actor::Agent("compost-agent".into())).said, "no extension waiting is installed here · the bar's Extensions lists the ones that are, and installs waiting");
}

#[test]
fn a_setting_typed_is_the_value_its_type_says() {
    let listed: crate::ext::Extensions = serde_json::from_value(json!({ "extensions": [{ "id": "greenhouse", "state": "active", "settings": { "fields": [
        { "name": "vents", "type": "boolean", "state": "unset" }, { "name": "heat", "type": "number", "default": 18.5, "state": "default" },
        { "name": "pump", "type": "command", "state": "unset" }, { "name": "beds", "type": "json", "state": "unset" }, { "name": "label", "type": "string", "choices": ["north", "south"], "required": true, "state": "missing" }] } }] })).unwrap();
    let field = |name: &str| listed.entry("greenhouse").unwrap().settings.as_ref().unwrap().fields.iter().find(|field| field.name == name).unwrap();
    assert_eq!(field("vents").typed("yes"), Ok(json!(true)));
    assert_eq!(field("heat").typed(" 21.5 "), Ok(json!(21.5)));
    assert_eq!(field("pump").typed("mist --for 30s"), Ok(json!(["mist", "--for", "30s"])));
    assert_eq!(field("beds").typed("[1, 2]"), Ok(json!([1, 2])));
    assert!(field("beds").typed("one, two").is_err() && field("vents").typed("maybe").is_err());
    assert_eq!((field("heat").about(), field("label").about()), ("number · left empty: 18.5".to_string(), "north, south · needed".to_string()));
}

#[test]
fn a_window_switches_outline_and_comes_back_to_a_block_as_it_was_being_written() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-outlines-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let Garden { mut app, asked, elsewhere, .. } = garden_kept(ok(), &dir.join("native-garden.layout.json"));
    // A block half-written and an arrangement of the person's own, on the garden.
    act(&mut app, "tile.split");
    act(&mut app, "edit");
    write(&mut app, "Plot [type::chore]\nBefore the rain, lift the");
    let (tiles, held) = (app.layout.names.0.len(), sent(&asked, "drafts.hold").len());
    assert!(dir.join("native-garden.drafts.json").exists(), "kept as typed");

    // Only an outline the service lists is opened: a name nobody has is refused, nothing is made, and no way is asked for.
    act(&mut app, "outline.switch name=meadow");
    assert_eq!((app.at.outline.as_str(), elsewhere.borrow().len()), ("garden", 0));
    assert_eq!(said(&app), "No outline named meadow here, and none is made by asking. There are: allotment, garden, orchard on shed-box. (ep0ch outline create meadow makes one on purpose.)");
    // One on a machine nobody reaches stays where it is, with why; the block is still being written.
    act(&mut app, "outline.switch name=orchard machine=shed-box");
    assert_eq!((app.at.outline.as_str(), said(&app).as_str()), ("garden", "Still on garden: can't reach the outline host on shed-box: no route to it from here"));
    assert_eq!(words(&app), "Plot [type::chore]\nBefore the rain, lift the");

    // The bar's Outlines are the service's rows: a pick switches.
    act(&mut app, "bar.open scope=outlines");
    let row = crate::bar::rows(&app).into_iter().find(|row| row.label == "allotment").expect("the allotment is listed");
    assert_eq!(row.line, "outline.switch name=\"allotment\"");
    act(&mut app, "bar.pick source=outlines key=allotment");
    assert_eq!((app.at.clone(), app.online), (OutlineAt { outline: "allotment".into(), machine: String::new() }, true));
    assert_eq!(app.store().links().iter().map(|at| at.outline.clone()).collect::<Vec<_>>(), ["allotment", "garden"], "a link an outline, in one store");
    // The outline left let go of its holds and kept every word; the one come to opens on its start screen.
    assert_eq!(sent(&asked, "drafts.release").len(), 1);
    assert!(app.drafts.is_empty() && app.parked.len() == 1 && !app.screen.is_nowhere());
    let there = elsewhere.borrow()["allotment"].0.clone();
    assert!(there.borrow().iter().all(|a| a["outline"] == "allotment") && actions(&there).contains(&"screens.list".to_string()) && actions(&there).contains(&"events.subscribe".to_string()));
    assert_eq!(app.notice.as_ref().and_then(|notice| notice.undo.clone()).as_deref(), Some("outline.switch name=garden machine=\"\""), "the notice carries the way back");
    assert_eq!(crate::actions::label("outline.switch name=garden machine=\"\""), "Switch outline", "and its button is called what the action's row calls it, never the action's id");
    assert!(dir.join("native-allotment.layout.json").exists(), "each outline's arrangement is a file of its own");

    // Back: the arrangement as it was left, the block in its tile with every word, held again; nothing was asked of anybody.
    let known = sent(&asked, "outlines.known").len();
    act(&mut app, "outline.switch name=garden machine=\"\"");
    assert_eq!((app.at.outline.as_str(), app.layout.names.0.len(), words(&app)), ("garden", tiles, "Plot [type::chore]\nBefore the rain, lift the"));
    assert_eq!((sent(&asked, "drafts.hold").len(), sent(&asked, "outlines.known").len(), app.parked.keys().map(|at| at.outline.clone()).collect::<Vec<_>>()), (held + 1, known, vec!["allotment".to_string()]));
    assert!(unsaved(&app) && draft(&app).is_some_and(|draft| draft.buf.takes_keys()));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_tile_torn_out_is_a_second_window_over_the_same_store_with_a_link_an_outline() {
    let Garden { mut app, asked, elsewhere, .. } = garden(ok());
    act(&mut app, "open id=shed");
    let before = (app.layout.names.0.len(), actions(&asked).iter().filter(|action| *action == "events.subscribe").count());
    // The tile leaves this window by the layout's own rule, and is a window of its own showing what it showed.
    let torn = act(&mut app, "tile.tear tile=reader");
    assert_eq!(torn.answer, json!({ "window": "reader", "tile": "reader" }));
    let mut born = app.born();
    let mut second = born.pop().expect("the act asked for a window");
    second.settle();
    assert_eq!((app.layout.names.0.len(), second.layout.names.0.len(), second.window(), second.store().windows()), (before.0 - 1, 1, "reader".to_string(), vec!["main".to_string(), "reader".to_string()]));
    assert_eq!(second.subject().as_deref(), Some("shed"), "it shows the note it showed");
    // One store: the page both windows read is one slot, the link is registered once, and the budget is one.
    assert_eq!(actions(&asked).iter().filter(|action| *action == "events.subscribe").count(), before.1);
    let peek = second.store().peek();
    assert_eq!(peek["budget"].as_array().map(Vec::len), Some(1));
    assert!(peek["slots"].as_array().unwrap().iter().any(|slot| slot["tiles"].as_array().unwrap().iter().any(|tile| tile.as_str().is_some_and(|tile| tile.starts_with("main/")))), "the first window's tiles are named with their window: {}", peek["slots"]);
    // A window keeps its only tile, in the layout's words, and a block is written in one window at a time.
    let alone = act(&mut second, "tile.tear");
    assert!(!alone.ok && second.born().is_empty(), "{}", alone.said);
    assert!(act(&mut second, "edit").ok);
    act(&mut app, "tile.split");
    act(&mut app, "open id=shed");
    assert_eq!(act(&mut app, "edit").said, "the note is being written in another window (reader): save or close it there first");
    assert!(act(&mut second, "edit.close").ok && act(&mut app, "edit").ok && act(&mut app, "edit.close").ok, "let go there, it is written here");

    // The second window drawn, headless: its tile, its toolbar, its own keys.
    let mut rt = window(second);
    assert!(rt.find("tile/reader").is_some() && rt.find("tile/reader/note").is_some());
    // It switches outline: the store has two links, the first window stays where it was and online.
    rt.update(|s, _| { s.act("outline.switch name=allotment", Actor::Person); });
    rt.state.settle();
    rest(&mut rt);
    assert_eq!((rt.state.at.outline.as_str(), app.at.outline.as_str(), app.online), ("allotment", "garden", true));
    assert_eq!(app.store().links().iter().map(|at| at.outline.clone()).collect::<Vec<_>>(), ["allotment", "garden"]);
    app.settle();
    let budget = app.store().peek()["budget"].clone();
    assert_eq!(budget.as_array().unwrap().iter().map(|link| link["outline"].clone()).collect::<Vec<_>>(), [json!("allotment"), json!("garden")], "two links, each its own 64 keys: {budget}");
    assert!(elsewhere.borrow().contains_key("allotment"));
    // The window closed, the store forgets it: nothing of its is wanted, and the first window is the only one.
    drop(rt);
    assert_eq!(app.store().windows(), ["main"]);
    act(&mut app, "open id=beans");
    assert!(app.store().peek()["slots"].as_array().unwrap().iter().all(|slot| slot["tiles"].as_array().unwrap().iter().all(|tile| !tile.as_str().unwrap().contains('/'))));
}

/// Two windows, each a queue of jobs: the control socket's way onto the one a request names.
#[derive(Clone)]
struct Two(Sender<Job>, Sender<Job>);

impl Ui for Two {
    fn run(&self, window: Option<&str>, job: Job) -> Result<(), String> {
        match window { None | Some("main") => { let _ = self.0.send(job); Ok(()) } Some("reader") => { let _ = self.1.send(job); Ok(()) } Some(other) => Err(format!("no window named {other}: the windows are main, reader")) }
    }
}

#[test]
fn the_control_socket_names_which_window_an_act_is_for() {
    use std::io::{BufRead, BufReader, Write};
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "tile.tear tile=reader");
    let second = app.born().pop().unwrap();
    let (mut first, mut second) = (window(app), window(second));
    let dir = std::env::temp_dir().join(format!("ep0ch-native-windows-{}", std::process::id()));
    let path = dir.join("native.sock");
    let (to_first, firsts): (Sender<Job>, Receiver<Job>) = channel();
    let (to_second, seconds): (Sender<Job>, Receiver<Job>) = channel();
    let _control = control::serve(&path, Two(to_first, to_second)).expect("the socket is served");
    let mut ask = |request: Value| -> Value {
        let mut stream = std::os::unix::net::UnixStream::connect(&path).unwrap();
        writeln!(stream, "{request}").unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
        stream.set_read_timeout(Some(std::time::Duration::from_millis(20))).unwrap();
        let mut line = String::new();
        // The test is both windows' UI threads: it runs each window's jobs until the answer is in.
        while std::time::Instant::now() < until {
            for job in firsts.try_iter() { first.update(move |s, tx| job(s, tx)); }
            for job in seconds.try_iter() { second.update(move |s, tx| job(s, tx)); }
            if reader.read_line(&mut line).is_ok_and(|n| n > 0) && line.ends_with('\n') { break }
        }
        serde_json::from_str(&line).unwrap_or_else(|e| panic!("{line:?}: {e}"))
    };
    // Left unsaid, a request is the first window's; `window` names another, in the request or among an act's words.
    assert_eq!(ask(json!({ "cmd": "peek" }))["result"]["screen"]["window"], "main");
    let peeked = ask(json!({ "cmd": "peek", "window": "reader" }));
    assert_eq!((peeked["result"]["screen"]["window"].clone(), peeked["result"]["screen"]["windows"].clone()), (json!("reader"), json!(["main", "reader"])));
    let acted = ask(json!({ "cmd": "act", "action": "open", "args": { "id": "beans", "window": "reader" }, "as": "compost-agent" }));
    assert_eq!(acted["ok"], true, "{acted}");
    assert_eq!(ask(json!({ "cmd": "peek", "window": "reader" }))["result"]["screen"]["steps"].as_array().unwrap().last().map(|step| (step["line"].clone(), step["by"].clone())), Some((json!("open id=beans"), json!("agent:compost-agent"))), "the word that named the window is no argument of the act");
    assert!(ask(json!({ "cmd": "peek" }))["result"]["screen"]["steps"].as_array().unwrap().iter().all(|step| step["by"] != "agent:compost-agent"), "the first window ran nothing of it");
    // A name no window has is refused with the ones there are.
    let nobody = ask(json!({ "cmd": "act", "action": "back", "window": "greenhouse" }));
    assert_eq!((nobody["ok"].clone(), nobody["error"].clone()), (json!(false), json!("no window named greenhouse: the windows are main, reader")));
    drop(ask);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_torn_window_that_switches_outline_keeps_no_arrangement_there_and_what_is_written_in_it_is_its_own() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-torn-switch-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let Garden { mut app, .. } = garden_kept(ok(), &dir.join("native-garden.layout.json"));
    act(&mut app, "open id=shed");
    act(&mut app, "tile.tear tile=reader");
    let mut second = app.born().pop().expect("the act asked for a window");
    second.settle();
    // The torn window goes to another outline: it keeps no arrangement there either (that file is the first
    // window's), and a block written in it there is kept in a file of this window's own.
    act(&mut second, "outline.switch name=allotment");
    assert_eq!(second.at.outline, "allotment");
    assert!(!dir.join("native-allotment.layout.json").exists(), "a torn window wrote the arrangement the first window keeps for that outline");
    act(&mut second, "open id=beans");
    assert!(act(&mut second, "edit").ok);
    write(&mut second, "Water the beans [type::chore]\nBefore the rain, and after");
    assert!(dir.join("native-allotment.reader.drafts.json").exists() && !dir.join("native-allotment.drafts.json").exists(), "its words are kept in its own file: {:?}", std::fs::read_dir(&dir).unwrap().flatten().map(|entry| entry.file_name()).collect::<Vec<_>>());
    // The first window comes to that outline while the block is being written in the other: it takes nothing of it.
    act(&mut app, "outline.switch name=allotment");
    assert_eq!((app.at.outline.as_str(), app.drafts.len(), app.recovered.len()), ("allotment", 0, 0), "a block being written in another window is not brought back in this one");
    assert_eq!(words(&second), "Water the beans [type::chore]\nBefore the rain, and after");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_window_closed_while_a_block_was_written_in_it_holds_nothing_afterwards() {
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "open id=shed");
    act(&mut app, "tile.tear tile=reader");
    let mut second = app.born().pop().expect("the act asked for a window");
    second.settle();
    assert!(act(&mut second, "edit").ok);
    // Closed by its own button, the block still open in it: the store forgets the window and what it held.
    drop(second);
    act(&mut app, "tile.split");
    act(&mut app, "open id=shed");
    // Another tile torn out is another window: it never held that block.
    act(&mut app, "tile.split");
    let torn = act(&mut app, "tile.tear");
    assert!(torn.ok, "{}", torn.said);
    let _third = app.born().pop().expect("the act asked for a window");
    act(&mut app, "open id=shed");
    let edit = act(&mut app, "edit");
    assert!(edit.ok, "the block is nobody's now: {}", edit.said);
}
