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
        let todo = |app: &App| -> Vec<String> { app.page().unwrap().parts.iter().flat_map(|part| match part { crate::page::Part::Rows { groups, .. } => groups.iter().flat_map(|g| g.rows.iter().map(|r| r.text.clone())).collect(), _ => Vec::new() }).collect() };
        assert_eq!(todo(&app), ["Lift the onions"]);
        assert!(matches!(&page.parts[0], crate::page::Part::Prose { markdown } if markdown.contains(&format!("[Shed](ep0ch:b/{})", shed["id"].as_str().unwrap()))));

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

