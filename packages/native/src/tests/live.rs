//! The window against a real outline host: the socket, the handshake, a page, a save through the dispatcher, and a
//! change made by someone else arriving as a watched answer.
use std::time::Duration;

use serde_json::{Value, json};

use super::support::{act, unsaved, words, write};

/// The window has opened on a screen: the host's extensions may still be loading when the window first asks, and
/// the watched list says so when they have.
fn opened(app: &mut App) {
    for _ in 0..200 { if !app.screen.is_nowhere() && !app.kinds().is_empty() { return } std::thread::sleep(Duration::from_millis(50)); app.settle(); }
    panic!("no screen opened: {:?}", app.notice);
}
use crate::actions::{App, Tone};
use crate::client::Link;

/// The window against a scratch outline host this test starts (`bun src/host-main.ts` in a temp folder): the socket,
/// the handshake, `notes.page`, a save, and a change made by someone else arriving as a watched answer.
/// `cargo test -- --ignored live` (it needs bun and the checkout around this crate).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_the_window_reads_writes_and_hears_changes_over_the_socket() {
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        // The host makes the outline (a connection of its own: a connection belongs to the outline its first line names).
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        // Another client's connection: it writes the notes, and later edits one.
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let shed = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Shed [type::place]\nWhere the tools live.", "author": "user" }));
        let chore = ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": shed["id"], "text": "Lift the onions [type::chore] [state::todo]", "author": "user" }));
        let plan = ask(json!({ "id": "d", "action": "create", "outline": "scratch", "parentId": null, "author": "user",
            "text": format!("Plan [type::plan]\nStart at the (({})).\n\n::links{{query=\"type=chore state=todo\" title=\"To do\"}}\n::", shed["id"].as_str().unwrap()) }));

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        assert!(app.online && !app.machine.is_empty(), "{:?}", app.notice);
        act(&mut app, &format!("open id={}", plan["id"].as_str().unwrap()));
        let page = app.page().expect("the page came");
        assert_eq!(page.title, "Plan");
        let todo = |app: &App| -> Vec<String> { app.page().unwrap().parts.iter().filter(|part| part["view"]["type"] == "list").flat_map(|part| part["view"]["rows"].as_array().cloned().unwrap_or_default()).map(|row| row["label"].as_str().unwrap_or("").to_string()).collect() };
        assert_eq!(todo(&app), ["Lift the onions"]);
        assert!(page.parts[0]["view"]["text"].as_str().is_some_and(|text| text.contains(&format!("[Shed](ep0ch:b/{})", shed["id"].as_str().unwrap()))));

        // The bar's notes are the service's search: what a word typed costs, said for the record (DESIGN.md §7).
        let asked = std::time::Instant::now();
        act(&mut app, "bar.open scope=search query=onions");
        let rows = crate::bar::rows(&app);
        eprintln!("the bar's search for one word answered {} row(s) in {:.1} ms, over the socket", rows.len(), asked.elapsed().as_secs_f64() * 1000.0);
        assert!(rows.iter().any(|row| row.label == "Lift the onions" && row.line == format!("open id=\"{}\"", chore["id"].as_str().unwrap())), "{rows:?}");
        act(&mut app, "bar.close");

        // This window writes: saved at the revision it read, and the page it shows is the saved one.
        act(&mut app, "edit");
        let text = format!("{}\n\nBring the trug.", words(&app));
        write(&mut app, &text);
        act(&mut app, "edit.save");
        assert!(!unsaved(&app) && app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.starts_with("Saved")), "{:?}", app.notice);
        assert!(app.page().unwrap().text.ends_with("Bring the trug."));
        assert!(act(&mut app, "edit.close").ok);

        // Someone else finishes the chore: no edit to the open note, yet its page is told and read again.
        ask(json!({ "id": "e", "action": "update", "outline": "scratch", "blockId": chore["id"], "text": "Lift the onions [type::chore] [state::done]", "expectedRevision": chore["revision"], "mutation": { "author": "user" } }));
        let mut app = app.blocking(false);
        for _ in 0..100 {
            std::thread::sleep(Duration::from_millis(50));
            app.take();
            if todo(&app).is_empty() { break }
        }
        assert!(todo(&app).is_empty(), "the watched page moved without this window asking why");
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}


/// The wave's sentence against a real outline host: the window is split and rearranged, saved as a screen note (the
/// service writes the block form), listed back as the same layout, broken by someone else editing a block of the
/// note, read as a problem on the tile, put right and reset. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_screen_is_saved_as_a_note_listed_broken_and_reset_over_the_socket() {
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-screens-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let shed = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Shed [type::place]\nWhere the tools live.", "author": "user" }));
        ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": shed["id"], "text": "Lift the onions [type::chore]", "author": "user" }));

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        assert!(app.online, "{:?}", app.notice);
        // Split the reader, put the tree in a tab with the backlinks in the dock, and save it.
        for line in ["tile.split", "tile.move side=center to=backlinks tile=tree", "screen.save name=\"Garden work\""] { let done = act(&mut app, line); assert!(done.ok, "{line}: {}", done.said) }
        assert!(app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.starts_with("Saved the screen garden-work")), "{:?}", app.notice);
        let (note, _) = app.screen.note().map(|(id, revision)| (id.to_string(), revision)).expect("the arrangement is the note's screen now");
        // The note is the block form: its header, then the layout as blocks under it.
        let header = ask(json!({ "id": "d", "action": "get", "outline": "scratch", "blockId": note }));
        assert!(header["text"].as_str().unwrap().starts_with("Garden work [type::screen] [screen::garden-work]") && header["text"].as_str().unwrap().contains("[focus::tree]"), "the tile moved last has the keys: {header}");
        let kids = |ask: &mut dyn FnMut(Value) -> Value, id: &str, n: &str| ask(json!({ "id": n, "action": "children", "outline": "scratch", "parentId": id }));
        let under = kids(&mut ask, &note, "e");
        assert!(under[0]["text"].as_str().unwrap().starts_with("split row"), "{under}");
        // The service lists it back, and its layout is the arrangement as it stands.
        let listed = app.screens().into_iter().find(|s| s.name == "garden-work").expect("the screen is listed");
        assert_eq!((listed.title.as_str(), listed.problems.len()), ("Garden work", 0), "{:?}", listed.problems);
        // (Each tile's kind as the service's row names it: the list serves a kind resolved, with its role.)
        fn resolved(app: &App, node: &mut Value) {
            if node["t"] == "leaf" { if let Some(row) = node["kind"].as_str().and_then(|kind| app.kind_row(kind)) { node["kind"] = json!(row.kind); node["role"] = json!(row.written()) } }
            for key in ["kids", "tabs"] { if let Some(kids) = node.get_mut(key).and_then(Value::as_array_mut) { for kid in kids { resolved(app, kid) } } }
            if let Some(kid) = node.get_mut("kid") { resolved(app, kid) }
        }
        let (mut read, mut held) = (listed.layout().unwrap().save(), app.layout.save());
        resolved(&app, &mut read["root"]);
        resolved(&app, &mut held["root"]);
        assert_eq!(read, held, "the note reads back as the layout it was saved from");

        // Someone else misspells a kind in the note: the first tile block they find that is the second reader.
        fn find(ask: &mut dyn FnMut(Value) -> Value, id: &str, n: &mut u32) -> Option<Value> {
            *n += 1;
            let kids = ask(json!({ "id": format!("k{n}"), "action": "children", "outline": "scratch", "parentId": id }));
            for kid in kids.as_array().into_iter().flatten() {
                if kid["text"].as_str().is_some_and(|t| t.starts_with("tile reader [name::reader2]")) { return Some(kid.clone()) }
                if let Some(found) = find(ask, kid["id"].as_str().unwrap(), n) { return Some(found) }
            }
            None
        }
        let tile = find(&mut ask, &note, &mut 0).expect("the second reader's block");
        ask(json!({ "id": "f", "action": "update", "outline": "scratch", "blockId": tile["id"], "text": "tile raeder [name::reader2]", "expectedRevision": tile["revision"], "mutation": { "author": "user" } }));
        let mut app = app.blocking(false);
        let said = |app: &App| app.screens().into_iter().find(|s| s.name == "garden-work").map(|s| s.problems.iter().map(|p| (p.tile.clone(), p.said.clone())).collect::<Vec<_>>()).unwrap_or_default();
        for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); app.take(); if !said(&app).is_empty() { break } }
        assert_eq!(said(&app), [(Some("reader2".to_string()), "no tile kind raeder here · did you mean reader?".to_string())], "the watched list moved, and says what is wrong for the tile");
        // Laid out again as the note has it, the tile says why.
        let mut app = app.blocking(true);
        assert!(act(&mut app, "screen.reset").ok);
        assert_eq!((app.spec("reader2").map(|s| s.kind.as_str()), app.problems_of("reader2")), (Some("raeder"), vec!["no tile kind raeder here · did you mean reader?".to_string()]));
        // Put right, the list says nothing is wrong, and reset reads again.
        let again = ask(json!({ "id": "g", "action": "get", "outline": "scratch", "blockId": tile["id"] }));
        ask(json!({ "id": "h", "action": "update", "outline": "scratch", "blockId": tile["id"], "text": "tile reader [name::reader2]", "expectedRevision": again["revision"], "mutation": { "author": "user" } }));
        let mut app = app.blocking(false);
        for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); app.take(); if said(&app).is_empty() { break } }
        let mut app = app.blocking(true);
        assert!(act(&mut app, "screen.reset").ok);
        assert_eq!((app.kind_of("reader2").map(|row| row.written()), app.problems_of("reader2").len()), (Some("reader"), 0));
        // Saved again, it is the same note, written over at the revision read.
        assert!(act(&mut app, "tile.close tile=reader2").ok);
        assert!(act(&mut app, "screen.save").ok);
        assert!(app.notice.as_ref().is_some_and(|n| n.said.starts_with("Saved over the screen garden-work")), "{:?}", app.notice);
        assert_eq!(app.screen.note().map(|(id, _)| id.to_string()), Some(note));
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// A note's buttons against a real host: one whose act line this window has runs here, recorded as whoever pressed;
/// one with steps is the service's to run, and the act its run sends back is run by this window's dispatcher and
/// answered, so the run ends and says so.
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_button_runs_here_and_one_with_steps_is_run_by_the_service_and_answered_over_the_socket() {
    use crate::actions::Actor;
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-buttons-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let shed = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Shed [type::place]\nWhere the tools live.", "author": "user" }));
        let shed = shed["id"].as_str().unwrap().to_string();
        let plan = ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": null, "author": "user",
            "text": format!("Plan [type::plan]\n::button{{label=\"Sow the peas\" act=\"note.new text=Peas\"}}\n\n::button{{label=\"Open the shed\"}}\nopen id={shed}\n::") }));
        let plan = plan["id"].as_str().unwrap().to_string();

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        assert!(act(&mut app, &format!("open id={plan}")).ok);
        let framed: Vec<(String, u64, bool)> = app.page().expect("the page came").parts.iter().map(|part| (part["view"]["type"].as_str().unwrap_or("").to_string(), part["line"].as_u64().unwrap(), part["sequence"] == true)).collect();
        assert_eq!(framed, [("button".to_string(), 1, false), ("button".to_string(), 3, true)], "the service found both buttons and says which is its own to run");
        let reader = app.reader().unwrap();
        let said = |app: &App| app.ui(&reader).said.clone().map(|said| (said.words, said.ok));

        // An agent presses the first: its act line runs here, and the note it makes is recorded as the agent's.
        let outcome = app.act("button.press label=\"Sow the peas\"", Actor::Agent("compost-agent".into()));
        assert!(outcome.ok && outcome.answer["ran"] == "here", "{} {}", outcome.said, outcome.answer);
        app.settle();
        assert_eq!(said(&app), Some(("Sow the peas ran note.new text=Peas, as an agent (compost-agent)".to_string(), true)));
        for _ in 0..100 { if app.page().is_some_and(|page| page.under.is_some()) { break } std::thread::sleep(Duration::from_millis(50)); app.take(); }
        let made = app.page().unwrap().under.as_ref().and_then(|under| under["rows"][0]["id"].as_str()).expect("the note it made is under the plan").to_string();
        let record = ask(json!({ "id": "d", "action": "blocks.records", "outline": "scratch", "ids": [made] }));
        assert_eq!((record["records"][0]["author"].as_str(), record["records"][0]["actor"].as_str()), (Some("agent"), Some("compost-agent")), "{record}");

        // The person presses the second: the service runs its step, which is an act for this window. It comes back
        // as a call, the dispatcher runs it (the reader opens the shed) and answers, and the run says it is done.
        let outcome = act(&mut app, "button.press line=4");
        assert!(outcome.ok && outcome.answer["ran"] == "service", "{} {}", outcome.said, outcome.answer);
        for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); app.take(); if said(&app).is_some_and(|(words, _)| !words.ends_with("running…")) && app.subject().as_deref() == Some(shed.as_str()) { break } }
        assert_eq!(app.subject().as_deref(), Some(shed.as_str()), "the run's open ran here: {:?}", said(&app));
        let (words, ok) = said(&app).unwrap();
        assert!(ok && words.starts_with("Open the shed ran, as you"), "{words}");
        let step = app.steps.iter().rev().find(|step| step.action == "open").unwrap();
        // The act is the script's, recorded so. It came from the tile the press was made in, which only the press's
        // invitation says: the service carried it with the run's act, and this window knew it for its own.
        assert!(step.ok && matches!(&step.by, Actor::Agent(script) if script.starts_with("script:")), "a pressed script's act is the script's: {:?}", step.by);
        assert_eq!(step.tile.as_deref(), Some("reader"), "the run's act came from the press's tile, on its invitation: {}", step.line());
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}


