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
    let said = crate::tiles::described(&garden(ok()).app);
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
    assert_eq!(steps, ["note.new tile=reader", "button.press line=13 note=plot tile=reader"], "the press is button.press, by the line it is written on as the door counts lines (from 1), and its act line ran through the dispatcher as its own step");
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

/// A press comes from its tile; it doesn't name it. A note's button whose act is about another sort of tile (a
/// tree's fold, a list's sort) runs where the same line typed in the bar would (the one rule, `App::target`), never
/// refused for the reader it was pressed in. A line that names a tile itself is still held to it, and an act about
/// a note runs in the reader the button is in, whichever tile has the keys.
#[test]
fn a_button_s_act_about_another_sort_of_tile_runs_where_the_one_rule_says_not_refused_for_the_reader_it_is_in() {
    let button = |line: u64, label: &str, act: &str| part("example", "button", line, json!({ "name": "button" }), json!({ "type": "button", "label": label, "act": act }));
    let mut rt = example_window(&json!({ "page": { "title": "Rota", "text": "Rota", "chips": [], "hero": null, "parts": [
        button(1, "Unfold the plot", "tree.fold id=example open=true"),
        button(2, "Sort the outline", "list.sort by=title"),
        button(3, "Sort the reader", "list.sort by=title tile=reader"),
        button(4, "Write it", "edit"),
    ] } }));
    let tree = rt.state.layout.named("tree").expect("the desk has a tree");
    let pressed = |rt: &mut rune::Runtime<crate::actions::App>, label: &str| { let line = format!("button.press label=\"{label}\""); let mut out = None; rt.update(|s, _| out = Some(s.act(&line, crate::actions::Actor::Person))); rest(rt); out.unwrap() };
    let folded = pressed(&mut rt, "Unfold the plot");
    assert!(folded.ok && rt.state.ui(&tree).unfolded.contains("example"), "a fold pressed in a note unfolds the tree: {}", folded.said);
    let sorted = pressed(&mut rt, "Sort the outline");
    assert!(sorted.ok && rt.state.ui(&tree).chosen.get("sort").map(String::as_str) == Some("title"), "a sort pressed in a note sorts the list the one rule finds: {}", sorted.said);
    // The step is the act as it ran: it named no tile, and none was written into it.
    let step = rt.state.steps.iter().rev().find(|step| step.action == "list.sort").unwrap();
    assert_eq!(step.line(), "list.sort by=title");
    // A tile the line names itself is the one it runs in, or it is refused: never swapped.
    let wrong = pressed(&mut rt, "Sort the reader");
    assert!(!wrong.ok && wrong.said.contains("reader is no list"), "{}", wrong.said);
    // An act about a note runs in the reader the button is in, though the tree has the keys.
    rt.update(|s, _| { s.act("tile.focus tile=tree", crate::actions::Actor::Person); });
    let edited = pressed(&mut rt, "Write it");
    assert!(edited.ok, "{}", edited.said);
    assert_eq!(draft(&rt.state).map(|d| rt.state.layout.name(&d.tile)).as_deref(), Some("reader"));
    assert_eq!(rt.state.steps.iter().rev().find(|step| step.action == "edit").unwrap().line(), "edit tile=reader");
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
    let invitation = run["invitation"].as_str().expect("the person's press invites the run it starts").to_string();
    let reader = rt.state.reader().unwrap();
    assert_eq!(rt.state.ui(&reader).said.as_ref().unwrap().words, "Tidy the shed: running…", "the service took it and is running it");
    assert!(rt.find("tile/reader/part/5/said").is_some(), "said under the button that was pressed");

    // The run's script acts in this window: the call is aimed at this client, run by the dispatcher, and answered.
    let call = |request: &str, target: &str, action: &str, args: Value| json!({ "event": { "domain": "script", "action": "scripts.act", "script": {
        "requestId": request, "targetClientId": target, "action": action, "args": args, "actor": { "author": "agent", "actorId": "script:tidy", "sessionId": "run-1" }, "requestedBy": { "author": "user" }, "invitation": invitation } } });
    let answers = |asked: &Asked| -> Vec<Value> { asked.borrow().iter().filter(|a| a["action"] == "scripts.answer").cloned().collect() };
    rt.update({ let (said, line) = (said.clone(), call("r1", &client, "open", json!({ "id": "shed" }))); move |s, _| host_says(s, &said, line.clone()) });
    assert_eq!(rt.state.subject().as_deref(), Some("shed"), "the script's open ran here");
    let step = rt.state.steps.last().unwrap();
    // (It comes from the tile its press was made in, as a step of the press: an open from the reader.)
    assert_eq!((step.line().as_str(), &step.by, step.ok), ("open id=shed tile=reader", &Actor::Agent("script:tidy".into()), true), "a run the person's press started acts as its script, on that press's invitation");
    assert_eq!(rt.state.agent_said.as_deref(), Some("script:tidy · open"), "and the status line names the script");
    let answered = answers(&asked);
    assert_eq!((answered.len(), answered[0]["requestId"].as_str(), answered[0]["clientId"].as_str(), answered[0].get("error")), (1, Some("r1"), Some(client.as_str()), None));

    // An action this window hasn't, or a call nobody pressed for, is answered in the dispatcher's own words; a call for another window is not ours.
    rt.update({ let (said, line) = (said.clone(), call("r2", &client, "desk.dance", json!({}))); move |s, _| host_says(s, &said, line.clone()) });
    assert!(answers(&asked)[1]["error"].as_str().unwrap().starts_with("no action named desk.dance"), "{}", answers(&asked)[1]);
    rt.update({ let (said, line) = (said.clone(), call("r3", "door-7", "open", json!({ "id": "plot" }))); move |s, _| host_says(s, &said, line.clone()) });
    assert_eq!((answers(&asked).len(), rt.state.subject().as_deref()), (2, Some("shed")), "a call aimed at another client is left to it");
    // (A run nobody here pressed for carries no invitation of this window's.)
    let mut unasked = call("r4", &client, "edit", json!({}));
    unasked["event"]["script"].as_object_mut().unwrap().remove("invitation");
    rt.update({ let said = said.clone(); move |s, _| host_says(s, &said, unasked.clone()) });
    assert!(answers(&asked)[2]["error"].is_string() && draft(&rt.state).is_none(), "a script nobody pressed stands as no one but itself: the person's editor is not its to open");

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
        ("button.press", "2 buttons here: name one by line= (13, 14)"),
        ("button.press line=4", "no button on line 4 in this note · peek lists its parts"),
        ("button.press line=0", "line= counts from 1, as the door's button.press does: the note's first line is line=1"),
        ("button.press label=Prune", "no button labelled Prune in this note · peek lists its parts"),
        ("button.press line=13 note=shed", "reader shows another note (plot), not shed: open it there first"),
    ] {
        let outcome = act(&mut app, line);
        assert_eq!((outcome.ok, outcome.said.as_str()), (false, why), "{line}");
    }
    // A press names a line as the door's `button.press` does, from 1: the same act line means the same button in both.
    let door: Value = fixture("action-rows.json");
    let theirs = door["rows"].as_array().unwrap().iter().find(|row| row["id"] == "button.press").expect("the door has button.press");
    assert!(theirs["args"]["line"]["about"].as_str().unwrap().contains("from 1"), "the door counts a button's line from 1: {}", theirs["args"]["line"]["about"]);
    let Garden { mut app, asked, .. } = garden(ok());
    assert!(act(&mut app, "button.press line=14").ok, "line 14 is the fourteenth line: the part the service says starts on line 13, from 0");
    let run = asked.borrow().iter().rev().find(|a| a["action"] == "scripts.sequence").cloned().expect("the service is asked to run it");
    assert_eq!(run["line"].as_u64(), Some(13), "and the service is told the line as the wire counts it");
    // peek lists a note's parts, each with the line a press names it by: what an agent names a button by.
    let reader = app.reader().unwrap();
    let facts = (crate::tiles::page::DRAWER.facts)(&app.cx(&reader).unwrap());
    assert_eq!(facts["parts"][4], json!({ "kind": "button", "line": 13, "name": "button", "title": null, "error": null, "draws": "button", "label": "Sow the peas" }));
}

