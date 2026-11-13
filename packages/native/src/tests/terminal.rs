//! Programs in terminal tiles, over a scripted host (`pty/canned.rs`): a made-up shell that plays a script, so
//! what a key did and what a row shows are the same every run. The terminal's crates themselves are `pty_live.rs`.
//! Every program, note and folder is made up.
use rune::{Key, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App};
use crate::keys::Layer;
use crate::pty::canned::{Canned, Running};
use crate::pty::{self, Cell, Ink, Look, Wide};

/// A potting-shed shell: a prompt, a line that scrolled off, a row with wide characters, and what two commands print.
fn script(backend: &str, keeps: bool) -> Value {
    json!({
        "backend": backend, "keeps": keeps,
        "prompt": [{ "t": "plot", "fg": "#98c379", "bold": true }, " $ "],
        "above": [["sown: 12 rows"], ["watered: north bed"]],
        "screen": [[{ "t": "畑の", "wide": true }, " north bed ", { "t": "ready", "bg": "#3b4252", "fg": "#ebcb8b" }]],
        "replies": { "seeds": [["carrots  3 packets"], ["leeks    1 packet"]] },
        "reports": { "seedbot --plan beds": { "state": "working", "msg": "planning the beds" } },
        "others": [{ "address": "t4", "name": "compost", "runs": "tail -f compost.log", "status": "idle" }],
    })
}

/// The garden with a scripted host under its terminal tiles, and the host's own programs to look at.
fn shed(backend: &str, keeps: bool) -> (Garden, Running) {
    let host = Canned::read(&script(backend, keeps));
    let running = host.running();
    let mut g = garden(ok());
    g.app = g.app.running_on(Box::new(host));
    (g, running)
}

fn line(rt: &mut Runtime<App>, line: &str) -> crate::actions::Outcome {
    let mut out = None;
    let line = line.to_string();
    rt.update(|s, _| out = Some(act(s, &line)));
    rest(rt);
    out.unwrap()
}

fn agent(rt: &mut Runtime<App>, line: &str) -> crate::actions::Outcome {
    let mut out = None;
    let line = line.to_string();
    rt.update(|s, _| { out = Some(s.act(&line, Actor::Agent("compost-agent".into()))); s.settle(); });
    rest(rt);
    out.unwrap()
}

/// What `peek` says of a tile.
fn facts(rt: &Runtime<App>, tile: &str) -> Value {
    crate::control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().find(|t| t["name"] == tile).unwrap_or_else(|| panic!("no tile {tile}"))["facts"].clone()
}