/// W3's sentence against a real outline host with the screens extension it ships: the window opens on the screen
/// the extension says windows start on, its tree, properties and links are lists the service answers, and the
/// navigator, the board and last callers open from the bar's Screens. The lanes are grouped by a property name the
/// screen names, and regrouped by another the test picks. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_the_shipped_screens_open_from_the_bar_and_every_list_is_the_service_s() {
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-lists-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let beds = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Beds", "author": "user" }));
        let north = ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": beds["id"], "text": "North bed [type::bed] [work-stage::doing] [crop::peas]", "author": "user" }));
        ask(json!({ "id": "d", "action": "create", "outline": "scratch", "parentId": beds["id"], "text": "South bed [type::bed] [work-stage::next] [crop::beans]", "author": "user" }));
        ask(json!({ "id": "e", "action": "create", "outline": "scratch", "parentId": null, "author": "user", "text": format!("Seed list\nPeas go in (({})) first.", north["id"].as_str().unwrap()) }));
        ask(json!({ "id": "f", "action": "update", "outline": "scratch", "blockId": north["id"], "text": "North bed [type::bed] [work-stage::doing] [crop::peas]\nSown on Tuesday.", "expectedRevision": north["revision"], "mutation": { "author": "user" } }));

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        assert!(app.online, "{:?}", app.notice);
        // It opened on the screen the extension says windows start on; every kind it names is a served row with a drawer here.
        let names = |app: &App| app.layout.all().iter().map(|id| app.layout.name(id)).collect::<Vec<_>>();
        assert!(app.screen.starts() && matches!(&app.screen.from, crate::screen::From::Extension(_)), "{:?}", app.screen.from);
        assert_eq!(names(&app), ["tree", "reader", "props", "backlinks", "threads", "proposals", "revisions"]);
        for tile in app.layout.all() { assert!(app.drawer_of(&tile).is_some() && app.problems_of(&tile).is_empty(), "{tile}: {:?}", app.problems_of(&tile)) }
        // The tree is one list: unfolded, the same list with the folder's notes under it.
        assert!(app.tree().iter().any(|row| row.label == "Beds" && row.folds) && !app.tree().iter().any(|row| row.label == "North bed"));
        let north = north["id"].as_str().unwrap().to_string();
        assert!(act(&mut app, &format!("open id={north}")).ok);
        assert!(app.tree().iter().any(|row| row.id == north && row.depth == 1), "the way to the open note unfolded: {:?}", app.tree().iter().map(|r| (r.depth, r.label.clone())).collect::<Vec<_>>());
        // What is about the open note: its properties as a table, and the notes that link to it.
        assert!(app.rows_of("props").iter().any(|row| row.label == "crop" && row.detail.as_deref() == Some("peas")), "{:?}", app.rows_of("props"));
        assert_eq!(app.list_of("props").map(|a| a.list.arrange.as_str()), Some("table"));
        assert_eq!(app.rows_of("backlinks").iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["Seed list"]);

        // The bar's Screens lists what the service lists; each row opens one.
        assert!(act(&mut app, "bar.open scope=screens").ok);
        let rows = crate::bar::rows(&app);
        let listed: Vec<String> = rows.iter().map(|row| row.key.clone()).collect();
        for screen in ["board", "lastcall", "navigator"] { assert!(listed.iter().any(|key| key == screen), "{screen} is among {listed:?}") }
        let pick = |app: &mut App, screen: &str| { assert!(act(app, "bar.open scope=screens").ok); let done = act(app, &format!("bar.pick source=screens key={screen}")); assert!(done.ok, "{screen}: {}", done.said); };

        // The board: lanes grouped by the property its screen names, then by another picked here by name.
        pick(&mut app, "board");
        assert_eq!(names(&app), ["lanes", "reader"]);
        let board = app.list_of("lanes").expect("the lanes came").clone();
        assert_eq!(board.list.arrange, "lanes");
        let mut lanes: Vec<(String, u64)> = board.list.groups.iter().map(|g| (g.name.clone(), g.count)).collect();
        lanes.sort();
        assert_eq!(lanes, [("doing".to_string(), 1), ("next".to_string(), 1)]);
        assert!(act(&mut app, "list.group by=crop tile=lanes").ok);
        let mut by_crop: Vec<String> = app.list_of("lanes").unwrap().list.groups.iter().map(|g| g.name.clone()).collect();
        by_crop.sort();
        assert_eq!(by_crop, ["beans", "peas"], "grouped by another property, by its name alone");
        // A card picked opens where the lanes' opens land.
        assert!(act(&mut app, &format!("list.pick id={north} tile=lanes")).ok);
        assert_eq!(app.note_of("reader").as_deref(), Some(north.as_str()));
        // Arranged as a table where its screen names no columns: the service says them, the title and then the
        // properties the cards carry, so a table never shows less than the rows did.
        assert!(act(&mut app, "list.layout layout=table tile=lanes").ok);
        let table = app.list_of("lanes").expect("the table came").clone();
        assert_eq!((table.list.arrange.as_str(), table.list.columns.first().map(String::as_str), table.list.headers.len()), ("table", Some("title"), table.list.columns.len()));
        assert!(table.list.columns.iter().any(|column| column == "crop") && table.list.rows.iter().all(|row| row.cells.len() == table.list.columns.len()), "{:?}", table.list.columns);

        // The navigator: facets, and the matches of what they leave.
        pick(&mut app, "navigator");
        assert_eq!(names(&app), ["facets", "matches", "reader"]);
        assert!(app.rows_of("facets").iter().any(|row| row.id == "crop=peas"), "{:?}", app.rows_of("facets").iter().map(|r| r.id.clone()).collect::<Vec<_>>());
        assert!(act(&mut app, "list.pick id=crop=peas tile=facets").ok);
        assert_eq!(app.question_of("matches"), "crop=peas", "the matches follow the facets tile's question");
        assert_eq!(app.rows_of("matches").iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["North bed"]);

        // Last callers: what changed lately, a pick opening it in the reader beside.
        pick(&mut app, "lastcall");
        assert_eq!(names(&app), ["activity", "reader"]);
        assert!(app.rows_of("activity").iter().any(|row| row.label == "North bed"), "{:?}", app.rows_of("activity").iter().map(|r| r.label.clone()).collect::<Vec<_>>());

        // Uninstalled as a person does (the service's own action): the screens and kinds are gone from the list, the
        // window keeps the arrangement it has, and each tile says in the service's words why it can't be drawn.
        ask(json!({ "id": "u", "action": "extensions.uninstall", "outline": "scratch", "extension": "screens", "demo": "keep" }));
        let mut app = app.blocking(false);
        let theirs = |app: &App| app.kinds().iter().filter(|row| row.extension == "screens").count();
        for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); app.take(); if theirs(&app) == 0 { break } }
        // What is left: no kind with a drawer and none of its screens; another extension's screen is still listed.
        assert!(theirs(&app) == 0 && app.note_kind().is_none(), "{:?}", app.kinds().iter().map(|k| k.kind.clone()).collect::<Vec<_>>());
        assert!(!app.screens().iter().any(|s| matches!(&s.from, crate::screen::From::Extension(id) if id == "screens")), "{:?}", app.screens().iter().map(|s| s.name.clone()).collect::<Vec<_>>());
        assert_eq!(names(&app), ["activity", "reader"], "the arrangement stays, as data");
        assert!(app.drawer_of("activity").is_none() && app.cx("activity").is_none(), "a tile whose kind went is drawn as its spec");
        let mut app = app.blocking(true);
        assert!(act(&mut app, "bar.open scope=screens").ok);
        assert!(!crate::bar::rows(&app).iter().any(|row| ["board", "lastcall", "navigator"].contains(&row.key.as_str())), "{:?}", crate::bar::rows(&app));
        let refused = act(&mut app, "open id=nowhere");
        assert!(!refused.ok && refused.said.contains("no tile kind here reads notes"), "{}", refused.said);
        // Installed again, they are back, and the window draws its tiles again.
        ask(json!({ "id": "i", "action": "extensions.install", "outline": "scratch", "extension": "screens" }));
        let mut app = app.blocking(false);
        for _ in 0..200 { std::thread::sleep(Duration::from_millis(50)); app.take(); if theirs(&app) > 0 { break } }
        assert!(app.drawer_of("activity").is_some() && app.screens().iter().any(|s| s.starts()), "{:?}", app.kinds().len());
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// A scratch outline host started for one test (`bun src/host-main.ts` in a temp folder), its outline made, and
/// stopped when the test is over, however it went.
fn with_host(name: &str, test: impl FnOnce(&str, &std::path::Path) + std::panic::UnwindSafe) {
    use crate::client::Socket;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-{name}-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let folder = root.clone();
    let result = std::panic::catch_unwind(move || {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        asked(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true })).expect("the host makes the outline");
        test(&path, &folder);
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// One request on a connection of another client's, answered: its result, or the host's refusal in its words.
fn asked(raw: &mut crate::client::Socket, request: Value) -> Result<Value, String> {
    raw.send(&request);
    raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
    let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
    if line["ok"] == true { Ok(line["result"].clone()) } else { Err(line["error"].as_str().unwrap_or("refused").to_string()) }
}

/// The wave's sentence against a real outline host: a block is written in place with completions from the
/// service's own sources while an agent, over the window's control socket, patches it; the patch lands in front of
/// the person and never in the block they are typing in; the window ends mid-word, and the next one finds the text
/// back in its block. Everything the service decides, it decides here: the token, the rows, where the patch goes.
/// `cargo test -- --ignored live` (it needs bun and the checkout around this crate).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_block_is_written_with_completions_while_an_agent_patches_it_and_comes_back_after_the_window_ends() {
    use super::control::door_over;
    use super::support::{chord, draft, press, primary, rest, typed};
    use crate::client::Socket;
    use crate::draft::Hold;
    use rune::{Key, Mods, Runtime};
    with_host("draft", |path, root| {
        let mut raw = Socket::connect(path);
        let mut ask = |request: Value| asked(&mut raw, request);
        ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Shed [page::shed] [type::place]\nWhere the tools live.", "author": "user" })).unwrap();
        let saved = "Seed list [type::list]\n\nThe beans  go  along the fence.\n\nSow the peas by the sh";
        let note = ask(json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": null, "text": saved, "author": "user" })).unwrap();
        let id = note["id"].as_str().unwrap().to_string();
        let kept = root.join("state/native-scratch.layout.json");
        // Frames with the clock running, until something is so: answers come over a socket, in their own time, and a
        // held draft is renewed as the window's own loop would.
        fn until(rt: &mut Runtime<App>, what: &str, so: impl Fn(&App) -> bool) {
            // (Once it is so, the frames that draw it run before anything is pressed.)
            for _ in 0..400 { if so(&rt.state) { rest(rt); return } std::thread::sleep(Duration::from_millis(25)); rt.update(|s, _| { s.beat(); }); for _ in 0..3 { rt.frame(1.0 / 60.0); } }
            panic!("{what} never came: notice {:?}, status {:?}, draft {:?}, steps {:?}", rt.state.notice, rt.state.agent_said, draft(&rt.state).map(|d| (d.buf.words().to_string(), d.hold.clone())), rt.state.steps.iter().rev().take(3).map(|step| (step.line(), step.ok, step.said.clone())).collect::<Vec<_>>());
        }
        let open = |kept: &std::path::Path| -> App {
            let mut app = App::new(Box::new(Socket::connect(path)), "scratch").arranged_in(kept.to_path_buf());
            app.start();
            opened(&mut app);
            app
        };

        // What another client asks while the window's own loop turns: the service asks the window before it answers.
        fn beside(rt: &mut Runtime<App>, raw: &mut Socket, request: Value) -> Value {
            raw.send(&request);
            for _ in 0..400 {
                for _ in 0..3 { rt.frame(1.0 / 60.0); }
                raw.wait(request["id"].as_str().unwrap(), Duration::from_millis(20));
                if let Some(line) = raw.take().into_iter().find(|line| line["id"] == request["id"]) { assert_eq!(line["ok"], true, "{line}"); return line["result"].clone() }
            }
            panic!("the host never answered {request}");
        }
        let mut other = Socket::connect(path);

        let mut app = open(&kept);
        act(&mut app, &format!("open id={id}"));
        let mut door = door_over(app, Default::default(), "live-draft");
        until(&mut door.rt, "the note's page", |s| s.page().is_some_and(|page| page.title == "Seed list"));
        press(&mut door.rt, "tile/reader/edit");
        until(&mut door.rt, "the hold", |s| draft(s).is_some_and(|d| matches!(d.hold, Hold::Held { .. })));
        // Another client reads the note: what it gets is the draft this window holds.
        assert_eq!(beside(&mut door.rt, &mut other, json!({ "id": "d", "action": "drafts.read", "outline": "scratch", "blockId": id }))["route"], "draft");

        // Typed: a line of its own, and a page's name begun. The service finds the token and lists what completes it.
        chord(&mut door.rt, Key::Enter, Mods::default());
        chord(&mut door.rt, Key::Enter, Mods::default());
        typed(&mut door.rt, "See [[she");
        until(&mut door.rt, "the completion list", |s| s.completing("reader").is_some_and(|found| !found.rows.is_empty()));
        let found = door.rt.state.completing("reader").unwrap().clone();
        assert_eq!((found.token.as_ref().map(|token| (token.kind.as_str(), token.query.as_str())), found.rows[0].insert.as_str()), (Some(("page", "she")), "[[shed]]"), "{found:?}");
        chord(&mut door.rt, Key::Enter, Mods::default());
        let typed_text = format!("{saved}\n\nSee [[shed]]");
        assert_eq!(words(&door.rt.state), typed_text);

        // An agent, over the control socket, tidies a passage above: the service places it in the draft, in front of
        // the person, attributed; their caret is still at the end of what they typed, and the saved note is as it was.
        let sent = door.ask(json!({ "cmd": "act", "action": "draft.patch", "args": { "observed": "The beans  go  along the fence.", "replacement": "The beans go along the fence." }, "as": "tidy-agent" }));
        assert_eq!(sent["ok"], true, "{sent}");
        until(&mut door.rt, "the agent's patch", |s| words(s).contains("The beans go along the fence."));
        let patched = typed_text.replace("beans  go  along", "beans go along");
        let session = draft(&door.rt.state).unwrap();
        assert_eq!((session.buf.words(), session.buf.ends(), session.buf.takes_keys()), (patched.as_str(), (patched.len(), patched.len()), true));
        assert_eq!(session.told.as_ref().map(|told| told.line()).as_deref(), Some("an agent (tidy-agent) edited text above your cursor"));
        assert_eq!(ask(json!({ "id": "e", "action": "get", "outline": "scratch", "blockId": id })).unwrap()["text"], saved, "the saved note is untouched: the patch is in the draft");
        rest(&mut door.rt);
        assert!(door.rt.find("tile/reader/told").is_some(), "who changed the text is said on the tile");

        // The paragraph at the cursor is the person's while they type in it: refused, with why, and nothing changes.
        let sent = door.ask(json!({ "cmd": "act", "action": "draft.patch", "args": { "observed": "See [[shed]]", "replacement": "See the [[shed]]" }, "as": "tidy-agent" }));
        assert_eq!(sent["ok"], true, "{sent}");
        until(&mut door.rt, "the refusal", |s| s.agent_said.as_deref().is_some_and(|said| said.contains("not changed")));
        assert!(door.rt.state.agent_said.as_deref().unwrap().contains("it changes the block being typed in"), "{:?}", door.rt.state.agent_said);
        assert_eq!(words(&door.rt.state), patched);

        // Saved: what was typed and what the agent changed, as one text at the revision the draft stood on.
        chord(&mut door.rt, Key::Command('s'), primary());
        until(&mut door.rt, "the save", |s| draft(s).is_some_and(|d| !d.unsaved()));
        assert_eq!(ask(json!({ "id": "f", "action": "get", "outline": "scratch", "blockId": id })).unwrap()["text"], patched);

        // Typed on, mid-word, and the window ends: nothing closes the draft, nothing saves it.
        typed(&mut door.rt, " Sow the pe");
        drop(door);
        let left = format!("{patched} Sow the pe");
        // The host lets go of a hold whose window is gone: the note reads as saved again.
        let mut released = false;
        for _ in 0..100 { if ask(json!({ "id": "g", "action": "drafts.read", "outline": "scratch", "blockId": id })).unwrap()["route"] == "saved" { released = true; break } std::thread::sleep(Duration::from_millis(50)) }
        assert!(released, "a window that ended holds nothing");

        // The next window finds the text back in its block, says so, and holds it again.
        let mut rt = super::support::window(open(&kept));
        until(&mut rt, "the draft back and held", |s| draft(s).is_some_and(|d| matches!(d.hold, Hold::Held { .. })));
        assert_eq!((words(&rt.state), draft(&rt.state).map(|d| d.unsaved())), (left.as_str(), Some(true)));
        assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.contains("is back in its block")), "{:?}", rt.state.notice);
        typed(&mut rt, "as.");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the save", |s| draft(s).is_some_and(|d| !d.unsaved()));
        assert_eq!(ask(json!({ "id": "h", "action": "get", "outline": "scratch", "blockId": id })).unwrap()["text"], format!("{left}as."));
        // Closed: the hold is released, and the note is the saved one for everybody.
        chord(&mut rt, Key::Escape, Mods::default());
        assert!(draft(&rt.state).is_none());
        let mut released = false;
        for _ in 0..100 { rt.frame(1.0 / 60.0); if ask(json!({ "id": "i", "action": "drafts.read", "outline": "scratch", "blockId": id })).unwrap()["route"] == "saved" { released = true; break } std::thread::sleep(Duration::from_millis(50)) }
        assert!(released, "a draft closed is held no longer");
    });
}