/// peek lists every part a press can name, a box's too: an agent finds a button inside a box by its line.
#[test]
fn peek_lists_the_parts_written_inside_a_box_with_the_line_a_press_names_each_by() {
    let rt = example_window(&json!({ "page": { "title": "Shed jobs", "text": "Shed jobs", "chips": [], "hero": null, "parts": [
        part("example", "box", 1, json!({ "name": "box" }), json!({ "type": "box", "children": [
            part("example", "prose", 2, json!({}), json!({ "type": "markdown", "text": "Before the frost:" })),
            part("example", "button", 3, json!({ "name": "button" }), json!({ "type": "button", "label": "Mend the net", "act": "dock.toggle side=right" })),
        ] })),
    ] } }));
    let reader = rt.state.reader().unwrap();
    let facts = (crate::tiles::page::DRAWER.facts)(&rt.state.cx(&reader).unwrap());
    let listed: Vec<(&str, u64, &str)> = facts["parts"].as_array().unwrap().iter().map(|part| (part["kind"].as_str().unwrap(), part["line"].as_u64().unwrap(), part["label"].as_str().unwrap_or(""))).collect();
    assert_eq!(listed, [("box", 2, ""), ("prose", 3, ""), ("button", 4, "Mend the net")], "the box, then what is written inside it");
}

