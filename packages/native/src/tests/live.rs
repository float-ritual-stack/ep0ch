//! The window against a real outline host: the socket, the handshake, a page, a save through the dispatcher, and a
//! change made by someone else arriving as a watched answer.
use std::time::Duration;

use serde_json::{Value, json};

use super::support::act;

/// The window has opened on a screen: the host's extensions may still be loading when the window first asks, and
/// the watched list says so when they have.
fn opened(app: &mut App) {
    for _ in 0..200 { if !app.screen.is_nowhere() && !app.kinds().is_empty() { return } std::thread::sleep(Duration::from_millis(50)); app.settle(); }
    panic!("no screen opened: {:?}", app.notice);
}
use crate::actions::{App, Field, Tone};
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
        let text = format!("{}\n\nBring the trug.", app.editor.words());
        app.field(Field::Draft).replace(text);
        act(&mut app, "edit.save");
        assert!(!app.unsaved() && app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.starts_with("Saved")), "{:?}", app.notice);
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
        assert!(step.ok && step.by == Actor::Person, "the person's press is the run's consent: its act is theirs");
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
        assert_eq!(names(&app), ["tree", "reader", "props", "backlinks"]);
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