/// A day as a person writes one (`2026-03-01 09:30`), `days` before now: what an outbox item's `sent` holds.
fn days_ago(days: u64) -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() - days * 86_400;
    // Days since 1970 to a civil date (Howard Hinnant's algorithm).
    let z = (secs / 86_400) as i64 + 719_468;
    let (era, doe) = (z.div_euclid(146_097), z.rem_euclid(146_097));
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (d, m) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    format!("{:04}-{m:02}-{d:02} {:02}:{:02}", yoe + era * 400 + i64::from(m <= 2), (secs % 86_400) / 3_600, (secs % 3_600) / 60)
}

/// W7's sentence against a real outline host: on a scratch outline the bundled Waiting extension is installed from
/// the bar's own row, its screen opened and a row of its tile picked, its setting changed in the form its schema
/// makes, and removed by an agent's act; then the window switches to another outline of the same host and back.
/// What is left afterwards is said by the asserts at its end. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_waiting_is_installed_used_configured_and_removed_and_the_window_switches_outline_over_the_socket() {
    use crate::actions::{Actor, Field};
    use crate::client::{Socket, Way};
    use crate::tiles::rendered::TileView;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-ext-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config")).env("OUTLINER_EXTENSIONS_DIR", root.join("user-extensions"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(30));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        // Two outlines on the one scratch host, made on purpose; an ask that has waited two days on the first.
        for (id, name) in [("a", "scratch"), ("b", "allotment")] { asking(&mut Socket::connect(&path), json!({ "id": id, "action": "outlines.attach", "name": name, "create": true })); }
        let mut raw = Socket::connect(&path);
        let jars = asking(&mut raw, json!({ "id": "c", "action": "create", "outline": "scratch", "parentId": null, "author": "user",
            "text": format!("Jars for the cellar [type::outbox-item] [outbox::waiting] [waiting-on::Ada: which shelf do the jars go on?] [sent::{}]", days_ago(2)) }));
        let jars = jars["id"].as_str().unwrap().to_string();

        // The way to any outline of this host is its one socket: what the rule answers for a scratch host.
        let there = path.clone();
        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").reaching(std::rc::Rc::new(move |_| Ok(Way { link: Box::new(Socket::connect(&there)), kept: None }))).blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        let until = |app: &mut App, what: &str, so: &dyn Fn(&App) -> bool| {
            for _ in 0..400 { app.settle(); if so(app) { return } std::thread::sleep(Duration::from_millis(50)); }
            panic!("{what}: {:?}", app.notice);
        };
        let installed = |app: &App| app.extensions().is_some_and(|listed| listed.entry("waiting").is_some());
        // A host installs its default-on extensions as it starts, Waiting among them: the sentence starts without it.
        until(&mut app, "the extensions are listed", &|app| app.extensions().is_some());
        if installed(&app) {
            assert!(act(&mut app, "extensions.uninstall demo=remove id=waiting").ok);
            until(&mut app, "Waiting is removed first", &|app| !installed(app) && app.kind_row("waiting.list").is_none());
        }

        // Installed, as a person does: the bar's Extensions lists it among the ones not installed, and its row is picked.
        act(&mut app, "bar.open scope=extensions query=waiting");
        until(&mut app, "the bar lists the row that installs it", &|app| crate::bar::rows(app).iter().any(|row| row.key == "install:waiting"));
        let row = crate::bar::rows(&app).into_iter().find(|row| row.key == "install:waiting").unwrap();
        assert_eq!((row.label.as_str(), row.line.as_str()), ("Install Waiting", "extensions.install id=\"waiting\""));
        assert!(act(&mut app, "bar.pick source=extensions key=install:waiting").ok);
        until(&mut app, "Waiting is installed, and what it adds is listed", &|app| installed(app) && app.kind_row("waiting.list").is_some_and(|row| row.drawer.as_deref() == Some("view")) && app.screens().iter().any(|screen| screen.name == "waiting"));
        assert!(app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.starts_with("Installed Waiting.")), "{:?}", app.notice);
        eprintln!("installed: {}", app.notice.as_ref().unwrap().said);

        // Used: its screen, its tile drawn from what its script answered, a row picked opening beside.
        assert!(act(&mut app, "screen.open name=waiting").ok);
        let tile = app.layout.named("waiting").expect("its screen has its tile");
        let view = |app: &App| app.view_ask(&app.layout.named("waiting")?).and_then(|ask| app.store().read::<TileView>(&ask)).cloned();
        until(&mut app, "its tile's view came", &|app| view(app).is_some_and(|shown| shown.view["rows"].as_array().is_some_and(|rows| !rows.is_empty())));
        let shown = view(&app).unwrap();
        assert_eq!((shown.kind.as_str(), shown.title.as_str(), shown.view["type"].as_str()), ("waiting.list", "outbox · 1 waiting on 1 person", Some("list")));
        let row = shown.view["rows"][0].clone();
        assert_eq!((row["id"].as_str(), row["act"].as_str(), row["tone"].as_str()), (Some(jars.as_str()), Some(format!("open id=\"{jars}\"").as_str()), None), "two days is inside its three");
        assert!(app.act_in(row["act"].as_str().unwrap(), "waiting", Actor::Person).ok);
        app.settle();
        assert_eq!(app.note_of(&app.layout.named("reader").unwrap()).as_deref(), Some(jars.as_str()), "the pick lands in the reader its screen wires it to");
        assert!(app.drawer_of(&tile).is_some_and(|drawer| drawer.id == "view"));

        // Configured: the form is its schema's one field; saved, the script draws by it.
        assert!(act(&mut app, "extensions.configure id=waiting").ok);
        let form = app.form.as_ref().expect("the form opened");
        assert_eq!(form.fields.iter().map(|field| field.name.as_str()).collect::<Vec<_>>(), ["warn-days"]);
        assert_eq!(app.settings_of("waiting").map(|settings| (settings.fields[0].ty.as_str(), settings.fields[0].default.clone(), settings.fields[0].state.as_str())), Some(("integer", Some(json!(3)), "default")));
        let field = Field::Form("warn-days".into());
        app.field(&field).replace("0");
        app.typed(&field);
        act(&mut app, "form.save");
        until(&mut app, "the service refuses a day count under one, and the form keeps it", &|app| app.form.as_ref().is_some_and(|form| form.said.is_some()));
        eprintln!("refused: {}", app.form.as_ref().unwrap().said.as_ref().unwrap());
        app.field(&field).replace("1");
        app.typed(&field);
        assert!(act(&mut app, "form.save").ok);
        until(&mut app, "the setting is saved and the tile warns", &|app| app.form.is_none() && app.settings_of("waiting").is_some_and(|settings| settings.fields[0].value == Some(json!(1))) && view(app).is_some_and(|shown| shown.view["rows"][0]["tone"] == "warn"));
        assert_eq!(app.notice.as_ref().map(|n| n.said.as_str()), Some("Saved Waiting's settings: warn-days=1."));

        // Removed, by an act as an agent, its demo notes kept.
        assert!(app.act("extensions.uninstall demo=keep id=waiting", Actor::Agent("compost-agent".into())).ok);
        until(&mut app, "Waiting is removed", &|app| !installed(app) && app.kind_row("waiting.list").is_none() && !app.screens().iter().any(|screen| screen.name == "waiting"));
        eprintln!("removed: {}", app.notice.as_ref().unwrap().said);
        // What is left: the window is still laid out as its screen, whose tile nobody draws now (its spec, as data);
        // its page and demo notes are in the outline; its settings are kept on the host for a reinstall.
        assert!(app.layout.named("waiting").is_some() && app.kind_of(&tile).is_none());
        let mut ask = |request: Value| asking(&mut raw, request);
        let demo = ask(json!({ "id": "d", "action": "lists.read", "outline": "scratch", "from": "query", "query": "demo=waiting" }));
        assert!(demo["list"]["rows"].as_array().is_some_and(|rows| !rows.is_empty()), "its demo notes stay: {demo}");
        let listed = ask(json!({ "id": "e", "action": "lists.read", "outline": "scratch", "from": "extensions", "query": "waiting" }));
        assert!(listed["list"]["rows"].as_array().unwrap().iter().any(|row| row["id"] == "install:waiting"), "it is one the repo has again: {listed}");
        let back = ask(json!({ "id": "f", "action": "extensions.install", "outline": "scratch", "extension": "waiting", "mutation": { "author": "user" } }));
        eprintln!("installed again: {back}");
        assert!(back["settingsBack"].is_string(), "its settings from before are back with it: {back}");
        ask(json!({ "id": "g", "action": "extensions.uninstall", "outline": "scratch", "extension": "waiting", "demo": "keep", "mutation": { "author": "user" } }));

        // The window switches outline: the host lists the two it has, the other opens, and this one is as it was left.
        act(&mut app, "bar.open scope=outlines");
        until(&mut app, "the bar lists the outlines", &|app| crate::bar::rows(app).len() == 2);
        assert_eq!(crate::bar::rows(&app).iter().map(|row| row.line.clone()).collect::<Vec<_>>(), ["outline.switch name=\"allotment\"", "outline.switch name=\"scratch\""]);
        act(&mut app, "bar.close");
        assert!(act(&mut app, "outline.switch name=meadow").ok);
        until(&mut app, "a name nobody has is refused", &|app| app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.starts_with("No outline named meadow here")));
        assert!(!outlines.join("meadow.sqlite").exists(), "and none was made by asking");
        assert!(act(&mut app, "outline.switch name=allotment").ok);
        until(&mut app, "the window is on the other outline, on a screen", &|app| app.at.outline == "allotment" && !app.screen.is_nowhere() && !app.kinds().is_empty());
        assert_eq!((app.store().links().len(), app.parked.len(), app.layout.named("waiting")), (2, 1, None));
        assert!(act(&mut app, "outline.switch name=scratch").ok);
        app.settle();
        assert_eq!((app.at.outline.as_str(), app.screen.name.as_str(), app.layout.named("waiting").is_some()), ("scratch", "waiting", true), "back as it was left");
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// F1's sentence against a real outline host: words selected in the reader as it drew them, across a link (in each
/// form one is written), a reference drawn as its note's title (one with marks of its own too), bold text, two
/// paragraphs and a rule between two, are commented on, and
/// each comment lands on the source those words were drawn from. The window sends the words as drawn, said as drawn,
/// with the span the service gave the part; where they are in the note is the service's to find. Words that are not
/// in the note are refused with why, and the comment keeps its words. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_comment_on_words_selected_across_a_link_bold_text_and_two_paragraphs_lands_on_that_passage() {
    use super::support::{chord, draft, primary, rest, typed, window};
    use crate::client::Socket;
    use rune::{Key, Mods, Runtime};
    with_host("quote", |path, root| {
        let mut raw = Socket::connect(path);
        let mut ask = |request: Value| asked(&mut raw, request).unwrap();
        fn until(rt: &mut Runtime<App>, what: &str, so: impl Fn(&App) -> bool) {
            for _ in 0..400 { if so(&rt.state) { rest(rt); return } std::thread::sleep(Duration::from_millis(25)); for _ in 0..3 { rt.frame(1.0 / 60.0); } }
            panic!("{what} never came: notice {:?}, steps {:?}", rt.state.notice, rt.state.steps.iter().rev().take(3).map(|step| (step.line(), step.ok, step.said.clone())).collect::<Vec<_>>());
        }
        fn line(rt: &mut Runtime<App>, line: &str) { let line = line.to_string(); rt.update(move |s, _| { let done = s.act(&line, crate::actions::Actor::Person); assert!(done.ok, "{line}: {}", done.said); }); rest(rt); }
        let peas = ask(json!({ "id": "p", "action": "create", "outline": "scratch", "parentId": null, "text": "Early peas [type::crop]\nSown under glass.", "author": "user" }))["id"].as_str().unwrap().to_string();
        let seeds = ask(json!({ "id": "s", "action": "create", "outline": "scratch", "parentId": null, "text": "`seed_list` notes [type::list]\nWhat was bought.", "author": "user" }))["id"].as_str().unwrap().to_string();
        // Each note's body is one part of its page: all of it selected is a selection across what the case names.
        // (The title, the body as written, the body as the reader draws and copies it.)
        let cases: Vec<(&str, String, &str)> = vec![
            ("North bed", format!("Sow the [early peas](https://seeds.example/peas) in March, then the (({peas}|maincrop)) and what the [[seed list]] says."), "Sow the early peas in March, then the maincrop and what the seed list says."),
            ("South bed", format!("The (({peas})) come up in ten days."), "The Early peas come up in ten days."),
            ("West bed", "Water **before dusk**, never at *noon*.".to_string(), "Water before dusk, never at noon."),
            // A rule between two paragraphs is drawn as a line with no words, and a reference as its note's title
            // through Markdown (the title's code ticks are marks): neither is in the words selected as written.
            ("Far bed", "Peas go in first.\n\n---\n\nThe beans go in May.".to_string(), "Peas go in first.\n\nThe beans go in May."),
            ("Low bed", format!("See the (({seeds})) first."), "See the seed_list notes first."),
            ("East bed", "Peas go in first.\n\nThe beans go in May.".to_string(), "Peas go in first.\n\nThe beans go in May."),
        ];
        let mut app = App::new(Box::new(Socket::connect(path)), "scratch").arranged_in(root.join("state/native-scratch.layout.json"));
        app.start();
        opened(&mut app);
        let mut rt = window(app);
        // With the mouse, as a person selects: a drag from inside one paragraph, across a link and bold text, into
        // the next. The words between are told as drawn, and the comment lands on the source they were drawn from.
        let body = "Sow the [early peas](https://seeds.example/peas) in March, **before** the last frost, in the long bed.\n\nWater the beds at dusk, and never at *noon*.";
        let id = ask(json!({ "id": "d", "action": "create", "outline": "scratch", "parentId": null, "text": format!("Long bed [type::bed]\n{body}"), "author": "user" }))["id"].as_str().unwrap().to_string();
        line(&mut rt, &format!("open id={id}"));
        until(&mut rt, "the note's page", |s| s.page().is_some_and(|page| page.title == "Long bed"));
        let drawn_at = |rt: &Runtime<App>, words: &str| rt.elements().into_iter().find(|e| e.text.as_deref().is_some_and(|text| text.starts_with(words))).map(|e| e.rect).unwrap_or_else(|| panic!("no text drawn starts with {words}"));
        let (first, second) = (drawn_at(&rt, "Sow the early peas"), drawn_at(&rt, "Water the beds"));
        let (from, to) = ((first[0] + 30.0, first[1] + first[3] / 2.0), (second[0] + 120.0, second[1] + second[3] / 2.0));
        rt.pointer_move(from.0, from.1);
        rt.pointer_down(from.0, from.1);
        rt.frame(1.0 / 60.0);
        for step in 1..=8 { let t = step as f32 / 8.0; rt.pointer_move(from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t); rt.frame(1.0 / 60.0); }
        rt.pointer_up(to.0, to.1);
        rest(&mut rt);
        let picked = rt.state.ui("reader").passage.clone().expect("the drag's selection was told to the window");
        assert_eq!(rt.selected_text().as_deref(), Some(picked.words.as_str()));
        assert!(picked.drawn && picked.words.contains("the early peas in March, before the last frost, in the long bed.\n\nWater the beds") && !picked.words.contains("Sow the") && !picked.words.contains("noon"), "some of each paragraph, as drawn: {picked:?}");
        chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
        typed(&mut rt, "Here.");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the comment sent", |s| s.drafts.is_empty());
        let threads = ask(json!({ "id": "td", "action": "annotations.list", "outline": "scratch", "query": { "subject": { "kind": "block", "blockId": id } } }));
        let exact = threads[0]["originalTarget"]["anchor"]["exact"].as_str().unwrap_or_default().to_string();
        assert!(body.contains(&exact) && exact.contains("the [early peas](https://seeds.example/peas) in March, **before** the last frost, in the long bed.\n\nWater the beds") && !exact.starts_with("Sow") && !exact.contains("noon"), "the source those words were drawn from, and no more: {threads}");
        for (n, (title, body, drawn)) in cases.iter().enumerate() {
            let head = format!("{title} [type::bed]\n");
            let id = ask(json!({ "id": format!("c{n}"), "action": "create", "outline": "scratch", "parentId": null, "text": format!("{head}{body}"), "author": "user" }))["id"].as_str().unwrap().to_string();
            line(&mut rt, &format!("open id={id}"));
            until(&mut rt, "the note's page", |s| s.page().is_some_and(|page| page.title == *title));
            // Selected as a drag across the part would: the words as drawn, within the part's span of the note's text.
            rt.update(|_, tx| tx.select_all_text("tile/reader/part/0"));
            rest(&mut rt);
            assert_eq!(rt.selected_text().as_deref(), Some(*drawn), "{title}");
            let (start, end) = (head.encode_utf16().count(), head.encode_utf16().count() + body.encode_utf16().count());
            // (Where they are is asked as they are picked: the service's answer comes a moment later, and is the part whole.)
            until(&mut rt, "where the words are", |s| s.ui("reader").passage.as_ref().is_some_and(|quoted| quoted.found.is_some()));
            let picked = rt.state.ui("reader").passage.clone().unwrap();
            assert_eq!((picked.words.as_str(), picked.drawn, picked.within, picked.found.clone()), (*drawn, true, Some((start, end)), Some(Ok((start, end)))), "{title}");
            chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
            assert!(draft(&rt.state).is_some_and(|draft| !draft.is_block()), "{title}: {:?}", rt.state.notice);
            typed(&mut rt, "Here.");
            chord(&mut rt, Key::Command('s'), primary());
            until(&mut rt, "the comment sent", |s| s.drafts.is_empty());
            // The thread is anchored to the source the words were drawn from: the whole link, the styled run, both paragraphs.
            let threads = ask(json!({ "id": format!("t{n}"), "action": "annotations.list", "outline": "scratch", "query": { "subject": { "kind": "block", "blockId": id } } }));
            let anchor = &threads[0]["originalTarget"]["anchor"];
            assert_eq!((threads.as_array().map(Vec::len), anchor["exact"].as_str(), anchor["start"].as_u64(), anchor["end"].as_u64()), (Some(1), Some(body.as_str()), Some(start as u64), Some(end as u64)), "{title}: {threads}");
        }
        // Words that are not in the note, as drawn or as written: refused with why, and the comment keeps its words.
        line(&mut rt, "passage.select quote=\"Peas go in last.\"");
        line(&mut rt, "comment");
        typed(&mut rt, "Too late.");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the refusal", |s| s.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem));
        assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.starts_with("The comment wasn't sent: Comment quote or context was not found") && n.said.contains("nearest: \"Peas go in\"")), "{:?}", rt.state.notice);
        assert_eq!(words(&rt.state), "Too late.");
    });
}

