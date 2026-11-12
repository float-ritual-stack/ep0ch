//! The window against a real outline host: the socket, the handshake, a page, a save through the dispatcher, and a
//! change made by someone else arriving as a watched answer.
use std::time::Duration;

use serde_json::{Value, json};

use super::support::act;
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
        assert!(app.online && !app.machine.is_empty(), "{:?}", app.notice);
        act(&mut app, &format!("open id={}", plan["id"].as_str().unwrap()));
        let page = app.page().expect("the page came");
        assert_eq!(page.title, "Plan");
        let todo = |app: &App| -> Vec<String> { app.page().unwrap().parts.iter().filter(|part| part["view"]["type"] == "list").flat_map(|part| part["view"]["rows"].as_array().cloned().unwrap_or_default()).map(|row| row["label"].as_str().unwrap_or("").to_string()).collect() };
        assert_eq!(todo(&app), ["Lift the onions"]);
        assert!(page.parts[0]["view"]["text"].as_str().is_some_and(|text| text.contains(&format!("[Shed](ep0ch:b/{})", shed["id"].as_str().unwrap()))));

        // The bar's notes are the service's search: what a word typed costs, said for the record (DESIGN.md §7).
        let asked = std::time::Instant::now();
        act(&mut app, "bar.open scope=notes query=onions");
        let rows = crate::bar::rows(&app);
        eprintln!("the bar's search for one word answered {} row(s) in {:.1} ms, over the socket", rows.len(), asked.elapsed().as_secs_f64() * 1000.0);
        assert!(rows.iter().any(|row| row.label == "Lift the onions" && row.line == format!("open id={}", chore["id"].as_str().unwrap())), "{rows:?}");
        act(&mut app, "bar.close");

        // This window writes: saved at the revision it read, and the page it shows is the saved one.
        act(&mut app, "edit");
        let text = format!("{}\n\nBring the trug.", app.editor.text);
        app.field(Field::Draft).replace_text(text);
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
        assert!(app.online, "{:?}", app.notice);
        // Split the reader, put the tree in a tab with the backlinks in the dock, and save it.
        for line in ["tile.split", "tile.move side=center to=backlinks tile=tree", "screen.save name=\"Garden work\""] { let done = act(&mut app, line); assert!(done.ok, "{line}: {}", done.said) }
        assert!(app.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.starts_with("Saved the screen garden-work")), "{:?}", app.notice);
        let (note, _) = app.screen.note().map(|(id, revision)| (id.to_string(), revision)).expect("the arrangement is the note's screen now");
        // The note is the block form: its header, then the layout as blocks under it.
        let header = ask(json!({ "id": "d", "action": "get", "outline": "scratch", "blockId": note }));
        assert!(header["text"].as_str().unwrap().starts_with("Garden work [type::screen] [screen::garden-work] [focus::tree]"), "the tile moved last has the keys: {header}");
        let kids = |ask: &mut dyn FnMut(Value) -> Value, id: &str, n: &str| ask(json!({ "id": n, "action": "children", "outline": "scratch", "parentId": id }));
        let under = kids(&mut ask, &note, "e");
        assert!(under[0]["text"].as_str().unwrap().starts_with("split row"), "{under}");
        // The service lists it back, and its layout is the arrangement as it stands.
        let listed = app.screens().into_iter().find(|s| s.name == "garden-work").expect("the screen is listed");
        assert_eq!((listed.title.as_str(), listed.problems.len()), ("Garden work", 0), "{:?}", listed.problems);
        assert_eq!(listed.layout().unwrap().save(), app.layout.save(), "the note reads back as the layout it was saved from");

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
        assert_eq!((app.spec("reader2").map(|s| s.kind.as_str()), app.problems_of("reader2").len()), (Some("reader"), 0));
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