/// One list, drawn once: a `list` on a page (a view, a note's links) is drawn by the list drawer, as a list tile
/// draws the same rows. Groups that list their rows by id hold them, a row that names no group sits beside the
/// declared groups, a long list builds only the rows in view, and a pick runs the act line the service wrote,
/// whatever it holds.
#[test]
fn a_list_on_a_page_is_the_list_a_tile_draws_and_a_pick_runs_the_row_s_own_act_line() {
    let row = |id: &str, more: Value| { let mut row = json!({ "id": id, "label": format!("Bed {id}"), "do": { "open": id }, "act": format!("open id=\"{id}\"") }); for (k, v) in more.as_object().unwrap() { row[k] = v.clone() } row };
    let mut rt = example_window(&json!({ "page": { "title": "Beds", "text": "Beds", "chips": [], "hero": null, "parts": [
        // Groups that list their rows by id (a view grouped by a property): a row may be in two.
        part("example", "view", 1, json!({ "name": "view", "title": "By season" }), json!({ "type": "list", "rows": [row("peas", json!({})), row("leeks", json!({})), row("garlic", json!({}))],
            "groups": [{ "name": "spring", "label": "Spring", "count": 2, "ids": ["leeks", "peas"] }, { "name": "autumn", "label": "Autumn", "count": 1, "ids": ["garlic"] }] })),
        // A row that names no group, beside declared groups; a group only a row names; a row that runs an action.
        part("example", "links", 4, json!({ "name": "links" }), json!({ "type": "list", "rows": [
            row("shed", json!({})), row("beans", json!({ "group": "sown" })), row("thyme", json!({ "group": "herbs" })),
            { "id": "ask", "label": "Beds by path", "group": "sown", "do": { "run": { "action": "bar.open", "args": { "scope": "query", "query": "path=beds\\north" } } }, "act": "bar.open scope=\"query\" query=\"path=beds\\\\north\"" },
            { "id": "copy", "label": "Copy the seed order", "group": "sown", "do": { "copy": "12 packets" } },
        ], "groups": [{ "name": "sown", "label": "Sown", "count": 3 }, { "name": "planned", "label": "Planned", "count": 0, "note": "Nothing planned yet." }] })),
        // A long list: only the rows in view are built.
        part("example", "view", 9, json!({ "name": "view", "title": "Every packet" }), json!({ "type": "list", "rows": (0..800).map(|i| row(&format!("seed{i}"), json!({}))).collect::<Vec<_>>() })),
    ] } }));
    let has = |rt: &rune::Runtime<crate::actions::App>, key: &str| rt.find(key).is_some();
    for key in ["tile/reader/part/0/group/spring", "tile/reader/part/0/leeks", "tile/reader/part/0/peas", "tile/reader/part/0/group/autumn", "tile/reader/part/0/garlic"] { assert!(has(&rt, key), "{key}: groups that list their rows by id hold them on a page") }
    for key in ["tile/reader/part/1/shed", "tile/reader/part/1/group/sown", "tile/reader/part/1/beans", "tile/reader/part/1/group/planned", "tile/reader/part/1/group/herbs", "tile/reader/part/1/thyme", "tile/reader/part/1/copy"] { assert!(has(&rt, key), "{key}: every row and every header a list tile draws is on the page") }
    let built = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("tile/reader/part/2/seed"))).count();
    assert!(built > 0 && built < 200, "a long list on a page builds the rows in view, not all 800: {built}");
    // A pick runs the row's own act line, from the page's tile: a backslash in its argument is the one the service wrote.
    press(&mut rt, "tile/reader/part/1/ask");
    assert_eq!((rt.state.bar.open, rt.state.bar.edit.words()), (true, "path=beds\\north"));
    let step = rt.state.steps.last().unwrap();
    assert_eq!((step.action.as_str(), step.tile.as_deref(), step.args["query"].as_str()), ("bar.open", Some("reader"), Some("path=beds\\north")));
    // A row that only copies has no act line: it is words here, as it is in a list tile, and a press runs nothing.
    let before = rt.state.steps.len();
    rt.update(|s, _| { s.act("bar.close", crate::actions::Actor::Person); });
    rest(&mut rt);
    press(&mut rt, "tile/reader/part/1/copy");
    let ran: Vec<&str> = rt.state.steps[before..].iter().map(|step| step.action.as_str()).filter(|action| *action != "tile.focus").collect();
    assert_eq!(ran, ["bar.close"], "the press ran no act of the row's (the tile it is in may take the keys)");
}