/// H4's sentence against a real outline host: words selected with the mouse from the first letter of a list item
/// and of a paragraph, each press landing past the middle of that letter (so the selection Rune makes starts after
/// it: what cost Evan's quotes their first character), are commented on where they are, and afterwards the page
/// shows that those words carry a comment and what it says. The service finds the whole words as they are picked;
/// the comment's field stands under the part they are in; the thread is anchored at the first letter; the page
/// marks the passage from the service's own marks and the thread is beside it; the list of the note's comments is
/// in front; and a comment somebody else writes meanwhile is marked and listed with no act in this window (the
/// watches on `notes.page` and `lists.read` hear an annotation write). `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_words_selected_from_a_first_letter_are_commented_on_in_place_and_marked_on_the_page() {
    use super::support::{chord, press, primary, rest, typed, window};
    use crate::client::Socket;
    use rune::{Key, Mods, Runtime};
    with_host("margin", |path, root| {
        let mut raw = Socket::connect(path);
        let mut ask = |request: Value| asked(&mut raw, request).unwrap();
        fn until(rt: &mut Runtime<App>, what: &str, so: impl Fn(&Runtime<App>) -> bool) {
            for _ in 0..400 { if so(rt) { rest(rt); return } std::thread::sleep(Duration::from_millis(25)); for _ in 0..3 { rt.frame(1.0 / 60.0); } }
            panic!("{what} never came: notice {:?}, steps {:?}", rt.state.notice, rt.state.steps.iter().rev().take(4).map(|step| (step.line(), step.ok, step.said.clone())).collect::<Vec<_>>());
        }
        fn line(rt: &mut Runtime<App>, line: &str) { let line = line.to_string(); rt.update(move |s, _| { let done = s.act(&line, crate::actions::Actor::Person); assert!(done.ok, "{line}: {}", done.said); }); rest(rt); }
        /// A drag with the mouse, as a person selects: from a point to a point, let go there.
        fn dragged(rt: &mut Runtime<App>, from: (f32, f32), to: (f32, f32)) {
            rt.pointer_move(from.0, from.1);
            rt.pointer_down(from.0, from.1);
            rt.frame(1.0 / 60.0);
            for step in 1..=8 { let t = step as f32 / 8.0; rt.pointer_move(from.0 + (to.0 - from.0) * t, from.1 + (to.1 - from.1) * t); rt.frame(1.0 / 60.0); }
            rt.pointer_up(to.0, to.1);
            rest(rt);
        }
        let text = ["Margin notes [type::guide]", "Read with a pen in hand.", "", "- Define looks the words up in the glossary.", "- Cite copies the passage with where it is from.", "", "Pages and web clippings are read the same way, and a later question in the thread resumes it."].join("\n");
        let id = ask(json!({ "id": "n", "action": "create", "outline": "scratch", "parentId": null, "text": text, "author": "user" }))["id"].as_str().unwrap().to_string();
        let mut app = App::new(Box::new(Socket::connect(path)), "scratch").arranged_in(root.join("state/native-scratch.layout.json"));
        app.start();
        opened(&mut app);
        let mut rt = window(app);
        line(&mut rt, &format!("open id={id}"));
        until(&mut rt, "the note's page", |rt| rt.state.page().is_some_and(|page| page.title == "Margin notes"));
        // The note's comments are behind another tab, as they were on Evan's screen.
        press(&mut rt, "tile/threads/tab/revisions");
        assert!(rt.find("tile/threads/title").is_none());
        let drawn_at = |rt: &Runtime<App>, words: &str| rt.elements().into_iter().find(|e| e.role != "mark" && e.text.as_deref().is_some_and(|text| text.starts_with(words))).map(|e| e.rect).unwrap_or_else(|| panic!("no text drawn starts with {words}"));
        let threads = |ask: &mut dyn FnMut(Value) -> Value, n: usize| ask(json!({ "id": format!("t{n}"), "action": "annotations.list", "outline": "scratch", "query": { "subject": { "kind": "block", "blockId": id } } }));
        let marks = |rt: &Runtime<App>| rt.elements().into_iter().filter(|e| e.role == "mark").filter_map(|e| e.text).collect::<Vec<_>>();

        // From the first letter of a list item, into the paragraph under the list. The press is on the letter, past
        // its middle: the selection starts after it.
        let (item, para) = (drawn_at(&rt, "Define looks"), drawn_at(&rt, "Pages and web"));
        let lost = (4..=12).map(|dx| dx as f32).find(|dx| {
            dragged(&mut rt, (item[0] + dx, item[1] + item[3] / 2.0), (para[0] + 150.0, para[1] + 8.0));
            rt.selected_text().is_some_and(|said| said.starts_with("efine looks"))
        }).expect("a press on the first letter, past its middle, starts the selection after it");
        assert!(lost < 12.0);
        let said = rt.selected_text().unwrap();
        assert!(said.starts_with("efine looks the words up in the glossary.\n- Cite copies the passage with where it is from.\n\nPages and"), "the selection as Rune made it, a character short: {said:?}");
        // Where those words are is asked as they are picked: the passage is the whole words, from the first letter.
        until(&mut rt, "where the picked words are", |rt| rt.state.ui("reader").passage.as_ref().is_some_and(|quoted| quoted.found.is_some()));
        let picked = rt.state.ui("reader").passage.clone().unwrap();
        let (start, end) = picked.found.clone().unwrap().expect("the service found them");
        assert_eq!(start, text.find("Define").unwrap(), "the passage starts at the first letter");
        assert!(picked.words.starts_with("Define looks the words up in the glossary. Cite copies") && !text[end..].starts_with(char::is_alphanumeric), "whole words at both ends: {picked:?}");
        // The actions of the picked words are by them; the comment opens in place, under the part they are in.
        assert!(rt.find("tile/reader/picked/comment").is_some());
        chord(&mut rt, Key::Command('m'), Mods { shift: true, ..primary() });
        let on = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("tile/reader/on")).and_then(|e| e.text).unwrap_or_default();
        assert!(on.starts_with("On “Define looks the words up in the glossary."), "{on}");
        let rect = |rt: &Runtime<App>, key: &str| rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)).map(|e| (e.rect, e.visible)).unwrap_or_else(|| panic!("nothing is keyed {key}"));
        let ((part, part_seen), (field, field_seen)) = (rect(&rt, "tile/reader/part/0"), rect(&rt, "tile/reader/editor"));
        assert!(field[1] >= part[1] + part[3] && part_seen[3] > 0.0 && field_seen[3] >= field[3] - 1.0, "the field is under its part, in view: {part:?} {field:?}");
        typed(&mut rt, "Which glossary?");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the comment sent", |rt| rt.state.drafts.is_empty());
        let listed = threads(&mut ask, 1);
        let anchor = &listed[0]["originalTarget"]["anchor"];
        assert_eq!((listed.as_array().map(Vec::len), anchor["start"].as_u64(), anchor["end"].as_u64()), (Some(1), Some(start as u64), Some(end as u64)), "anchored on the whole words: {listed}");
        let thread = listed[0]["block"]["id"].as_str().unwrap().to_string();
        // Afterwards the page shows it: the words are marked, a line a mark, and the thread is beside them.
        until(&mut rt, "the passage marked", |rt| !marks(rt).is_empty());
        assert_eq!(marks(&rt)[..2], ["Define looks the words up in the glossary.".to_string(), "Cite copies the passage with where it is from.".to_string()], "{:?}", marks(&rt));
        until(&mut rt, "the thread beside its words", |rt| rt.find(&format!("tile/reader/card/{thread}")).is_some());
        // And the list of the note's comments is in front, with it: the person's send brought it there.
        assert!(rt.find("tile/threads/title").is_some() && rt.find(&format!("tile/threads/row/{thread}")).is_some(), "{:?}", rt.state.steps.iter().rev().take(3).map(|step| step.line()).collect::<Vec<_>>());
        assert!(rt.state.steps.iter().any(|step| step.action == "threads" && step.by == crate::actions::Actor::Person && step.ok));
        // A press on the marked words shows the thread whole: what was written, and its own presses.
        let (x, y) = rt.find(&format!("tile/reader/mark/{thread}/1/0")).expect("the mark's words are found by its key");
        rt.pointer_move(x, y);
        rt.frame(1.0 / 60.0);
        rt.pointer_down(x, y);
        rt.pointer_up(x, y);
        rest(&mut rt);
        assert!(rt.state.ui("reader").unfolded.contains(&thread), "{:?}", rt.state.steps.last().map(|step| (step.line(), step.said.clone())));
        let whole = rt.elements().into_iter().filter(|e| e.path.contains(&format!("tile/reader/card/{thread}"))).filter_map(|e| e.text).collect::<Vec<_>>();
        assert!(whole.iter().any(|said| said == "Which glossary?") && whole.iter().any(|said| said == "Reply") && whole.iter().any(|said| said == "Resolve"), "{whole:?}");

        // From the first letter of a paragraph, a few words along the line.
        let para = drawn_at(&rt, "Pages and web");
        (4..=12).map(|dx| dx as f32).find(|dx| {
            dragged(&mut rt, (para[0] + dx, para[1] + 8.0), (para[0] + 150.0, para[1] + 8.0));
            rt.selected_text().is_some_and(|said| said.starts_with("ages and"))
        }).expect("a press on the paragraph's first letter starts the selection after it");
        until(&mut rt, "where the picked words are", |rt| rt.state.ui("reader").passage.as_ref().is_some_and(|quoted| quoted.found.is_some()));
        let picked = rt.state.ui("reader").passage.clone().unwrap();
        assert!(picked.words.starts_with("Pages and web") && picked.found.clone().unwrap().is_ok_and(|(start, _)| start == text.find("Pages").unwrap()), "{picked:?}");
        typed(&mut rt, "ac");
        assert!(rt.state.draft_on("reader").is_some_and(|draft| !draft.is_block()), "the door's keys for a comment on picked words: {:?}", rt.state.notice);
        typed(&mut rt, "And PDFs?");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the second comment sent", |rt| rt.state.drafts.is_empty());
        let listed = threads(&mut ask, 2);
        assert!(listed.as_array().unwrap().iter().any(|thread| thread["originalTarget"]["anchor"]["start"].as_u64() == Some(text.find("Pages").unwrap() as u64)), "{listed}");
        until(&mut rt, "both passages marked", |rt| marks(rt).iter().any(|said| said.starts_with("Pages and web")));

        // Somebody else comments (another client): with no act in this window the page marks the words and the list
        // has the thread, and no tab moved for it.
        press(&mut rt, "tile/threads/tab/proposals");
        let steps = rt.state.steps.len();
        let now = ask(json!({ "id": "g", "action": "get", "outline": "scratch", "blockId": id }));
        ask(json!({ "id": "c3", "action": "annotations.batch", "outline": "scratch", "requestId": "margin-live-3", "author": "agent", "provenance": { "actorId": "compost-agent" },
            "operations": [{ "operationId": "1", "type": "block-comment", "input": { "blockId": id, "expectedRevision": now["revision"], "body": "A pencil will do.", "source": "agent", "passage": { "quote": "a pen in hand" } } }] }));
        until(&mut rt, "the agent's passage marked", |rt| marks(rt).iter().any(|said| said == "a pen in hand"));
        assert_eq!(rt.state.steps.len(), steps, "nothing was run here for it");
        assert!(rt.find("tile/threads/title").is_none() && rt.find("tile/proposals/title").is_some(), "an agent's comment moves no tab");
        line(&mut rt, "threads");
        until(&mut rt, "the three threads listed", |rt| rt.state.rows_of(&rt.state.layout.named("threads").unwrap()).len() == 3);

        // The whole note is one run of prose, so one part. Words of its first paragraph: the service is asked with
        // the part as it was drawn and says where they are in that text, and the comment's field stands in the
        // part, under that paragraph and over the list, not under everything the part holds.
        let first = drawn_at(&rt, "Read with a pen");
        dragged(&mut rt, (first[0] + 40.0, first[1] + 8.0), (first[0] + 95.0, first[1] + 8.0));
        until(&mut rt, "where the words of the first paragraph are", |rt| rt.state.ui("reader").passage.as_ref().is_some_and(|quoted| quoted.found.is_some()));
        let picked = rt.state.ui("reader").passage.clone().unwrap();
        assert!(picked.at.as_ref().is_some_and(|at| at.part == 1 && at.range.is_some()) && text[picked.found.clone().unwrap().unwrap().1..].contains("\n\n- Define"), "{picked:?}");
        typed(&mut rt, "ac");
        assert!(rt.state.draft_on("reader").is_some_and(|draft| !draft.is_block()), "{:?}", rt.state.notice);
        let (field, list, part) = (rect(&rt, "tile/reader/editor").0, drawn_at(&rt, "Define looks"), rect(&rt, "tile/reader/part/0").0);
        assert!(field[1] > part[1] && field[1] + field[3] <= list[1] && list[1] < part[1] + part[3], "the field is in its part, over the list: field {field:?}, list {list:?}, part {part:?}");
    });
}