fn lines(rt: &Runtime<App>, tile: &str) -> Vec<String> { facts(rt, tile)["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect() }

/// The programs the window last handed `lists.read from=programs`.
fn handed(asked: &Asked) -> Vec<Value> {
    asked.borrow().iter().rev().find(|a| a["action"] == "lists.read" && a["from"] == "programs").map(|a| a["programs"].as_array().unwrap().clone()).expect("the programs were handed over")
}

// ── the model: a row cut where a wide character sits ────────────────────────────────────────────────────────

#[test]
fn a_row_is_cut_where_a_wide_character_sits_and_its_grounds_are_runs() {
    let plain = |ch: char| Cell { ch, ..Cell::default() };
    let wide = |ch: char| [Cell { ch, wide: Wide::Lead, ..Cell::default() }, Cell { wide: Wide::Tail, ..Cell::default() }];
    let lit = |ch: char| Cell { ch, bg: Ink::Rgb(59, 66, 82), look: Look { fg: Ink::Rgb(235, 203, 139), bold: true, ..Look::default() }, ..Cell::default() };
    let mut row: Vec<Cell> = "ab".chars().map(plain).collect();
    row.extend(wide('畑'));
    row.extend(wide('の'));
    row.extend(" x".chars().map(plain));
    row.extend("ok".chars().map(lit));
    row.extend("    ".chars().map(plain));
    let cut = pty::cut(&row);
    // Each stretch of one-column cells is one piece, each wide character a piece two cells wide: whatever a
    // glyph measures, the piece after it starts on its own column.
    assert_eq!(cut.stretches.iter().map(|s| (s.col, s.cols, s.text.as_str(), s.wide)).collect::<Vec<_>>(), vec![(0, 2, "ab", false), (2, 2, "畑", true), (4, 2, "の", true), (6, 8, " xok    ", false)]);
    // The colours of a stretch are byte ranges of its text; a ground is a rect of its own, a run of cells.
    assert_eq!(cut.stretches[3].looks.iter().map(|(from, till, look)| (*from, *till, look.bold)).collect::<Vec<_>>(), vec![(0, 2, false), (2, 4, true), (4, 8, false)]);
    assert_eq!(cut.grounds.iter().map(|g| (g.col, g.cols, g.ink)).collect::<Vec<_>>(), vec![(8, 2, (59, 66, 82))]);
    // A stretch of nothing but blanks is no piece.
    assert!(pty::cut(&"      ".chars().map(plain).collect::<Vec<_>>()).stretches.is_empty());
}

// ── the drawer, over a scripted stream ──────────────────────────────────────────────────────────────────────

#[test]
fn a_shell_opens_beside_the_note_and_its_rows_stay_on_the_column_grid() {
    let (g, running) = shed("herdr-core", true);
    let mut rt = window(g.app);
    let opened = line(&mut rt, "terminal.open");
    assert!(opened.ok, "{}", opened.said);
    assert_eq!((opened.answer["tile"].as_str(), opened.answer["backend"].as_str(), opened.answer["keeps"].as_bool(), opened.answer["state"].as_str()), (Some("shell"), Some("herdr-core"), Some(true), Some("running")));
    assert_eq!(running.keys(), vec!["garden-1"], "the program is kept under a key of the outline's name");
    // The tile is beside the reader, the person's keys are in its program, and what it shows is the script's.
    let (reader, shell) = (rect_of(&rt, "tile/reader").unwrap(), rect_of(&rt, "tile/shell").unwrap());
    assert!(shell[0] >= reader[0] + reader[2] - 1.0, "the shell is on the reader's right: {reader:?} {shell:?}");
    assert_eq!(rt.state.person().layer, Layer::Program);
    assert_eq!(lines(&rt, "shell"), vec!["sown: 12 rows", "watered: north bed", "畑の north bed ready", "plot $"]);
    // The row with wide characters is cut at them: each piece sits on its column, a cell's width a column.
    let cell = crate::tiles::pty::cell(crate::tiles::pty::style(&rune_kit::Kit::neutral(false))).0;
    let row = rect_of(&rt, "tile/shell/row/2").expect("the row is drawn");
    for (piece, col) in [("tile/shell/row/2/at/0", 0.0), ("tile/shell/row/2/at/2", 2.0), ("tile/shell/row/2/at/4", 4.0), ("tile/shell/row/2/ground/15", 15.0)] {
        let at = rect_of(&rt, piece).unwrap_or_else(|| panic!("{piece} is drawn"));
        assert!((at[0] - row[0] - col * cell).abs() < 0.6, "{piece} starts on column {col}: {at:?} in {row:?}, a cell {cell}");
    }
    // The ground is a rect of its own as wide as its cells, behind the text; the cursor is on the prompt's row.
    assert!((rect_of(&rt, "tile/shell/row/2/ground/15").unwrap()[2] - 5.0 * cell).abs() < 0.6);
    assert_eq!(facts(&rt, "shell")["cursor"], json!([7, 3]));
    assert!(rt.find("tile/shell/row/3/cursor").is_some());
    // The tile says what keeps its program, before anybody relies on it.
    assert_eq!(facts(&rt, "shell")["kept"], "herdr-core · outlives this window");
    assert!(rt.find("tile/shell/kept").is_some() && rt.find("tile/shell/do/tile.leave").is_some());
}

#[test]
fn keys_go_to_the_program_and_its_rows_come_back_until_the_key_that_leaves() {
    let (g, running) = shed("herdr-core", true);
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    typed(&mut rt, "seeds");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(running.heard("garden-1"), vec!["s", "e", "e", "d", "s", "enter"]);
    assert_eq!(lines(&rt, "shell")[3..], ["plot $ seeds", "carrots  3 packets", "leeks    1 packet", "plot $"]);
    // Every key is the program's while the person is in it: the window's own chords too.
    chord(&mut rt, Key::Text("k".into()), primary());
    assert!(!rt.state.bar.open, "the bar's key is the program's while the person types in it");
    let person = rt.state.person();
    assert!(person.takes_keys && person.busy && person.typing_in.as_deref() == Some("shell"));
    assert_eq!(person.json()["takesKeys"], true);
    // The key that leaves gives the keys back to the window: the tile keeps the focus, and the window's chords hold.
    chord(&mut rt, Key::Text("]".into()), Mods { ctrl: true, ..Mods::default() });
    let person = rt.state.person();
    assert_eq!((person.layer, person.takes_keys, person.busy, person.focus.as_str()), (Layer::Tile, false, false, "shell"));
    let before = running.heard("garden-1").len();
    chord(&mut rt, Key::Text("k".into()), primary());
    assert!(rt.state.bar.open, "the window's own key is the window's again");
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!(running.heard("garden-1").len(), before, "nothing typed outside it reached the program");
    // And the same key steps back in.
    chord(&mut rt, Key::Text("]".into()), Mods { ctrl: true, ..Mods::default() });
    assert_eq!(rt.state.person().layer, Layer::Program);
    typed(&mut rt, "x");
    assert_eq!(running.heard("garden-1").last().map(String::as_str), Some("x"));
}

#[test]
fn a_size_the_scrollback_and_a_paste_reach_the_program() {
    let (g, running) = shed("pty", false);
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    // The tile fits its program to itself as it is laid out: its size in cells is the tile's, not the first guess.
    let fitted = (facts(&rt, "shell")["cols"].as_u64().unwrap(), facts(&rt, "shell")["rows"].as_u64().unwrap());
    assert_ne!(fitted, (u64::from(pty::FIRST.0), u64::from(pty::FIRST.1)), "the program was fitted to its tile");
    let cell = crate::tiles::pty::cell(crate::tiles::pty::style(&rune_kit::Kit::neutral(false)));
    let screen = rect_of(&rt, "tile/shell/screen").unwrap();
    assert_eq!(fitted, (((screen[2] - 8.0) / cell.0).floor() as u64, ((screen[3] - 8.0) / cell.1).floor() as u64));
    // A size by name, as an agent or a test would say one, and a row that is cut by it.
    assert!(line(&mut rt, "terminal.fit cols=12 rows=3 tile=shell").ok);
    assert_eq!(lines(&rt, "shell"), vec!["watered: nor", "畑の north b", "plot $"]);
    // The scrollback: up through what scrolled off, and back.
    assert!(line(&mut rt, "terminal.scroll lines=-1 tile=shell").ok);
    assert_eq!(lines(&rt, "shell"), vec!["sown: 12 row", "watered: nor", "畑の north b"]);
    chord(&mut rt, Key::PageDown, Mods { shift: true, ..Mods::default() });
    assert_eq!(lines(&rt, "shell").last().map(String::as_str), Some("plot $"));
    // A paste is the program's as a paste, not as keys.
    assert!(line(&mut rt, "terminal.paste text=\"rows of peas\" tile=shell").ok);
    assert_eq!(running.heard("garden-1").last().map(String::as_str), Some("paste:rows of peas"));
    assert_eq!(lines(&rt, "shell").last().map(String::as_str), Some("plot $ rows"), "what was pasted is on its line, cut at the tile's width");
}

/// What keeps a program is said whole in a narrow tile too: what is said beside it (that the program was found
/// running) gives way, and the words a person relies on are never the ones cut.
#[test]
fn what_keeps_a_program_is_said_whole_in_a_narrow_tile() {
    let (g, _running) = shed("herdr-core", true);
    let mut rt = window(g.app);
    // An agent beside the note, in half the reader's width. Detached and given a tile again, it was found running,
    // and its tile says so beside what keeps it.
    assert!(line(&mut rt, "terminal.open agent=true").ok);
    assert!(line(&mut rt, "terminal.detach tile=agent").ok && line(&mut rt, "terminal.attach key=garden-1").ok);
    assert!(rt.find("tile/agent/found").is_some(), "the tile says its program was found running");
    let said = facts(&rt, "agent")["kept"].as_str().unwrap().to_string();
    let wide = rune::text::measure(&said, &[], rune_kit::Kit::neutral(false).ty.small, None).0;
    let (kept, tile) = (rect_of(&rt, "tile/agent/kept").expect("what keeps it is drawn"), rect_of(&rt, "tile/agent").unwrap());
    assert!(wide < tile[2] - 16.0, "the tile has room for the words: {wide} in {tile:?}");
    assert!(kept[2] + 0.5 >= wide, "\"{said}\" is {wide} wide and was given {}: it is cut short", kept[2]);
}

// ── detach, attach, return ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn an_agent_is_detached_listed_with_no_tile_and_jumped_back_to() {
    let (g, running) = shed("herdr-core", true);
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    let agent_opened = line(&mut rt, "terminal.open agent=true command=\"seedbot --plan beds\"");
    assert!(agent_opened.ok, "{}", agent_opened.said);
    assert_eq!(agent_opened.answer["tile"], "agent");
    // The line its tile starts it with was typed into it, once; what it reports of itself is the host's word.
    assert_eq!(running.heard("garden-2"), vec!["line:seedbot --plan beds"]);
    assert_eq!((facts(&rt, "agent")["status"].as_str(), facts(&rt, "agent")["says"].as_str()), (Some("working"), Some("planning the beds")));
    // The list of programs is what the window hands over: equal to what runs, the keeper's other work marked.
    assert!(line(&mut rt, "tile.leave").ok && line(&mut rt, "bar.open scope=programs").ok);
    let said = handed(&asked);
    assert_eq!(said.iter().map(|p| (p["key"].as_str().unwrap(), p["name"].as_str().unwrap(), p["state"].as_str().unwrap(), p["status"].as_str(), p["tile"].as_str(), p["mine"].as_bool())).collect::<Vec<_>>(), vec![
        ("garden-1", "Shell", "running", None, Some("shell"), None),
        ("garden-2", "Agent", "running", Some("working"), Some("agent"), None),
        ("", "compost", "running", Some("idle"), None, Some(false)),
    ]);
    assert_eq!(said.iter().filter(|p| p["mine"] != false).map(|p| p["key"].as_str().unwrap().to_string()).collect::<Vec<_>>(), running.keys(), "the list is what runs");
    assert!(line(&mut rt, "bar.close").ok);

    // Detached: the tile closes and the program runs on, listed with no tile; nothing was sent to it.
    let detached = line(&mut rt, "terminal.detach tile=agent");
    assert!(detached.ok, "{}", detached.said);
    assert_eq!((detached.answer["program"].as_str(), detached.answer["keeps"].as_bool()), (Some("garden-2"), Some(true)));
    assert!(rt.find("tile/agent").is_none());
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.contains("the next launch finds it") && n.undo.as_deref() == Some("terminal.attach key=garden-2")), "{:?}", rt.state.notice);
    assert!(rt.find("notice-undo").is_some(), "the notice has the button that gives it a tile again");
    assert!(line(&mut rt, "bar.open scope=programs").ok);
    assert_eq!(handed(&asked).iter().map(|p| (p["key"].as_str().unwrap().to_string(), p["tile"].as_str().map(str::to_string))).collect::<Vec<_>>()[..2], [("garden-1".to_string(), Some("shell".to_string())), ("garden-2".to_string(), None)]);
    // The row of the list is the jump, written by the service: picked, the program has a tile again and the keys.
    let row = crate::bar::rows(&rt.state).into_iter().find(|row| row.key == "garden-2").expect("the detached agent is a row of the bar");
    assert_eq!((row.source.as_str(), row.line.as_str()), ("programs", "terminal.jump key=\"garden-2\""));
    press(&mut rt, "bar/row/programs/garden-2");
    assert_eq!(rt.state.person().typing_in.as_deref(), Some("agent"), "the keys are in the agent");
    assert_eq!(facts(&rt, "agent")["program"], "garden-2");
    assert_eq!(running.heard("garden-2"), vec!["line:seedbot --plan beds"], "it is the same program: nothing was typed into it again");
    // A jump to one in a tile already is the keys going there.
    assert!(line(&mut rt, "terminal.jump key=garden-1").ok);
    assert_eq!(rt.state.person().typing_in.as_deref(), Some("shell"));
    // What the keeper runs that this window did not start is no program of its own: nothing jumps to it or ends it.
    for no in ["terminal.jump key=t4", "terminal.attach key=compost"] { assert!(!line(&mut rt, no).ok, "{no}") }
}