// ── the coverage table ──────────────────────────────────────────────────────────────────────────────────────

/// A window on one note: the page the service answered of a component's own example.
fn example_window(component: &Value) -> rune::Runtime<crate::actions::App> {
    let (asked, said): (Asked, Said) = Default::default();
    let page = component["page"].clone();
    let answers: Answers = Box::new(move |ask| match ask["action"].as_str().unwrap_or("") {
        "ping" => Ok(json!({ "status": "ready", "protocolVersion": crate::client::PROTOCOL, "location": { "machine": "box" }, "outline": { "name": "garden" } })),
        // The outline is the one note, as its tree lists it; the lists about it are empty.
        "lists.read" => Ok(match ask["from"].as_str().unwrap_or("") {
            "sources" => json!({ "from": "sources", "list": { "type": "list", "rows": [] }, "sources": served()["sources"], "anyChange": true }),
            "children" => json!({ "from": "children", "list": { "type": "list", "arrange": "tree", "rows": [{ "id": "example", "label": page["title"], "act": "open id=\"example\"" }] }, "open": [], "anyChange": true }),
            from => json!({ "from": from, "list": { "type": "list", "rows": [] }, "anyChange": true }),
        }),
        "notes.page" => Ok(json!({ "blockId": "example", "revision": 1, "title": page["title"], "text": page["text"], "chips": page["chips"], "properties": [], "parts": page["parts"], "hero": page["hero"],
            "ancestors": [], "children": [], "backlinks": [], "updated": "2031-04-01T09:00:00.000Z", "author": "user" })),
        "media.read" => Ok(json!({ "path": ask["path"], "mime": "image/svg+xml", "from": "file", "base64": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, SUN) })),
        // The screens and kinds every door ships, as the service answers them (outline-core's fixture): the window opens on the desk.
        "screens.list" => Ok(json!({ "screens": served()["screens"], "kinds": served()["kinds"], "problems": [], "anyChange": true })),
        "events.subscribe" => Ok(json!({ "subscribed": true })),
        action => Err(("failed", format!("no action {action}"))),
    });
    // As a headless render runs: each ask waits for its answer and a picture is decoded before the frame that shows it.
    let mut app = crate::actions::App::new(Box::new(Standin { answers, asked, said }), "garden").blocking(true);
    app.start();
    app.settle();
    // The one note is opened, as a pick of its row in the tree opens it.
    assert!(act(&mut app, "open id=example").ok);
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
    let outcome = act(&mut rt.state, "button.press line=4");
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
