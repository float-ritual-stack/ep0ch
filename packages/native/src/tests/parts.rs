//! A page's parts, through the primitive registry: every type the service answers has a builder, a note's button
//! runs here or is the service's to run, and what a script asks of this window is run by the dispatcher and answered.
use serde_json::{Value, json};

use super::support::*;
use crate::actions::Actor;
use crate::tiles::prim;

fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../outline-core/fixtures").join(name);
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).unwrap()
}

#[test]
fn every_primitive_type_the_service_answers_has_a_builder_and_no_builder_is_for_a_type_nobody_answers() {
    let listed = fixture("primitives.json");
    let mut answered: Vec<String> = listed["types"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().to_string()).collect();
    answered.extend(listed["page"].as_object().unwrap().keys().cloned());
    for ty in &answered { assert!(prim::find(ty).is_some(), "the service answers `{ty}` primitives and PRIMS has no builder for one") }
    let mut seen = std::collections::BTreeSet::new();
    for entry in prim::PRIMS {
        assert!(answered.iter().any(|ty| ty == entry.ty), "PRIMS builds `{}`, which outline-core's primitives.json doesn't list", entry.ty);
        assert!(seen.insert(entry.ty), "`{}` has two builders", entry.ty);
        assert!(entry.describe.len() > 20, "`{}` says how it is drawn here", entry.ty);
    }
    // The registry is what `actions` over the control socket says of it: read from the entries, written nowhere else.
    let said = crate::tiles::described();
    assert_eq!(said["primitives"].as_array().unwrap().len(), prim::PRIMS.len());
    assert_eq!(said["primitives"][0], json!({ "type": prim::PRIMS[0].ty, "describe": prim::PRIMS[0].describe, "fills": prim::PRIMS[0].fills }));
}

#[test]
fn a_page_is_its_parts_built_by_type_and_one_nobody_knows_is_drawn_as_its_data() {
    let mut rt = window(garden(ok()).app);
    // The stat figure came as a row of stats, the links and the view as lists, the buttons as buttons: each under its part.
    for key in ["tile/reader/hero", "tile/reader/title", "tile/reader/edit", "tile/reader/chip/type/chore", "tile/reader/part/2", "tile/reader/part/2/view", "tile/reader/part/2/0", "tile/reader/part/2/1", "tile/reader/part/3/fork", "tile/reader/part/4/view", "tile/reader/part/5/view", "tile/reader/child/fork"] {
        assert_eq!(rt.find(key).is_some(), key != "tile/reader/hero", "{key}");
    }
    // A primitive of a type nobody draws is its data where it stands, and the parts after it are still drawn.
    let unknown = part("plot", "component", 20, json!({ "name": "trellis" }), json!({ "type": "hologram", "beds": 4 }));
    let reader = rt.state.reader().unwrap();
    let cx = rt.state.cx(&reader).unwrap();
    let k = rune_kit::Kit::neutral(false);
    // Building it doesn't panic, and neither does a part with no view at all or a view nested past any depth.
    let at = prim::PrimCx::of(&cx);
    prim::build(&unknown, &at, &k);
    prim::build(&json!({ "type": "part", "name": "bare" }), &at, &k);
    prim::build(&json!({ "type": "table", "rows": "not rows", "columns": 4 }), &at, &k);
    let deep = (0..40).fold(json!({ "type": "text", "text": "the bottom" }), |inner, _| json!({ "type": "box", "children": [inner] }));
    prim::build(&deep, &at, &k);
    drop(cx);
    press(&mut rt, "tile/reader/part/3/fork");
    assert_eq!(rt.state.page().unwrap().title, "Take the fork", "a row of a part's list opens its note");
}