#[test]
fn the_next_launch_finds_what_herdr_core_kept_and_a_plain_pty_starts_over() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-term-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for (backend, keeps) in [("herdr-core", true), ("pty", false)] {
        let kept = dir.join(format!("native-garden-{backend}.layout.json"));
        let host = Canned::read(&script(backend, keeps));
        let running = host.running();
        let mut g = garden_kept(ok(), &kept);
        g.app = g.app.running_on(Box::new(host));
        let mut rt = window(g.app);
        assert!(line(&mut rt, "terminal.open agent=true command=\"seedbot --plan beds\"").ok);
        typed(&mut rt, "seeds");
        assert_eq!(facts(&rt, "agent")["kept"], if keeps { "herdr-core · outlives this window" } else { "pty · ends with this window" }, "the tile says how long its program runs before anybody relies on it");
        let heard = running.heard("garden-1");
        drop(rt);
        // The window is gone. The next one, over what the host still runs, opens as it was left.
        let mut again = garden_kept(ok(), &kept);
        again.app = again.app.running_on(Box::new(Canned::over(&script(backend, keeps), running.clone())));
        let mut rt = window(again.app);
        rest(&mut rt);
        assert_eq!(facts(&rt, "agent")["program"], "garden-1", "its tile names the same program");
        if keeps {
            assert_eq!(facts(&rt, "agent")["attached"], true);
            assert_eq!(running.heard("garden-1"), heard, "the program herdr-core kept is attached to: its line is not typed into it a second time");
            assert_eq!(lines(&rt, "agent").last().map(String::as_str), Some("plot $ seeds"), "and what was half typed is still on its line");
            assert!(rt.find("tile/agent/found").is_some(), "the tile says it was found running");
        } else {
            assert_eq!(facts(&rt, "agent")["attached"], false);
            assert_eq!(lines(&rt, "agent").last().map(String::as_str), Some("plot $"), "a plain pty's program ended with its window: this is a new one");
        }
        let _ = std::fs::remove_file(&kept);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_close_ends_the_program_and_a_plain_pty_detached_runs_until_the_window_ends() {
    let (g, running) = shed("herdr-core", true);
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok && line(&mut rt, "tile.leave").ok);
    // The person's close asks nothing and ends it, where its keeper would have kept it too.
    assert!(line(&mut rt, "tile.close tile=shell").ok);
    assert!(rt.find("tile/shell").is_none());
    assert!(line(&mut rt, "bar.open scope=programs").ok);
    assert_eq!(handed(&asked).iter().filter(|p| p["mine"] != false).count(), 0, "nothing of this window's runs any more");
    assert_eq!(handed(&asked).iter().map(|p| p["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["compost"], "and what it never started is left alone");
    assert!(running.keys().contains(&"garden-1".to_string()));

    let (g, running) = shed("pty", false);
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    typed(&mut rt, "seeds");
    let detached = line(&mut rt, "terminal.detach");
    assert!(detached.ok && detached.answer["keeps"] == false);
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.said.contains("until this window ends")), "{:?}", rt.state.notice);
    // Attached again in this window, it is the same program with its line as typed.
    assert!(line(&mut rt, "terminal.attach key=garden-1").ok);
    assert_eq!(lines(&rt, "shell").last().map(String::as_str), Some("plot $ seeds"));
    assert_eq!(running.heard("garden-1"), vec!["s", "e", "e", "d", "s"]);
}

#[test]
fn a_tile_torn_into_a_window_of_its_own_keeps_its_program() {
    let (g, running) = shed("pty", false);
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    typed(&mut rt, "seeds");
    assert!(line(&mut rt, "tile.tear tile=shell").ok);
    let mut born = None;
    rt.update(|s, _| born = s.born().pop());
    let mut torn = window(born.expect("a window was made for the tile"));
    rest(&mut torn);
    assert_eq!(facts(&torn, "shell")["program"], "garden-1");
    assert_eq!(lines(&torn, "shell").last().map(String::as_str), Some("plot $ seeds"), "the program went with its tile: it was not ended and not started again");
    typed(&mut torn, "!");
    assert_eq!(running.heard("garden-1"), vec!["s", "e", "e", "d", "s", "!"]);
}

// ── an agent, while the person types ────────────────────────────────────────────────────────────────────────

#[test]
fn an_agent_s_act_never_takes_the_keys_of_a_terminal_the_person_types_in() {
    let (g, running) = shed("herdr-core", true);
    let mut rt = window(g.app);
    assert!(line(&mut rt, "terminal.open").ok);
    typed(&mut rt, "se");
    // The person is in the shell's program: an agent's text for that tile is held back, with why and what it does instead.
    let held = agent(&mut rt, "tile.type tile=shell text=\"eds\\n\"");
    assert!(!held.ok && held.said.contains("the person is typing in shell") && held.said.contains("comment body="), "{}", held.said);
    assert_eq!(running.heard("garden-1"), vec!["s", "e"]);
    // Nor does it step them out, step in for them, paste for them or end what they type in.
    for theirs in ["tile.leave", "tile.enter tile=shell", "terminal.paste text=peas tile=shell", "terminal.jump key=garden-1"] { assert!(!agent(&mut rt, theirs).ok, "{theirs} is the person's") }
    let ended = agent(&mut rt, "tile.close tile=shell");
    assert!(!ended.ok && ended.said.contains("the person is typing in shell"), "{}", ended.said);
    // An agent's own terminal opens beside the note without their keys, attributed, and it types into that one.
    let opened = agent(&mut rt, "terminal.open name=helper command=\"seedbot --plan beds\"");
    assert!(opened.ok, "{}", opened.said);
    assert_eq!(rt.state.person().typing_in.as_deref(), Some("shell"), "the person's keys stayed where they were");
    assert!(rt.state.agent_said.as_deref().is_some_and(|said| said.contains("compost-agent") && said.contains("terminal.open")), "{:?}", rt.state.agent_said);
    assert!(agent(&mut rt, "tile.type tile=helper text=\"seeds\\n\"").ok);
    assert_eq!(running.heard("garden-2"), vec!["line:seedbot --plan beds", "send:seeds\n"]);
    assert_eq!(running.heard("garden-1"), vec!["s", "e"], "and nothing of the agent's reached the person's shell");
    // Once the person has stepped out, the shell takes an agent's text. Its program is still not an agent's to end
    // (the layout's rule for a tile whose program runs, the door's by contract); detaching it ends nothing.
    assert!(line(&mut rt, "tile.leave").ok && line(&mut rt, "tile.focus tile=reader").ok);
    let ended = agent(&mut rt, "tile.close tile=shell");
    assert!(!ended.ok && ended.said.contains("shell is running") && ended.said.contains("an agent doesn't end it"), "{}", ended.said);
    assert!(agent(&mut rt, "tile.type tile=shell text=eds").ok);
    assert_eq!(running.heard("garden-1"), vec!["s", "e", "send:eds"]);
    let detached = agent(&mut rt, "terminal.detach tile=shell");
    assert!(detached.ok, "{}", detached.said);
    assert!(rt.find("tile/shell").is_none() && running.heard("garden-1").len() == 3);
}

/// The same over the control socket, as the door's own client sends it: an agent's terminal is opened and typed
/// into by act lines, recorded as the agent's, and `peek` says whose the keys are and what each terminal shows.
#[test]
fn an_agent_runs_a_program_over_the_control_socket_and_peek_says_whose_the_keys_are() {
    let (g, running) = shed("herdr-core", true);
    let mut d = super::control::door_over(g.app, g.asked.clone(), "terminal");
    d.rt.update(|s, _| { s.act("terminal.open", Actor::Person); });
    rest(&mut d.rt);
    let peek = d.ask(json!({ "cmd": "peek" }))["result"].clone();
    assert_eq!(peek["screen"]["whereabouts"]["takesKeys"], true, "the person is in the shell's program: {}", peek["screen"]["whereabouts"]);
    assert_eq!((peek["screen"]["whereabouts"]["layer"].as_str(), peek["screen"]["whereabouts"]["typingIn"].as_str()), (Some("program"), Some("shell")));
    // `ep0ch act --door native tile.type tile=shell text=… --as compost-agent`: held back, with why.
    let held = d.ask(json!({ "cmd": "act", "action": "tile.type", "args": { "text": "seeds\\n" }, "tile": "shell", "as": "compost-agent" }));
    assert!(held["ok"] == false && held["error"].as_str().is_some_and(|why| why.contains("the person is typing in shell")), "{held}");
    // Its own terminal, by the same lines: beside the note, without the person's keys, and typed into.
    let opened = d.ask(json!({ "cmd": "act", "action": "terminal.open", "args": { "name": "helper" }, "as": "compost-agent" }));
    assert_eq!((opened["ok"].as_bool(), opened["result"]["tile"].as_str(), opened["result"]["backend"].as_str()), (Some(true), Some("helper"), Some("herdr-core")), "{opened}");
    let typed = d.ask(json!({ "cmd": "act", "action": "tile.type", "args": { "text": "seeds\\n" }, "tile": "helper", "as": "compost-agent" }));
    assert_eq!(typed["ok"], true, "{typed}");
    assert_eq!(running.heard("garden-2"), vec!["send:seeds\n"]);
    let step = d.rt.state.steps.iter().rev().find(|step| step.action == "tile.type" && step.ok).cloned().expect("the act is recorded");
    assert_eq!(step.by, Actor::Agent("compost-agent".into()));
    let peek = d.ask(json!({ "cmd": "peek" }))["result"].clone();
    let helper = peek["screen"]["tiles"].as_array().unwrap().iter().find(|tile| tile["name"] == "helper").expect("peek lists the agent's terminal").clone();
    assert_eq!((helper["facts"]["typing"].as_bool(), helper["facts"]["kept"].as_str()), (Some(false), Some("herdr-core · outlives this window")));
    assert!(helper["facts"]["lines"].as_array().unwrap().iter().any(|line| line == "carrots  3 packets"), "peek gives a terminal's lines: {}", helper["facts"]["lines"]);
    assert_eq!(peek["screen"]["whereabouts"]["typingIn"], "shell", "the person's keys are where they were");
}

// ── a window built without its terminal ─────────────────────────────────────────────────────────────────────

#[test]
fn a_window_with_no_terminal_says_so_on_the_tile_in_the_kind_s_own_words() {
    // No host was named: the registry's own, which opens nothing (what a build without the `pty` feature has).
    let mut rt = window(garden(ok()).app);
    let opened = line(&mut rt, "terminal.open");
    assert!(opened.ok, "{}", opened.said);
    assert_eq!(opened.answer["state"], pty::UNBUILT);
    let said: Vec<String> = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("tile/shell/"))).filter_map(|e| e.text.clone()).collect();
    assert!(said.iter().any(|text| text == pty::UNBUILT), "the tile says no terminal is built in: {said:?}");
    // How one is built in is the kind's own row to say (the extension's), and it is drawn under that.
    let about = rt.state.kind_row("terminal.shell").expect("the service serves the kind").about.clone();
    assert!(about.contains("cargo build --features pty") && said.iter().any(|text| *text == about), "the row's own words are on the tile: {said:?}");
    assert_eq!(rt.state.person().layer, Layer::Tile, "nothing runs, so no key is a program's");
}