/// W6's sentence against a real outline host: a comment on words of a note, a reply and the thread resolved, by the
/// rows' own presses; an agent's proposed edit listed with its change, applied, and another dismissed; an earlier
/// text opened under its row and put back through the editor; the keys screen the key table's own rows, and a
/// component's example drawn in the library. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_note_is_commented_on_its_proposals_and_revisions_reviewed_and_the_keys_listed_over_the_socket() {
    use crate::actions::Actor;
    use crate::client::Socket;
    use crate::page::ListRow;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-about-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let first = "North bed [type::bed]\nPeas go in first.\nThe beans go in May.\nWater at dusk.";
        let bed = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": first, "author": "user" }));
        let bed_id = bed["id"].as_str().unwrap().to_string();

        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        assert!(act(&mut app, &format!("open id={bed_id}")).ok);
        let rows = |app: &App, tile: &str| -> Vec<ListRow> { app.rows_of(&app.layout.named(tile).unwrap_or_else(|| panic!("the desk has a {tile} tile"))).to_vec() };
        let cell = |row: &ListRow, said: &str| -> String { row.cells.iter().find(|cell| ListRow::cell(cell) == said).and_then(|cell| ListRow::cell_act(cell)).unwrap_or_else(|| panic!("{} has a {said} press: {:?}", row.label, row.cells)).to_string() };
        /// A press of a row's own, from its tile, as the person.
        fn pressed(app: &mut App, line: &str, tile: &str) -> crate::actions::Outcome { let outcome = app.act_in(line, tile, Actor::Person); app.settle(); outcome }
        assert_eq!(app.subject_of(&app.layout.named("threads").unwrap()).as_deref(), Some(bed_id.as_str()), "the comments follow the reader");
        assert!(rows(&app, "threads").is_empty());

        // A comment on words of the note: selected, written in the reader, sent by the save. The service anchors it.
        assert!(act(&mut app, "passage.select quote=\"The beans go in May.\"").ok);
        assert!(act(&mut app, "comment").ok);
        write(&mut app, "June is safer: the frost came late last year.");
        let sent = act(&mut app, "edit.save");
        assert!(sent.ok && app.drafts.is_empty(), "{} {:?}", sent.said, app.notice);
        let threads = rows(&app, "threads");
        assert_eq!(threads.len(), 1, "{:?}", app.notice);
        assert_eq!(threads[0].label, "June is safer: the frost came late last year.");
        assert!(threads[0].detail.as_deref().is_some_and(|detail| detail.contains("on “The beans go in May.”") && detail.starts_with("you")), "{:?}", threads[0].detail);
        // Words that are not in the note as written: the service refuses, and the comment keeps its words.
        assert!(act(&mut app, "comment quote=\"The beans go in March.\"").ok);
        write(&mut app, "Too early.");
        act(&mut app, "edit.save");
        assert!(app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.starts_with("The comment wasn't sent:")), "{:?}", app.notice);
        assert_eq!(words(&app), "Too early.");
        assert!(act(&mut app, "edit.close discard=true").ok);

        // A reply, by the thread's own press: it opens in the reader the list follows, and lands in the thread.
        let reply = cell(&threads[0], "Reply");
        assert!(pressed(&mut app, &reply, "threads").ok);
        assert_eq!(app.draft_on(&app.layout.named("reader").unwrap()).map(|draft| draft.writes.kind()), Some("reply"));
        write(&mut app, "Agreed. June it is.");
        assert!(act(&mut app, "edit.save").ok && app.drafts.is_empty(), "{:?}", app.notice);
        let threads = rows(&app, "threads");
        assert!(threads[0].detail.as_deref().is_some_and(|detail| detail.contains("1 reply")), "{:?}", threads[0].detail);
        assert!(threads[0].view.as_ref().is_some_and(|view| view["children"].as_array().unwrap().iter().any(|child| child["text"] == "Agreed. June it is.")), "{:?}", threads[0].view);
        // Resolved by its own press, it is an earlier one, and its press brings it back.
        let resolve = cell(&threads[0], "Resolve");
        assert!(pressed(&mut app, &resolve, "threads").ok);
        let threads = rows(&app, "threads");
        assert_eq!((threads[0].group.as_deref(), threads[0].mark.as_deref()), (Some("earlier"), Some("resolved")), "{:?}", app.notice);
        assert!(cell(&threads[0], "Reopen").contains("open="));

        // An agent proposes an edit (another client); the list shows its change as the service found it; applied, it is in the note.
        let page = app.page().expect("the page").clone();
        let patch = |id: &str, observed: &str, replacement: &str, revision: u64| json!({ "id": id, "action": "draft.patch", "outline": "scratch", "propose": true, "blockId": bed_id, "revision": revision,
            "patches": [{ "observed": observed, "replacement": replacement }], "mutation": { "author": "agent", "actorId": "tidy-agent" } });
        assert_eq!(ask(patch("p1", "The beans go in May.", "The beans go in June.", page.revision))["outcome"], "proposed");
        assert!(act(&mut app, "tile.focus tile=proposals").ok);
        let mut proposals = Vec::new();
        for _ in 0..100 { proposals = rows(&app, "proposals"); if !proposals.is_empty() { break } std::thread::sleep(Duration::from_millis(50)); app.settle(); }
        assert_eq!(proposals.len(), 1, "{:?}", app.notice);
        assert_eq!(proposals[0].label, "An edit from tidy-agent");
        let view = proposals[0].view.clone().expect("the proposal carries its change");
        assert_eq!((view["type"].as_str(), view["added"].as_u64(), view["removed"].as_u64()), (Some("diff"), Some(1), Some(1)));
        assert!(view["lines"].as_array().unwrap().iter().any(|line| line["op"] == "add" && line["text"] == "The beans go in June."), "{view}");
        let apply = cell(&proposals[0], "Apply");
        assert!(pressed(&mut app, &apply, "proposals").ok);
        assert!(app.page().unwrap().text.contains("The beans go in June."), "{:?} {}", app.notice, app.page().unwrap().text);
        assert!(rows(&app, "proposals").is_empty());
        // Another, dismissed: the note is as it was and the list is empty again.
        let now = app.page().unwrap().revision;
        assert_eq!(ask(patch("p2", "Water at dusk.", "Water at dawn.", now))["outcome"], "proposed");
        for _ in 0..100 { proposals = rows(&app, "proposals"); if !proposals.is_empty() { break } std::thread::sleep(Duration::from_millis(50)); app.settle(); }
        let dismiss = cell(&proposals[0], "Dismiss");
        assert!(pressed(&mut app, &dismiss, "proposals").ok);
        assert!(rows(&app, "proposals").is_empty() && app.page().unwrap().text.contains("Water at dusk."), "{:?}", app.notice);

        // The texts the note had: the earlier one opens under its row, and Restore puts it back through the editor.
        assert!(act(&mut app, "tile.focus tile=revisions").ok);
        let revisions = rows(&app, "revisions");
        assert!(revisions.len() >= 2 && revisions[0].label.ends_with("the note now"), "{:?}", revisions.iter().map(|row| row.label.clone()).collect::<Vec<_>>());
        let earliest = revisions.last().unwrap().clone();
        assert!(earliest.folds && earliest.view.is_none());
        assert!(act(&mut app, &format!("list.pick id={} tile=revisions", earliest.id)).ok);
        let opened_row = rows(&app, "revisions").into_iter().find(|row| row.id == earliest.id).unwrap();
        let change = opened_row.view.clone().expect("the open revision carries its change");
        assert!(opened_row.open && change["type"] == "diff" && change["lines"].as_array().unwrap().iter().any(|line| line["op"] == "del" && line["text"] == "The beans go in May."), "{change}");
        let restore = cell(&opened_row, "Restore");
        assert!(pressed(&mut app, &restore, "revisions").ok);
        assert_eq!(words(&app), first, "the first text is in the editor: {:?}", app.notice);
        assert!(unsaved(&app) && app.page().unwrap().text.contains("June"), "nothing is written until it is saved");
        assert!(act(&mut app, "edit.save").ok);
        assert_eq!(app.page().unwrap().text, first);
        assert!(act(&mut app, "edit.close").ok);

        // The keys screen: the service's list of this window's own rows is the key table, row for row.
        assert!(act(&mut app, "screen.open name=keys").ok, "{:?}", app.notice);
        let listed: Vec<(String, crate::actline::Request, String)> = rows(&app, "keys").iter().filter(|row| !ListRow::cell(&row.cells[0]).is_empty())
            .map(|row| (ListRow::cell(&row.cells[0]), crate::actline::parse(&ListRow::cell(&row.cells[1])).unwrap(), ListRow::cell(&row.cells[2]))).collect();
        let table: Vec<(String, crate::actline::Request, String)> = crate::keys::table().iter().map(|bind| (bind.spec.clone(), crate::actline::parse(&bind.line).unwrap(), bind.layer.map_or("everywhere", crate::keys::Layer::name).to_string())).collect();
        assert_eq!(listed, table, "the keys screen equals the rows: the service wrote each line from the row this window handed it");
        // An action no key reaches is listed too, under what does reach it.
        assert!(rows(&app, "keys").iter().any(|row| row.group.as_deref() == Some("no key") && ListRow::cell(&row.cells[1]) == "proposal.apply"));

        // A screen with keys of its own, saved as a note: open, its keys are the table's first rows, written with the
        // kinds its tiles are served as, and the keys list on it is still the table, row for row.
        let spec = json!({ "name": "seed-list", "title": "Seed list", "layout": { "focus": "reader", "root": { "t": "split", "dir": "row", "weights": [0.5, 0.5], "kids": [{ "t": "leaf", "kind": "reader", "name": "reader" }, { "t": "leaf", "kind": "keymap", "name": "keys" }] } },
            "keys": [{ "key": "ctrl+l", "action": "bar.open", "args": { "scope": "screens" }, "says": "the screens" }, { "key": "K", "action": "tile.focus", "tile": "keys", "only": ["reader"] }] });
        ask(json!({ "id": "sk", "action": "screens.save", "outline": "scratch", "spec": spec, "mutation": { "author": "user" } }));
        for _ in 0..100 { app.settle(); if act(&mut app, "screen.open name=seed-list").ok { break } std::thread::sleep(Duration::from_millis(50)) }
        assert_eq!(app.screen.name, "seed-list", "{:?}", app.notice);
        let table = crate::keys::rows(&app);
        let tabled: Vec<(String, crate::actline::Request)> = table.as_array().unwrap().iter().map(|row| (row["chord"].as_str().unwrap().to_string(), crate::actline::parse(row["line"].as_str().unwrap()).unwrap())).collect();
        let listed: Vec<(String, crate::actline::Request)> = rows(&app, "keys").iter().filter(|row| !ListRow::cell(&row.cells[0]).is_empty()).map(|row| (ListRow::cell(&row.cells[0]), crate::actline::parse(&ListRow::cell(&row.cells[1])).unwrap())).collect();
        assert_eq!(listed, tabled, "a screen's own keys are the list's first rows and the table's");
        assert_eq!(tabled[1], ("K".to_string(), crate::actline::parse("tile.focus tile=keys").unwrap()));
        let own = &rows(&app, "keys")[1];
        assert_eq!((own.group.as_deref(), ListRow::cell(&own.cells[2]).as_str(), ListRow::cell(&own.cells[3]).contains("keys")), (Some("this screen"), "this screen · on screens.reader", true), "{:?}", own.cells);

        // The library: a component picked draws its own example, lowered by the service to what a page's parts are.
        assert!(act(&mut app, "screen.open name=library").ok, "{:?}", app.notice);
        assert!(rows(&app, "components").len() > 30);
        assert!(act(&mut app, "list.pick id=graph-stat tile=components").ok);
        let stat = rows(&app, "components").into_iter().find(|row| row.id == "graph-stat").unwrap();
        let drawn = stat.view.as_ref().and_then(|view| view["children"].as_array()).and_then(|children| children.iter().find(|child| child["title"] == "As drawn")).cloned().expect("its example, drawn");
        assert!(drawn["children"].as_array().unwrap().iter().any(|part| part["type"] == "part" && part["view"]["type"] == "row"), "{drawn}");
        // One whose example lists notes: a list inside what a row shows under itself.
        let picked = act(&mut app, "list.pick id=view tile=components");
        assert!(picked.ok, "{}", picked.said);
        let tile = app.layout.named("components").unwrap();
        assert!(app.unfolds(&tile) && app.list_ask(&tile).is_some_and(|ask| app.store().refusal(&ask).is_none()), "{:?}", app.list_ask(&tile).and_then(|ask| app.store().refusal(&ask).cloned()));
        let view = rows(&app, "components").into_iter().find(|row| row.id == "view").unwrap();
        assert!(view.open && view.view.is_some(), "the view component's example is answered: {:?}", view.label);
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// The tree against a real outline host: a fold's mark opens onto notes. A bed with only a comment (and a reply in
/// its thread) under it, one with only a proposed edit, and one with both are drawn with no mark, and a press on one
/// unfolds nothing; a bed with a real note among a comment and a proposal has the mark, and unfolding it lists that
/// note and nothing else. The service says which (its `hasNotes`, by outline-core's `isNoteUnder`), the window draws
/// the row's own word. And the window opens with its reader empty: no note is drawn until one is opened, and what it
/// says meanwhile is its kind's own description. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_the_tree_s_folds_open_onto_notes_and_a_reader_told_no_note_is_empty_over_the_socket() {
    use crate::client::Socket;
    use super::support::{press, rest, window};
    with_host("caret", |path, _| {
        let mut raw = Socket::connect(path);
        let mut n = 0;
        let mut ask = |mut request: Value| { n += 1; request["id"] = json!(format!("r{n}")); request["outline"] = json!("scratch"); asked(&mut raw, request).unwrap_or_else(|refused| panic!("the host refused: {refused}")) };
        let mut note = |text: &str, parent: Option<&str>| { let made = ask(json!({ "action": "create", "parentId": parent, "text": text, "author": "user" })); (made["id"].as_str().unwrap().to_string(), made["revision"].clone()) };
        let (beds, _) = note("Beds", None);
        let (north, north_at) = note("North bed [type::bed]", Some(&beds));
        let (south, south_at) = note("South bed [type::bed]", Some(&beds));
        let (east, east_at) = note("East bed [type::bed]", Some(&beds));
        let (west, west_at) = note("West bed [type::bed]", Some(&beds));
        let (row, _) = note("First row", Some(&west));
        let mut comment = |on: &str, at: &Value, body: &str| ask(json!({ "action": "annotations.batch", "requestId": format!("comment-{on}"), "author": "user", "operations": [{ "operationId": "1", "type": "block-comment", "input": { "blockId": on, "expectedRevision": at, "body": body, "source": "user" } }] }))["annotations"][0]["block"]["id"].as_str().unwrap().to_string();
        let thread = comment(&north, &north_at, "Too early for peas?");
        comment(&east, &east_at, "Shade from the plum by noon.");
        comment(&west, &west_at, "Leeks again?");
        ask(json!({ "action": "annotations.reply", "requestId": "reply-north", "author": "agent", "provenance": { "actorId": "tidy-agent" }, "input": { "annotationId": thread, "body": "The log says the last frost was May 19.", "source": "agent" } }));
        let mut propose = |on: &str, at: &Value, observed: &str, replacement: &str| assert_eq!(ask(json!({ "action": "draft.patch", "propose": true, "blockId": on, "revision": at, "patches": [{ "observed": observed, "replacement": replacement }], "mutation": { "author": "agent", "actorId": "tidy-agent" } }))["outcome"], "proposed");
        propose(&south, &south_at, "South bed", "South bed, by the wall");
        propose(&east, &east_at, "East bed", "East bed, under the plum");
        propose(&west, &west_at, "West bed", "West bed, by the gate");

        let mut app = App::new(Box::new(Socket::connect(path)), "scratch").blocking(true);
        app.start();
        app.settle();
        opened(&mut app);
        let tree = app.layout.named("tree").expect("the desk has a tree");
        let reader = app.reader().expect("the desk has a reader");
        // The window opened on its screen with the reader told no note: it shows none, and the layout reads none.
        assert_eq!((app.subject(), app.facts(&reader).showing, app.page().is_some()), (None, None, false));
        let about = app.kind_row(&app.spec(&reader).unwrap().kind).map(|row| row.about.clone()).expect("the reader's kind has a row");
        let mut rt = window(app);
        rest(&mut rt);
        let says = |rt: &rune::Runtime<App>, key: &str| -> Vec<String> { rt.elements().into_iter().filter(|e| e.key.as_deref() == Some(key)).filter_map(|e| e.text).collect() };
        assert!(!about.is_empty() && says(&rt, "tile/reader/empty/about") == [about.clone()], "the empty reader says its kind's own description: {:?}", says(&rt, "tile/reader/empty/about"));
        assert!(rt.find("tile/reader/note").is_none(), "and draws no note: not the outline's first");
        // The beds unfolded, as a press on its row does once it is the open note: the first press opens it and unfolds it.
        let folds = |rt: &rune::Runtime<App>, id: &str| rt.find(&format!("tile/tree/row/{id}/fold")).is_some();
        assert!(folds(&rt, &beds), "a note with notes under it has the mark");
        press(&mut rt, &format!("tile/tree/row/{beds}"));
        assert_eq!(rt.state.subject().as_deref(), Some(beds.as_str()));
        assert!(rt.state.ui(&tree).unfolded.contains(&beds), "{:?}", rt.state.ui(&tree).unfolded);
        let under = |rt: &rune::Runtime<App>, parent: &str| -> Vec<(String, usize, bool)> {
            let rows = rt.state.rows_of(&tree);
            let at = rows.iter().position(|row| row.id == parent).expect("the parent is listed");
            rows[at + 1..].iter().take_while(|row| row.depth > rows[at].depth).map(|row| (row.label.clone(), row.depth - rows[at].depth, row.folds)).collect()
        };
        assert_eq!(under(&rt, &beds), [("North bed".to_string(), 1, false), ("South bed".to_string(), 1, false), ("East bed".to_string(), 1, false), ("West bed".to_string(), 1, true)], "the service says a fold only of the bed with a note under it");
        // Drawn: no mark on a bed with only comments, only a proposal, or both; a mark on the one with a note.
        assert_eq!([&north, &south, &east, &west].map(|id| folds(&rt, id)), [false, false, false, true]);
        // A press on a bed with only a comment under it opens it, and a second folds nothing: nothing is listed under it.
        for id in [&north, &south, &east] {
            press(&mut rt, &format!("tile/tree/row/{id}"));
            press(&mut rt, &format!("tile/tree/row/{id}"));
            assert_eq!(rt.state.subject().as_deref(), Some(id.as_str()));
            assert!(!rt.state.ui(&tree).unfolded.contains(id.as_str()) && under(&rt, id).is_empty());
        }
        // What is under the north bed is listed where comments are: its thread, with the reply.
        press(&mut rt, &format!("tile/tree/row/{north}"));
        let threads = rt.state.rows_of(&rt.state.layout.named("threads").expect("the desk has the comments")).to_vec();
        assert_eq!(threads.iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["Too early for peas?"]);
        // The west bed's mark opens onto its one note, and not onto the comment or the proposal beside it.
        press(&mut rt, &format!("tile/tree/row/{west}"));
        assert!(rt.state.ui(&tree).unfolded.contains(&west));
        assert_eq!(under(&rt, &west), [("First row".to_string(), 1, false)]);
        assert!(rt.find(&format!("tile/tree/row/{row}")).is_some() && !folds(&rt, &row), "its note is on screen under it");
        // Its page says the same of it: one note under it.
        let page = rt.state.page().expect("the west bed's page came");
        let listed: Vec<(String, bool)> = page.under.as_ref().and_then(|list| list["rows"].as_array()).into_iter().flatten().map(|row| (row["label"].as_str().unwrap_or("").to_string(), row["folds"] == true)).collect();
        assert_eq!(listed, [("First row".to_string(), false)]);
        // Every mark on screen is on a row that, opened, has a row under it.
        let rows = rt.state.rows_of(&tree).to_vec();
        for (at, row) in rows.iter().enumerate().filter(|(_, row)| row.folds && row.open) { assert!(rows.get(at + 1).is_some_and(|next| next.depth == row.depth + 1), "{} is open onto nothing", row.label) }
    });
}