#[test]
fn a_button_whose_act_line_this_window_has_runs_here_as_whoever_pressed_and_says_so_on_the_tile() {
    let Garden { app, asked, .. } = garden(ok());
    let mut rt = window(app);
    let from = rt.state.steps.len();
    press(&mut rt, "tile/reader/part/4/view");
    let steps: Vec<String> = rt.state.steps[from..].iter().map(|step| step.line()).collect();
    assert_eq!(steps, ["note.new tile=reader", "button.press line=12 note=plot tile=reader"], "the press is button.press, and its act line ran through the dispatcher as its own step");
    assert!(rt.state.steps[from..].iter().all(|step| step.ok && step.by == Actor::Person));
    assert!(actions(&asked).contains(&"create".to_string()) && !actions(&asked).contains(&"scripts.sequence".to_string()), "it ran here: the service was asked for the note, not to run the button");
    let reader = rt.state.reader().unwrap();
    let said = rt.state.ui(&reader).said.clone().expect("what the press did is kept on the tile");
    assert_eq!((said.block.as_str(), said.line, said.words.as_str(), said.ok), ("plot", 12, "Sow the peas ran note.new, as you", true));
    // An agent's press is the agent's: the write it leads to is recorded as the agent.
    let Garden { mut app, asked, .. } = garden(ok());
    let outcome = app.act("button.press label=\"Sow the peas\"", Actor::Agent("compost-agent".into()));
    assert!(outcome.ok, "{}", outcome.said);
    assert_eq!(outcome.answer["ran"], "here");
    let made = asked.borrow().iter().rev().find(|a| a["action"] == "create").cloned().unwrap();
    assert_eq!((made["author"].as_str(), made["provenance"]["actorId"].as_str()), (Some("agent"), Some("compost-agent")));
    assert!(app.ui(&app.reader().unwrap()).said.as_ref().unwrap().words.ends_with("as an agent (compost-agent)"));
}

#[test]
fn a_button_with_steps_is_the_service_s_to_run_and_what_its_script_asks_of_this_window_is_run_and_answered() {
    let Garden { app, asked, said, .. } = garden(ok());
    let client = app.store().client().to_string();
    let mut rt = window(app);
    press(&mut rt, "tile/reader/part/5/view");
    rest(&mut rt);
    let run = asked.borrow().iter().rev().find(|a| a["action"] == "scripts.sequence").cloned().expect("the service is asked to run it");
    assert_eq!((run["blockId"].as_str(), run["line"].as_u64(), run["clientId"].as_str()), (Some("plot"), Some(13), Some(client.as_str())), "by its note and line, with this window named for its acts");
    assert_eq!(run["mutation"]["author"], "user", "recorded as whoever pressed");
    let reader = rt.state.reader().unwrap();
    assert_eq!(rt.state.ui(&reader).said.as_ref().unwrap().words, "Tidy the shed: running…", "the service took it and is running it");
    assert!(rt.find("tile/reader/part/5/said").is_some(), "said under the button that was pressed");

    // The run's script acts in this window: the call is aimed at this client, run by the dispatcher, and answered.
    let call = |request: &str, target: &str, action: &str, args: Value| json!({ "event": { "domain": "script", "action": "scripts.act", "script": {
        "requestId": request, "targetClientId": target, "action": action, "args": args, "actor": { "author": "agent", "actorId": "script:tidy" }, "requestedBy": { "author": "user" } } } });
    let answers = |asked: &Asked| -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == "scripts.answer").cloned().collect() };
    rt.update({ let (said, line) = (said.clone(), call("r1", &client, "open", json!({ "id": "shed" }))); move |s, _| host_says(s, &said, line.clone()) });
    assert_eq!(rt.state.subject().as_deref(), Some("shed"), "the script's open ran here");
    let step = rt.state.steps.last().unwrap();
    assert_eq!((step.line().as_str(), &step.by, step.ok), ("open id=shed", &Actor::Person, true), "a run the person's press started acts as the person");
    assert_eq!(rt.state.agent_said.as_deref(), Some("script:tidy · open"), "and the status line names the script");
    let answered = answers(&asked);
    assert_eq!((answered.len(), answered[0]["requestId"].as_str(), answered[0]["clientId"].as_str(), answered[0].get("error")), (1, Some("r1"), Some(client.as_str()), None));

    // An action this window hasn't, or a call nobody pressed for, is answered in the dispatcher's own words; a call for another window is not ours.
    rt.update({ let (said, line) = (said.clone(), call("r2", &client, "desk.dance", json!({}))); move |s, _| host_says(s, &said, line.clone()) });
    assert!(answers(&asked)[1]["error"].as_str().unwrap().starts_with("no action named desk.dance"), "{}", answers(&asked)[1]);
    rt.update({ let (said, line) = (said.clone(), call("r3", "door-7", "open", json!({ "id": "plot" }))); move |s, _| host_says(s, &said, line.clone()) });
    assert_eq!((answers(&asked).len(), rt.state.subject().as_deref()), (2, Some("shed")), "a call aimed at another client is left to it");
    let mut unasked = call("r4", &client, "edit", json!({}));
    unasked["event"]["script"]["requestedBy"] = json!({ "author": "agent", "actorId": "compost-agent" });
    rt.update({ let said = said.clone(); move |s, _| host_says(s, &said, unasked.clone()) });
    assert!(answers(&asked)[2]["error"].is_string() && rt.state.editing.is_none(), "a script nobody pressed acts as the script: the person's editor is not its to open");

    // The run ends: the service says so, and the tile says how it went, where it was pressed. Another run's end is not this one's.
    let ended = |run: &str, reason: &str, message: &str| json!({ "event": { "domain": "script", "action": "scripts.ended", "ended": { "run": run, "reason": reason, "message": message, "requestedBy": { "author": "user" }, "written": [], "undo": true } } });
    rt.update({ let (said, line) = (said.clone(), ended("run-9", "failed", "another window's")); move |s, _| host_says(s, &said, line.clone()) });
    assert_eq!(rt.state.ui(&reader).said.as_ref().unwrap().words, "Tidy the shed: running…");
    rt.update({ let (said, line) = (said.clone(), ended("run-1", "done", "swept the shed")); move |s, _| host_says(s, &said, line.clone()) });
    let last = rt.state.ui(&reader).said.clone().unwrap();
    assert_eq!((last.words.as_str(), last.ok, last.run), ("Tidy the shed ran, as you: swept the shed", true, None));
}