// ── what a frame costs ──────────────────────────────────────────────────────────────────────────────────────

/// What a terminal tile's frame costs in the window itself, beside the probe's measurement (PROBES §7): a full
/// screen that scrolls (every row changes) and a prompt typed at (one row changes), for a small grid and a large
/// one. `cargo test --release measure_a_terminal_s_frame -- --ignored --nocapture` prints the table.
#[test]
#[ignore = "a measurement: cargo test --release measure_a_terminal_s_frame -- --ignored --nocapture"]
fn measure_a_terminal_s_frame() {
    let median = |mut times: Vec<f64>| { times.sort_by(f64::total_cmp); times[times.len() / 2] };
    for (cols, rows) in [(80u16, 24u16), (200, 60)] {
        // A log whose every line is coloured runs and a wide character: one command prints a screen and a half of it.
        let log: Vec<Value> = (0..usize::from(rows) * 3 / 2).map(|n| json!([{ "t": format!("{n:04} "), "fg": "#7f848e" }, { "t": "畑", "wide": true }, format!(" bed {:02} ", n % 16), { "t": " watered ", "bg": "#2f5d3a", "fg": "#d7f5dd" }, " ".to_string() + &"row of carrots and leeks ".repeat(usize::from(cols) / 30)])).collect();
        let host = Canned::read(&json!({ "backend": "pty", "keeps": false, "replies": { "log": log } }));
        let mut g = garden(ok());
        g.app = g.app.running_on(Box::new(host));
        let mut rt = window(g.app);
        assert!(line(&mut rt, "terminal.open").ok && line(&mut rt, &format!("terminal.fit cols={cols} rows={rows} tile=shell")).ok);
        let mut frame = |rt: &mut Runtime<App>, text: &'static str| {
            rt.update(|s, _| { s.act(&format!("tile.type text={text} tile=shell"), Actor::Person); s.ran(); });
            let at = std::time::Instant::now();
            rt.frame(1.0 / 60.0);
            at.elapsed().as_secs_f64() * 1000.0
        };
        for _ in 0..3 { frame(&mut rt, "\"log\\n\""); }
        let scroll = median((0..40).map(|_| frame(&mut rt, "\"log\\n\"")).collect());
        let prompt = median((0..40).map(|_| frame(&mut rt, "x")).collect());
        // The frame with nothing new: what the window's other tiles and the terminal's mounted rows cost at rest.
        let rest = median((0..40).map(|_| { let at = std::time::Instant::now(); rt.frame(1.0 / 60.0); at.elapsed().as_secs_f64() * 1000.0 }).collect());
        let built = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("tile/shell/row/"))).count();
        eprintln!("| {cols} by {rows} | {scroll:.2} | {prompt:.2} | {rest:.2} | {built} | {} |", rt.elements().len());
    }
}