/// W8's list against a real outline host: the programs a window runs (a made-up shell's, on a scripted host) are
/// handed to the service's `lists.read from=programs`, and the rows it writes are what runs: each this window's
/// own a row whose pick is the jump, what it reports of itself as its mark, the keeper's other work listed after
/// with no pick. A detached agent's row gives it a tile again. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_the_programs_list_is_what_runs_and_its_row_jumps() {
    use crate::client::Socket;
    use crate::pty::canned::Canned;
    use std::process::{Command, Stdio};
    let root = std::env::temp_dir().join(format!("ep0ch-native-live-programs-{}", std::process::id()));
    let outlines = root.join("o");
    std::fs::create_dir_all(&outlines).unwrap();
    let outliner = concat!(env!("CARGO_MANIFEST_DIR"), "/../outliner");
    let mut host = Command::new("bun").arg("src/host-main.ts").current_dir(outliner)
        .env("EP0CH_OUTLINES", &outlines).env("EP0CH_DEFAULT_WS", "scratch").env("XDG_CONFIG_HOME", root.join("config"))
        .env_remove("EP0CH_SOCKET").env_remove("EP0CH_WS").stdout(Stdio::null()).stderr(Stdio::null()).spawn().expect("bun starts the host");
    let socket = outlines.join(".host/host.sock");
    let path = socket.to_str().unwrap().to_string();
    let result = std::panic::catch_unwind(|| {
        for _ in 0..200 { if socket.exists() { break } std::thread::sleep(Duration::from_millis(50)) }
        let asking = |raw: &mut Socket, request: Value| -> Value {
            raw.send(&request);
            raw.wait(request["id"].as_str().unwrap(), Duration::from_secs(20));
            let line = raw.take().into_iter().find(|l| l["id"] == request["id"]).expect("the host answers");
            assert_eq!(line["ok"], true, "{line}");
            line["result"].clone()
        };
        // (A connection belongs to the outline its first line names: the host makes it on one of its own.)
        asking(&mut Socket::connect(&path), json!({ "id": "a", "action": "outlines.attach", "name": "scratch", "create": true }));
        let mut raw = Socket::connect(&path);
        let mut ask = |request: Value| asking(&mut raw, request);
        let plan = ask(json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": "Bed plan [type::plan]\nFour beds this year.", "author": "user" }));

        let script = json!({ "backend": "herdr-core", "keeps": true, "reports": { "seedbot --plan beds": { "state": "working", "msg": "planning the beds" } }, "others": [{ "address": "t4", "name": "compost", "runs": "tail -f compost.log", "status": "idle" }] });
        let mut app = App::new(Box::new(Socket::connect(&path)), "scratch").blocking(true).running_on(Box::new(Canned::read(&script)));
        app.start();
        app.settle();
        opened(&mut app);
        act(&mut app, &format!("open id={}", plan["id"].as_str().unwrap()));
        // The kinds a terminal draws are the service's rows (the terminal extension, on wherever the service runs).
        assert!(act(&mut app, "terminal.open").ok && act(&mut app, "terminal.open agent=true command=\"seedbot --plan beds\"").ok, "{:?}", app.notice);
        assert!(act(&mut app, "tile.leave").ok);

        // The list as a tile: every row the service wrote, by what runs.
        assert!(act(&mut app, "tile.split kind=programs name=running tile=shell dir=down").ok, "{:?}", app.steps.last());
        app.settle();
        let tile = app.layout.all().into_iter().find(|tile| app.layout.name(tile) == "running").expect("the programs tile");
        let listed = |app: &App| app.rows_of(&tile).iter().map(|row| (row.id.clone(), row.label.clone(), row.mark.clone().unwrap_or_default(), row.group.clone().unwrap_or_default(), row.act.clone())).collect::<Vec<_>>();
        assert_eq!(listed(&app), vec![
            ("scratch-1".to_string(), "Shell".to_string(), "running".to_string(), "In a tile".to_string(), Some("terminal.jump key=\"scratch-1\"".to_string())),
            ("scratch-2".to_string(), "Agent".to_string(), "working".to_string(), "In a tile".to_string(), Some("terminal.jump key=\"scratch-2\"".to_string())),
            ("theirs:t4".to_string(), "compost".to_string(), "idle".to_string(), "Not this window's".to_string(), None),
        ]);
        assert_eq!(app.list_of(&tile).unwrap().list.title.as_deref(), Some("Programs · 2 running"));

        // Detached, the agent is listed with no tile; its row, picked, is the jump: it has a tile again, and the keys.
        assert!(act(&mut app, "terminal.detach tile=agent").ok);
        app.settle();
        assert_eq!(listed(&app)[1].3, "Running, in no tile");
        assert!(act(&mut app, "list.pick id=scratch-2 tile=running").ok, "{:?}", app.steps.last());
        app.settle();
        assert_eq!(app.person().typing_in.as_deref(), Some("agent"));
        assert_eq!(listed(&app)[1].3, "In a tile");
        // A close ends it: the list is one row shorter, and the keeper's other work is still there, untouched.
        assert!(act(&mut app, "tile.leave").ok && act(&mut app, "tile.close tile=agent").ok);
        app.settle();
        assert_eq!(listed(&app).iter().map(|row| row.0.clone()).collect::<Vec<_>>(), vec!["scratch-1", "theirs:t4"]);
    });
    let _ = host.kill();
    let _ = host.wait();
    let _ = std::fs::remove_dir_all(&root);
    if let Err(panic) = result { std::panic::resume_unwind(panic) }
}