#[test]
fn a_press_names_one_button_and_a_button_that_can_t_run_says_why() {
    let Garden { mut app, .. } = garden(ok());
    for (line, why) in [
        ("button.press", "2 buttons here: name one by line= (12, 13)"),
        ("button.press line=3", "no button on line 4 in this note · peek lists its parts"),
        ("button.press label=Prune", "no button labelled Prune in this note · peek lists its parts"),
        ("button.press line=12 note=shed", "reader shows another note (plot), not shed: open it there first"),
    ] {
        let outcome = act(&mut app, line);
        assert_eq!((outcome.ok, outcome.said.as_str()), (false, why), "{line}");
    }
    // peek lists a note's parts: what an agent names a button by.
    let reader = app.reader().unwrap();
    let facts = (crate::tiles::page::DRAWER.facts)(&app.cx(&reader).unwrap());
    assert_eq!(facts["parts"][4], json!({ "kind": "button", "line": 12, "name": "button", "title": null, "error": null, "draws": "button", "label": "Sow the peas" }));
}

// ── the coverage table ──────────────────────────────────────────────────────────────────────────────────────

/// A window on one note: the page the service answered of a component's own example.
fn example_window(component: &Value) -> rune::Runtime<crate::actions::App> {
    let (asked, said): (Asked, Said) = Default::default();
    let page = component["page"].clone();
    let answers: Answers = Box::new(move |ask| match ask["action"].as_str().unwrap_or("") {
        "ping" => Ok(json!({ "status": "ready", "protocolVersion": crate::client::PROTOCOL, "location": { "machine": "box" }, "outline": { "name": "garden" } })),
        "blocks.read" => Ok(json!({ "generation": 0, "blocks": if ask["under"].is_null() { json!([{ "id": "example", "title": page["title"], "hasChildren": false }]) } else { json!([]) } })),
        "notes.page" => Ok(json!({ "blockId": "example", "revision": 1, "title": page["title"], "text": page["text"], "chips": page["chips"], "properties": [], "parts": page["parts"], "hero": page["hero"],
            "ancestors": [], "children": [], "backlinks": [], "updated": "2031-04-01T09:00:00.000Z", "author": "user" })),
        "media.read" => Ok(json!({ "path": ask["path"], "mime": "image/svg+xml", "from": "file", "base64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, SUN) })),
        "screens.list" => Ok(json!({ "screens": [], "problems": [], "anyChange": true })),
        "events.subscribe" => Ok(json!({ "subscribed": true })),
        action => Err(("failed", format!("no action {action}"))),
    });
    // As a headless render runs: each ask waits for its answer and a picture is decoded before the frame that shows it.
    let mut app = crate::actions::App::new(Box::new(Standin { answers, asked, said }), "garden").blocking(true);
    app.start();
    app.settle();
    let mut rt = window(app);
    rest(&mut rt);
    rt
}

/// Whether prose still holds a form only Blockdown reads, outside its code: `[key::value]`, `{{ }}`, `((id))`, a `::component` line.
fn blockdown_left(markdown: &str) -> bool {
    let mut code = false;
    markdown.lines().any(|line| {
        if line.trim_start().starts_with("```") || line.trim_start().starts_with("~~~") { code = !code; return false }
        !code && (line.contains("((") || line.contains("{{") || line.trim_start().starts_with("::") || line.split('[').skip(1).any(|rest| rest.split(']').next().is_some_and(|inner| inner.contains("::"))))
    })
}

/// How one component's example fared here: `draws`, `partly`, `problem` or `empty`, what its parts drew as, and why.
fn fared(component: &Value) -> (&'static str, String, String) {
    let rt = example_window(component);
    let (parts, hero) = (component["page"]["parts"].as_array().cloned().unwrap_or_default(), !component["page"]["hero"].is_null());
    let high = |key: &str| rect_of(&rt, key).is_some_and(|rect| rect[3] > 0.0);
    let (mut drew, mut why, mut worst): (Vec<String>, Vec<String>, u8) = (Vec::new(), Vec::new(), 0);
    let mut say = |level: u8, words: String| { if !why.contains(&words) { why.push(words) } worst = worst.max(level); };
    if hero {
        drew.push("header → picture".into());
        if !high("tile/reader/hero") { say(2, "its header image drew nothing".into()) }
    }
    for (i, part) in parts.iter().enumerate() {
        if !high(&format!("tile/reader/part/{i}")) { say(2, format!("part {i} drew nothing")) }
        let mut types = Vec::new();
        crate::parts::walk(part, &mut |prim| {
            let (ty, kind) = (crate::parts::ty(prim), prim["kind"].as_str().unwrap_or(""));
            if ty != "part" { types.push(ty.to_string()); return }
            if let Some(error) = prim["error"].as_str() { say(2, format!("the service says: {error}")) }
            let view = &prim["view"];
            match crate::parts::ty(view) {
                "source" => say(1, format!("a {kind} with no primitive form: its lines as written")),
                "markdown" if kind != "prose" => say(1, format!("a {kind} as the service's Markdown for it")),
                // Blockdown's own forms left in prose are words here: a property, a reference, a component, a value.
                "markdown" if blockdown_left(view["text"].as_str().unwrap_or("")) => say(1, "Blockdown's own forms in its prose (a property, a value, a component) stay as written".into()),
                _ => {}
            }
        });
        types.dedup();
        drew.push(format!("{} → {}", part["kind"].as_str().unwrap_or("part"), types.join(", ")));
    }
    if parts.is_empty() && !hero { return ("empty", "nothing".into(), "the service answers no part for this example (an `::if` draws only while its note matches)".into()) }
    (["draws", "partly", "problem"][worst as usize], drew.join("; "), why.join("; "))
}

/// The service's word on a button is said over it either way. A look word it doesn't read stops no press (the door
/// runs that button too); a slot its line leaves empty is what the part says it needs, and a press runs nothing.
#[test]
fn a_button_with_a_look_it_does_not_read_still_runs_and_one_with_an_empty_slot_runs_nothing() {
    let look = "the button doesn't read tone=sparkly (quiet, primary, danger)";
    let mut rt = example_window(&json!({ "page": { "title": "Shed jobs", "text": "Shed jobs", "chips": [], "hero": null, "parts": [
        part("example", "button", 1, json!({ "name": "button", "error": look }), json!({ "type": "button", "label": "Fold the side away", "act": "dock.toggle side=right" })),
        part("example", "button", 3, json!({ "name": "button", "needs": ["bed"], "error": "no bed yet: write bed= on its line" }), json!({ "type": "button", "label": "Open a bed", "act": "open id={bed}" })),
    ] } }));
    let reader = rt.state.reader().unwrap();
    let said = |app: &crate::actions::App| app.ui(&reader).said.clone().map(|said| (said.words, said.ok));
    press(&mut rt, "tile/reader/part/0/view");
    assert_eq!(said(&rt.state), Some(("Fold the side away ran dock.toggle side=right, as you".to_string(), true)), "a look word is no reason not to run");
    assert!(rt.find("tile/reader/part/0/error").is_some(), "and what the service says of its look is still over it");

    let from = rt.state.steps.len();
    let outcome = act(&mut rt.state, "button.press line=3");
    assert_eq!((outcome.ok, outcome.said.as_str()), (false, "Open a bed can't run as written: no bed yet: write bed= on its line"));
    assert_eq!(said(&rt.state), Some(("Open a bed: no bed yet: write bed= on its line".to_string(), false)));
    assert!(rt.state.steps[from..].iter().all(|step| step.action != "open"), "nothing of its line ran");
}

#[test]
fn every_component_s_own_example_is_drawn_and_the_coverage_table_says_how_each_fared() {
    let pages = fixture("component-pages.json");
    let components = pages["components"].as_array().unwrap();
    assert!(components.len() >= 40, "every built-in component's example is in the fixture: {}", components.len());
    let cell = |words: &str| words.replace('|', "\\|").replace('\n', " ");
    let mut table = String::new();
    let mut counts = std::collections::BTreeMap::<&str, usize>::new();
    let mut panicked = Vec::new();
    for component in components {
        let id = component["id"].as_str().unwrap();
        let (how, drew, why) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fared(component))).unwrap_or_else(|_| { panicked.push(id.to_string()); ("panicked", String::new(), "building it panicked".into()) });
        *counts.entry(how).or_default() += 1;
        table.push_str(&format!("| `{id}` | {} | **{how}** | {} | {} |\n", component["group"].as_str().unwrap_or(""), cell(&drew), cell(&why)));
    }
    let tally = ["draws", "partly", "problem", "empty", "panicked"].iter().map(|how| format!("{} {how}", counts.get(how).copied().unwrap_or(0))).collect::<Vec<_>>().join(", ");
    let registry = prim::PRIMS.iter().map(|entry| format!("| `{}` | {} |\n", entry.ty, cell(entry.describe))).collect::<String>();
    let doc = format!("# How each component fares in the native window\n\n\
<!-- Written by `cargo test` (src/tests/parts.rs, the coverage table); never edited by hand. -->\n\n\
Every built-in component's own example (its schema's, as `outline-core/fixtures/component-pages.json` holds the\n\
page the service answers of it) drawn on a headless window. **draws**: every part is primitives this window builds.\n\
**partly**: something of it is its lines as written, the service's Markdown, or Blockdown left as words. **problem**:\n\
the service says what is wrong, or a part drew nothing. **empty**: the service answers no part for the example.\n\
**panicked**: building it panicked (a test failure).\n\n\
Of {} components: {tally}.\n\n\
| Component | Group | Fared | Its parts, as written → drawn | Why |\n|---|---|---|---|---|\n{table}\n\
## The registry\n\nEach primitive type and how this window draws it (`tiles/prim.rs`, `PRIMS`: the entries' own words).\n\n\
| Type | Drawn as |\n|---|---|\n{registry}", components.len());
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("docs/prim-coverage.md");
    std::fs::write(&path, doc).unwrap();
    assert!(panicked.is_empty(), "building these panicked: {panicked:?}");
}