/// H1's sentence against a real outline host: a block is written as in the door. Two lines pasted with a bare
/// carriage return between them (two files copied in a file manager) are saved as two lines, and the service
/// serves each as a picture part; Tab puts the second item under the first; and the list that completes a
/// property's value says what its lit row is, in its component's own words, with the service's drawing of what
/// choosing it makes and the lit row of how many. `cargo test -- --ignored live` (it needs bun).
#[test]
#[ignore = "starts an outline host with bun"]
fn live_a_block_is_written_as_in_the_door_a_paste_keeps_its_lines_tab_indents_and_the_list_says_what_a_row_is() {
    use super::support::{chord, draft, press, primary, rest, typed, window};
    use crate::client::Socket;
    use crate::draft::Hold;
    use rune::{Key, Mods, Runtime};
    with_host("typing", |path, root| {
        let mut raw = Socket::connect(path);
        let saved = "Seed tray [type::tray]\nWhat came up this week.";
        let note = asked(&mut raw, json!({ "id": "b", "action": "create", "outline": "scratch", "parentId": null, "text": saved, "author": "user" })).unwrap();
        let id = note["id"].as_str().unwrap().to_string();
        fn until(rt: &mut Runtime<App>, what: &str, so: impl Fn(&App) -> bool) {
            for _ in 0..400 { if so(&rt.state) { rest(rt); return } std::thread::sleep(Duration::from_millis(25)); rt.update(|s, _| { s.beat(); }); for _ in 0..3 { rt.frame(1.0 / 60.0); } }
            panic!("{what} never came: notice {:?}, draft {:?}", rt.state.notice, draft(&rt.state).map(|d| d.buf.words().to_string()));
        }
        let mut app = App::new(Box::new(Socket::connect(path)), "scratch").arranged_in(root.join("state/native-scratch.layout.json"));
        app.start();
        opened(&mut app);
        act(&mut app, &format!("open id={id}"));
        let mut rt = window(app);
        until(&mut rt, "the note's page", |s| s.page().is_some_and(|page| page.title == "Seed tray"));
        press(&mut rt, "tile/reader/edit");
        until(&mut rt, "the hold", |s| draft(s).is_some_and(|d| matches!(d.hold, Hold::Held { .. })));

        // The paste, as the platform hands it over: a carriage return between the two lines, and nothing else.
        chord(&mut rt, Key::Enter, Mods::default());
        rt.paste("- [img::shots/one.png]\r- [img::shots/two.png]");
        rest(&mut rt);
        let pasted = format!("{saved}\n- [img::shots/one.png]\n- [img::shots/two.png]");
        assert_eq!(words(&rt.state), pasted, "each line once, on a line of its own");
        chord(&mut rt, Key::Command('s'), primary());
        until(&mut rt, "the save", |s| draft(s).is_some_and(|d| !d.unsaved()));
        // What the service holds has two lines, and it serves each as a picture part (one line was neither).
        let page = asked(&mut raw, json!({ "id": "c", "action": "notes.page", "outline": "scratch", "blockId": id })).unwrap();
        assert_eq!(page["text"], pasted.as_str());
        let pictures: Vec<&str> = page["parts"].as_array().unwrap().iter().filter(|part| part["kind"] == "picture").filter_map(|part| part["view"]["path"].as_str()).collect();
        assert_eq!(pictures, ["shots/one.png", "shots/two.png"], "{}", page["parts"]);

        // Tab: the second item goes under the first, and the keys stay in the block.
        chord(&mut rt, Key::Tab, Mods::default());
        assert_eq!((words(&rt.state), rt.state.person().focus.as_str()), (format!("{saved}\n- [img::shots/one.png]\n  - [img::shots/two.png]").as_str(), "reader"));
        chord(&mut rt, Key::Tab, Mods { shift: true, ..Mods::default() });
        assert_eq!(words(&rt.state), pasted);

        // A property's value begun: the service answers the five its component knows (the notes carry none yet).
        chord(&mut rt, Key::Enter, Mods::default());
        typed(&mut rt, "[heading-pattern::");
        until(&mut rt, "the values", |s| s.completing("reader").is_some_and(|found| found.rows.len() == 5));
        let found = rt.state.completing("reader").unwrap().clone();
        let mut labels: Vec<&str> = found.rows.iter().map(|row| row.label.as_str()).collect();
        labels.sort();
        assert_eq!(labels, ["dots", "rule", "stack", "uptime", "waffle"]);
        assert!(found.rows.iter().all(|row| row.docs.as_deref().is_some_and(|docs| !docs.is_empty())), "each says what it is: {found:?}");
        // The lit row's words beside the list, the service's drawing of what it makes, and the count under it.
        let texts = |rt: &Runtime<App>| -> Vec<String> { rt.elements().into_iter().filter_map(|e| e.text).collect() };
        let shown = |s: &App, n: usize| s.completing_lit("reader").filter(|(row, _)| row.label == s.completing("reader").unwrap().rows[n].label).and_then(|(_, view)| view.cloned());
        until(&mut rt, "the first row's drawing", |s| shown(s, 0).is_some());
        let first = shown(&rt.state, 0).unwrap();
        assert_eq!(first["children"].as_array().unwrap().iter().map(|boxed| boxed["title"].as_str().unwrap_or("")).collect::<Vec<_>>(), ["As written", "As drawn"]);
        assert!(first["children"][0]["children"][0]["text"].as_str().unwrap().contains(&format!("[heading-pattern::{}]", found.rows[0].label)), "{first}");
        assert!(rt.find("tile/reader/complete-docs").is_some() && rt.find("tile/reader/complete-count").is_some());
        assert!(texts(&rt).iter().any(|said| said == &format!("{} 1/5", found.heading.clone().unwrap_or_default())), "{:?}", texts(&rt));
        assert!(texts(&rt).iter().any(|said| said.contains(found.rows[0].docs.as_deref().unwrap())), "the lit row's own words are drawn: {:?}", texts(&rt));
        // Down: the next row's, asked of the service with that row lit.
        chord(&mut rt, Key::Down, Mods::default());
        until(&mut rt, "the second row's drawing", |s| draft(s).is_some_and(|d| d.completing.lit == 1) && shown(s, 1).is_some());
        assert!(shown(&rt.state, 1).unwrap()["children"][0]["children"][0]["text"].as_str().unwrap().contains(&format!("[heading-pattern::{}]", found.rows[1].label)));
        assert!(texts(&rt).iter().any(|said| said.ends_with(" 2/5")));
        // Tab writes the lit row: the list is still the list's while it is open.
        chord(&mut rt, Key::Tab, Mods::default());
        assert!(words(&rt.state).ends_with(&format!("[heading-pattern::{}]", found.rows[1].label)), "{}", words(&rt.state));
    });
}
