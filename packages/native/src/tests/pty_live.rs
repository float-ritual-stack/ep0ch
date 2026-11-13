//! The terminal's crates themselves (the `pty` feature): Moonframe's emulator and backends under the window.
//!
//! - **A real pseudo-terminal**, in this process: the login shell on a plain pty runs a made-up script (it prints
//!   lines, one with colour and a wide character, reads a key and exits). Keys go in through the window and rows
//!   come out of the emulator.
//! - **herdr-core, by a stand-in.** `hc` itself is not run here: a scripted core in a scratch folder speaks its
//!   protocol as herdr-gpui's client speaks it (`sheprd-core-client`: `hello` as a line, then frames, JSON-RPC on
//!   channel 0, a stream channel an attachment), and keeps made-up terminals. The window is a second process each
//!   launch (this test binary again, with `HC_SOCKET` naming the stand-in), because Moonframe's backend reads
//!   where the core listens from the process's environment: so "detaches, returns" is two launches, as it is for
//!   a person. What the stand-in was asked is what is asserted: a terminal started to outlive its starter at its
//!   tile's size, attached to and never started twice, only this window's ended.
//! - **tmux** comes with the mux as its second choice and is not run here.
//!
//! Nothing here reaches a core, a tmux server or a terminal the test did not start: the pty test names the plain
//! pty outright, and the stand-in is the only core its windows can find.
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rune::{Key, Mods, Runtime};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::App;
use crate::pty::{self, Ink, Wide};

fn line(rt: &mut Runtime<App>, line: &str) -> crate::actions::Outcome {
    let mut out = None;
    let line = line.to_string();
    rt.update(|s, _| out = Some(act(s, &line)));
    rest(rt);
    out.unwrap()
}

fn facts(rt: &Runtime<App>, tile: &str) -> Value {
    crate::control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().find(|t| t["name"] == tile).unwrap_or_else(|| panic!("no tile {tile}"))["facts"].clone()
}

/// A terminal shows `text` somewhere on its screen, wherever its tile's width wrapped the line.
fn shows(rt: &Runtime<App>, tile: &str, text: &str) -> bool { lines(rt, tile).concat().contains(text) }

fn lines(rt: &Runtime<App>, tile: &str) -> Vec<String> { facts(rt, tile)["lines"].as_array().into_iter().flatten().map(|l| l.as_str().unwrap_or("").to_string()).collect() }

/// Frames, with real time between them, until `so` holds: a program answers on threads of its own.
fn until(rt: &mut Runtime<App>, what: &str, so: impl Fn(&Runtime<App>) -> bool) {
    let till = Instant::now() + Duration::from_secs(30);
    loop {
        rt.frame(1.0 / 60.0);
        if so(rt) { return }
        assert!(Instant::now() < till, "waited 30 s for {what}: the terminals say {}", json!(crate::control::peek(&rt.state)["screen"]["tiles"].as_array().unwrap().iter().filter(|t| t["facts"].get("program").is_some()).map(|t| json!({ "tile": t["name"], "facts": t["facts"] })).collect::<Vec<_>>()));
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-pty-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// ── a real pty ──────────────────────────────────────────────────────────────────────────────────────────────

/// The login shell on a plain pty, in a tile: a made-up script's lines come out as rows on the column grid, a key
/// typed in the window reaches the script's `read`, a size reaches the program, and the shell's exit is said.
#[test]
fn a_real_pty_runs_a_made_up_script_keys_in_and_rows_out() {
    let dir = scratch("beds");
    let script = dir.join("beds.sh");
    std::fs::write(&script, "printf 'bed 1: carrots\\n'\nprintf 'bed 2: \\033[32mleeks\\033[0m 畑\\n'\nprintf 'water which bed? '\nread bed\nprintf 'watering bed %s\\n' \"$bed\"\n").unwrap();
    let mut g = garden(ok());
    let wake = g.app.store().waker();
    // The plain pty by name, under a namespace of the test's own: no core and no tmux server is looked for.
    g.app = g.app.running_on(Box::new(pty::moonframe::Mux::of(&format!("ep0ch-test-{}", std::process::id()), moonframe_mux::Preference::Pty, wake)));
    let mut rt = window(g.app);
    let opened = line(&mut rt, &format!("terminal.open command=\"sh {}\" cwd=\"{}\"", script.display(), dir.display()));
    assert!(opened.ok, "{}", opened.said);
    assert_eq!((opened.answer["backend"].as_str(), opened.answer["keeps"].as_bool()), (Some("pty"), Some(false)));
    assert_eq!(facts(&rt, "shell")["kept"], "pty · ends with this window", "the tile says a plain pty's program ends with the window");
    // The line its tile starts it with is typed into the shell once it reads one, and the script's lines are rows.
    until(&mut rt, "the script to ask its question", |rt| lines(rt, "shell").iter().any(|l| l.starts_with("water which bed?")));
    let shown = rt.state.program_of(&rt.state.layout.focus).expect("the tile has its program");
    let at = |text: &str| (0..shown.grid.rows).find(|row| shown.grid.text(*row).starts_with(text)).unwrap_or_else(|| panic!("a row starts {text}: {:?}", shown.grid.lines()));
    assert_eq!(shown.grid.text(at("bed 1")), "bed 1: carrots");
    // The emulator's colours and its wide cell are the grid's: the green word, and a character two columns wide.
    let leeks = shown.grid.row(at("bed 2"));
    assert_eq!(shown.grid.text(at("bed 2")), "bed 2: leeks 畑");
    assert!(matches!(leeks[7].look.fg, Ink::Rgb(..)) && leeks[0].look.fg == Ink::Default, "the word the script coloured carries its colour: {:?}", leeks[7]);
    assert_eq!((leeks[13].ch, leeks[13].wide, leeks[14].wide), ('畑', Wide::Lead, Wide::Tail));
    assert!(rt.find(&format!("tile/shell/row/{}/at/13", at("bed 2"))).is_some(), "the wide character is a piece of its own, on its column");
    // A key typed in the window is the script's.
    typed(&mut rt, "2");
    chord(&mut rt, Key::Enter, Mods::default());
    until(&mut rt, "the script to answer the key", |rt| lines(rt, "shell").iter().any(|l| l == "watering bed 2"));
    // A size by name reaches the program and its emulator.
    assert!(line(&mut rt, "terminal.fit cols=40 rows=9 tile=shell").ok);
    until(&mut rt, "the emulator to take the size", |rt| facts(rt, "shell")["cols"] == 40 && facts(rt, "shell")["rows"] == 9);
    // The shell is left by its own word, and the tile says it ended.
    typed(&mut rt, "exit");
    chord(&mut rt, Key::Enter, Mods::default());
    until(&mut rt, "the shell to exit", |rt| facts(rt, "shell")["state"] == "exited");
    assert_eq!(rt.state.person().layer, crate::keys::Layer::Tile, "a program that ended takes no keys");
    drop(rt);
    let _ = std::fs::remove_dir_all(&dir);
}

// ── herdr-core, by a stand-in that speaks its protocol ──────────────────────────────────────────────────────

const DATA: u8 = 0;
const CLOSE: u8 = 2;
const RESIZE: u8 = 3;

fn frame(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(9 + payload.len());
    out.extend_from_slice(&channel.to_le_bytes());
    out.push(kind);
    out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// One viewer of a terminal: the connection it attached on, and its stream channel there.
struct Viewer { conn: u64, channel: u32, to: Arc<Mutex<UnixStream>> }

/// A made-up terminal the stand-in keeps: a shell that echoes, answers two lines and says how an agent stands.
struct Fake {
    address: String,
    name: Option<String>,
    labels: BTreeMap<String, String>,
    cwd: String,
    live: bool,
    status: Option<(String, String)>,
    size: (u16, u16),
    /// Everything it has printed: what a viewer that attaches is painted first.
    printed: Vec<u8>,
    /// Every byte typed into it, by any viewer.
    typed: Vec<u8>,
    typing: String,
    viewers: Vec<Viewer>,
}

impl Fake {
    fn json(&self) -> Value {
        json!({ "address": self.address, "name": self.name, "labels": self.labels, "cwd": self.cwd, "argv": [], "cols": self.size.0, "rows": self.size.1, "keep": false, "parent": null,
            "state": if self.live { "live" } else { "finished" }, "status": self.status.as_ref().map(|(state, msg)| json!({ "state": state, "msg": msg, "app": "seedbot", "title": "" })) })
    }

    fn print(&mut self, bytes: &[u8]) {
        self.printed.extend_from_slice(bytes);
        for viewer in &self.viewers { let _ = viewer.to.lock().unwrap().write_all(&frame(viewer.channel, DATA, bytes)); }
    }

    fn end(&mut self, reason: &str) {
        self.live = false;
        let said = json!({ "reason": reason, "exit_code": if reason == "exited" { json!(0) } else { Value::Null } }).to_string();
        for viewer in self.viewers.drain(..) { let _ = viewer.to.lock().unwrap().write_all(&frame(viewer.channel, CLOSE, said.as_bytes())); }
    }

    /// Bytes a viewer typed: echoed, and a line run when Return ends it.
    fn hear(&mut self, bytes: &[u8]) {
        self.typed.extend_from_slice(bytes);
        for byte in bytes {
            match byte {
                b'\r' => {
                    let typed = std::mem::take(&mut self.typing);
                    self.print(b"\r\n");
                    match typed.trim() {
                        "seeds" => self.print(b"carrots  3 packets\r\nleeks    1 packet\r\n"),
                        "exit" => { self.end("exited"); return }
                        said if said.starts_with("seedbot") => { self.status = Some(("working".into(), "planning the beds".into())); self.print(b"seedbot: planning the beds\r\n") }
                        _ => self.status = None,
                    }
                    self.print(b"plot $ ");
                }
                0x7f => if self.typing.pop().is_some() { self.print(b"\x08 \x08") },
                byte if *byte >= 0x20 => { self.typing.push(*byte as char); self.print(&[*byte]) }
                _ => {}
            }
        }
    }
}

#[derive(Default)]
struct CoreState {
    terminals: Vec<Fake>,
    /// Every call it was asked, in order: the method and its parameters.
    calls: Vec<(String, Value)>,
    /// Every stream that was closed by its viewer, by the terminal's address.
    detached: Vec<String>,
    next: u32,
}

impl CoreState {
    fn find(&mut self, named: &str) -> Option<&mut Fake> { self.terminals.iter_mut().find(|t| t.address == named || t.name.as_deref() == Some(named)) }
    fn calls_of(&self, method: &str) -> Vec<Value> { self.calls.iter().filter(|(theirs, _)| theirs == method).map(|(_, params)| params.clone()).collect() }
}

/// A scripted herdr-core in a scratch folder: `hello` as a line, then frames; `terminal.list`, `terminal.run`,
/// `terminal.attach` (first paint, then live bytes; keys as DATA, a size as RESIZE, CLOSE detaches) and
/// `terminal.kill`, as herdr-gpui's client and `hc.rs` ask them. It keeps one terminal nobody here started.
struct Standin { socket: PathBuf, state: Arc<Mutex<CoreState>> }

impl Standin {
    fn start(dir: &Path) -> Standin {
        let socket = dir.join("core.sock");
        let listener = UnixListener::bind(&socket).expect("the stand-in core listens in its scratch folder");
        let state: Arc<Mutex<CoreState>> = Arc::default();
        state.lock().unwrap().terminals.push(Fake { address: "t9".into(), name: Some("compost".into()), labels: BTreeMap::new(), cwd: "/plots/heap".into(), live: true, status: Some(("idle".into(), String::new())), size: (200, 120), printed: b"turning the heap\r\n".to_vec(), typed: Vec::new(), typing: String::new(), viewers: Vec::new() });
        let shared = state.clone();
        std::thread::spawn(move || {
            for (conn, stream) in listener.incoming().flatten().enumerate() {
                let state = shared.clone();
                std::thread::spawn(move || serve(conn as u64, stream, state));
            }
        });
        Standin { socket, state }
    }
}

fn serve(conn: u64, stream: UnixStream, state: Arc<Mutex<CoreState>>) {
    let to = Arc::new(Mutex::new(stream.try_clone().expect("a stream is cloned")));
    let mut from = BufReader::new(stream);
    // The handshake: one line each way, then frames.
    let mut hello = String::new();
    if from.read_line(&mut hello).unwrap_or(0) == 0 { return }
    let asked: Value = serde_json::from_str(&hello).unwrap_or(Value::Null);
    state.lock().unwrap().calls.push(("hello".into(), asked["params"].clone()));
    let methods = ["doc.get", "doc.set", "events.subscribe", "hello", "terminal.attach", "terminal.keys", "terminal.kill", "terminal.label", "terminal.list", "terminal.run", "terminal.send", "terminal.wait"];
    let welcome = json!({ "jsonrpc": "2.0", "id": asked["id"], "result": { "core": { "id": "standin-core", "name": "shed" }, "features": [], "framed": true, "generation": 1, "methods": methods, "version": "0.1.21" } });
    if to.lock().unwrap().write_all(format!("{welcome}\n").as_bytes()).is_err() { return }
    let mut channels: BTreeMap<u32, String> = BTreeMap::new();
    let mut next_channel = 1u32;
    loop {
        let mut header = [0u8; 9];
        if from.read_exact(&mut header).is_err() { break }
        let (channel, kind, len) = (u32::from_le_bytes([header[0], header[1], header[2], header[3]]), header[4], u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as usize);
        let mut payload = vec![0u8; len];
        if from.read_exact(&mut payload).is_err() { break }
        let mut core = state.lock().unwrap();
        match (channel, kind) {
            (0, DATA) => {
                let call: Value = serde_json::from_slice(&payload).unwrap_or(Value::Null);
                let (method, params) = (call["method"].as_str().unwrap_or("").to_string(), call["params"].clone());
                core.calls.push((method.clone(), params.clone()));
                let named = params["terminal"].as_str().unwrap_or("").to_string();
                let result: Result<Value, &str> = match method.as_str() {
                    "terminal.list" => Ok(json!({ "terminals": core.terminals.iter().filter(|t| t.live || params["all"] == true).map(Fake::json).collect::<Vec<_>>(), "hidden_finished": 0 })),
                    "terminal.run" => {
                        core.next += 1;
                        let address = format!("t{}", core.next);
                        let size = (params["size"]["cols"].as_u64().unwrap_or(200) as u16, params["size"]["rows"].as_u64().unwrap_or(120) as u16);
                        let labels = params["labels"].as_object().into_iter().flatten().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect();
                        // A shell that turns bracketed paste on once it reads lines, as a line editor does.
                        let fake = Fake { address: address.clone(), name: params["name"].as_str().map(str::to_string), labels, cwd: params["cwd"].as_str().unwrap_or("/plots").to_string(), live: true, status: None, size, printed: format!("\x1b[?2004hthe shed's core keeps {address}\r\nplot $ ").into_bytes(), typed: Vec::new(), typing: String::new(), viewers: Vec::new() };
                        let said = fake.json();
                        core.terminals.push(fake);
                        Ok(said)
                    }
                    "terminal.attach" => match core.find(&named).filter(|t| t.live) {
                        Some(terminal) => {
                            let stream_on = next_channel;
                            next_channel += 1;
                            channels.insert(stream_on, terminal.address.clone());
                            if let (Some(cols), Some(rows)) = (params["cols"].as_u64(), params["rows"].as_u64()) { terminal.size = (cols as u16, rows as u16) }
                            terminal.viewers.push(Viewer { conn, channel: stream_on, to: to.clone() });
                            Ok(json!({ "channel": stream_on, "terminal": terminal.json() }))
                        }
                        None => Err("no such live terminal"),
                    },
                    "terminal.kill" => match core.find(&named) { Some(terminal) => { terminal.end("killed"); Ok(terminal.json()) } None => Err("no such terminal") },
                    _ => Err("the stand-in core has no such method"),
                };
                let answer = match &result { Ok(result) => json!({ "jsonrpc": "2.0", "id": call["id"], "result": result }), Err(why) => json!({ "jsonrpc": "2.0", "id": call["id"], "error": { "code": -32000, "message": why, "data": { "kind": "not_found" } } }) };
                let _ = to.lock().unwrap().write_all(&frame(0, DATA, answer.to_string().as_bytes()));
                // The first paint follows the answer on the stream it opened: everything printed so far.
                if method == "terminal.attach" && let Ok(result) = &result && let Some(stream_on) = result["channel"].as_u64() {
                    let painted = core.find(&named).map(|t| t.printed.clone()).unwrap_or_default();
                    let _ = to.lock().unwrap().write_all(&frame(stream_on as u32, DATA, &painted));
                }
            }
            (on, DATA) => if let Some(address) = channels.get(&on).cloned() && let Some(terminal) = core.find(&address) { terminal.hear(&payload) },
            (on, RESIZE) if payload.len() == 4 => if let Some(address) = channels.get(&on).cloned() && let Some(terminal) = core.find(&address) { terminal.size = (u16::from_le_bytes([payload[0], payload[1]]), u16::from_le_bytes([payload[2], payload[3]])) },
            (on, CLOSE) => if let Some(address) = channels.remove(&on) {
                if let Some(terminal) = core.find(&address) { terminal.viewers.retain(|v| !(v.conn == conn && v.channel == on)) }
                core.detached.push(address);
            },
            // Credit, focus and display facts: nothing the stand-in keeps.
            _ => {}
        }
    }
    // The connection is gone: its viewers with it. The terminals run on.
    for terminal in &mut state.lock().unwrap().terminals { terminal.viewers.retain(|v| v.conn != conn) }
}

/// What a launch's window is told through its environment: the stand-in as the only core, and scratch folders.
const DIR: &str = "EP0CH_PTY_LIVE_DIR";

/// This test binary again, running one of the launches below with the stand-in as its core.
fn launch(test: &str, dir: &Path, socket: &Path) -> std::process::Output {
    std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &format!("tests::pty_live::{test}"), "--ignored", "--nocapture", "--test-threads", "1"])
        .env(DIR, dir).env("HC_SOCKET", socket).env("HC_SESSION", "ep0ch-test").env("HOME", dir.join("home"))
        .env("XDG_STATE_HOME", dir.join("state")).env("XDG_CONFIG_HOME", dir.join("config")).env("XDG_RUNTIME_DIR", dir.join("run")).env("XDG_DATA_HOME", dir.join("data"))
        .output().expect("the test binary runs again")
}

/// A launch's window: the garden with its arrangement kept in the scratch folder, on the terminal this build has.
/// None outside a launch (the tests below are run by `herdr_core_keeps_…`, never by themselves).
fn launched() -> Option<(Runtime<App>, Asked)> {
    let dir = PathBuf::from(std::env::var_os(DIR)?);
    let mut g = garden_kept(ok(), &dir.join("native-garden.layout.json"));
    let wake = g.app.store().waker();
    g.app = g.app.running_on(pty::host(wake));
    let asked = g.asked.clone();
    Some((window(g.app), asked))
}

fn handed(asked: &Asked) -> Vec<Value> {
    asked.borrow().iter().rev().find(|a| a["action"] == "lists.read" && a["from"] == "programs").map(|a| a["programs"].as_array().unwrap().clone()).expect("the programs were handed over")
}

/// The first launch: a shell and an agent beside the note, on herdr-core; the agent detached; the window gone.
#[test]
#[ignore = "a launch of herdr_core_keeps_a_shell_and_an_agent_across_two_launches"]
fn first_launch() {
    let Some((mut rt, asked)) = launched() else { return };
    let opened = line(&mut rt, "terminal.open");
    assert!(opened.ok, "{}", opened.said);
    assert_eq!((opened.answer["backend"].as_str(), opened.answer["keeps"].as_bool(), opened.answer["program"].as_str()), (Some("herdr-core"), Some(true), Some("garden-1")));
    assert_eq!(facts(&rt, "shell")["kept"], "herdr-core · outlives this window");
    until(&mut rt, "the core's first paint", |rt| lines(rt, "shell").last().is_some_and(|l| l == "plot $"));
    assert!(shows(&rt, "shell", "the shed's core keeps t"), "{:?}", lines(&rt, "shell"));
    // Keys in, rows out, through the core's stream.
    typed(&mut rt, "seeds");
    chord(&mut rt, Key::Enter, Mods::default());
    until(&mut rt, "the shell's answer", |rt| shows(rt, "shell", "leeks    1 packet"));
    typed(&mut rt, "se");
    until(&mut rt, "the half-typed line", |rt| lines(rt, "shell").last().is_some_and(|l| l == "plot $ se"));
    // An agent beside it: its line is typed into its shell once that reads one, and what it reports of itself is
    // the core's word, as the core lists it.
    let agent = line(&mut rt, "terminal.open agent=true command=\"seedbot --plan beds\"");
    assert!(agent.ok, "{}", agent.said);
    until(&mut rt, "the agent's line to run", |rt| shows(rt, "agent", "seedbot: planning the beds"));
    until(&mut rt, "the core to say how the agent stands", |rt| facts(rt, "agent")["status"] == "working");
    assert_eq!(facts(&rt, "agent")["says"], "planning the beds");
    // The list is what the core runs: this window's two, and the one somebody else started, marked as not its own.
    assert!(line(&mut rt, "tile.leave").ok && line(&mut rt, "bar.open scope=programs").ok);
    let said = handed(&asked);
    assert_eq!(said.iter().map(|p| (p["key"].as_str().unwrap(), p["backend"].as_str().unwrap(), p["status"].as_str(), p["tile"].as_str(), p["mine"].as_bool())).collect::<Vec<_>>(), vec![
        ("garden-1", "herdr-core", None, Some("shell"), None), ("garden-2", "herdr-core", Some("working"), Some("agent"), None), ("", "herdr-core", Some("idle"), None, Some(false)),
    ]);
    assert_eq!((said[2]["name"].as_str(), said[2]["address"].as_str(), said[2]["command"].as_str()), (Some("compost"), Some("t9"), None));
    assert!(line(&mut rt, "bar.close").ok);
    // Detached: the agent's tile is gone, and the agent is not.
    let detached = line(&mut rt, "terminal.detach tile=agent");
    assert!(detached.ok && detached.answer["keeps"] == true, "{}", detached.said);
    assert!(rt.find("tile/agent").is_none());
    // The window let go of the agent's stream, as a viewer that detaches does (Moonframe's reader notices within
    // half a second and closes the channel): the core hears it before this window is gone.
    let till = Instant::now() + Duration::from_millis(1500);
    until(&mut rt, "the stream to be let go", |_| Instant::now() > till);
}

/// The launch after: the shell's tile finds its program as it was left, the agent is in the list with no tile, a
/// jump gives it one, and a close ends it and nothing else.
#[test]
#[ignore = "a launch of herdr_core_keeps_a_shell_and_an_agent_across_two_launches"]
fn second_launch() {
    let Some((mut rt, asked)) = launched() else { return };
    // The arrangement came back with the shell's tile, and its program was found running: its screen is the
    // core's paint of what was there, the half-typed line too, and nothing was typed into it.
    until(&mut rt, "the shell found running", |rt| rt.find("tile/shell").is_some() && lines(rt, "shell").last().is_some_and(|l| l == "plot $ se"));
    assert_eq!((facts(&rt, "shell")["program"].as_str(), facts(&rt, "shell")["attached"].as_bool(), facts(&rt, "shell")["backend"].as_str()), (Some("garden-1"), Some(true), Some("herdr-core")));
    assert!(shows(&rt, "shell", "leeks    1 packet") && rt.find("tile/shell/found").is_some());
    // The agent the last window detached runs on, with no tile: listed, by the core's own word for how it stands.
    assert!(line(&mut rt, "tile.focus tile=reader").ok && line(&mut rt, "bar.open scope=programs").ok);
    until(&mut rt, "the core's list", |rt| { let _ = rt; handed(&asked).len() == 3 });
    let said = handed(&asked);
    assert_eq!(said.iter().map(|p| (p["key"].as_str().unwrap(), p["status"].as_str(), p["tile"].as_str(), p["mine"].as_bool())).collect::<Vec<_>>(), vec![("garden-1", None, Some("shell"), None), ("garden-2", Some("working"), None, None), ("", Some("idle"), None, Some(false))]);
    // It is called what it was started as: the arrangement's file kept that, with the line that started it.
    assert_eq!((said[1]["name"].as_str(), said[1]["command"].as_str()), (Some("Agent"), Some("seedbot --plan beds")));
    // The row's pick jumps: the agent has a tile again, attached, with what it had printed.
    press(&mut rt, "bar/row/programs/garden-2");
    until(&mut rt, "the agent's screen", |rt| rt.find("tile/agent").is_some() && shows(rt, "agent", "seedbot: planning the beds"));
    assert_eq!((facts(&rt, "agent")["attached"].as_bool(), rt.state.person().typing_in.as_deref()), (Some(true), Some("agent")));
    // What this window never started has no key: nothing jumps to it, and nothing here ends it.
    assert!(!line(&mut rt, "terminal.jump key=t9").ok && !line(&mut rt, "terminal.attach key=compost").ok);
    // A close ends the agent, in the core, and only it.
    assert!(line(&mut rt, "tile.leave").ok && line(&mut rt, "tile.close tile=agent").ok);
    assert!(line(&mut rt, "bar.open scope=programs").ok);
    until(&mut rt, "the core to list one program fewer", |rt| { let _ = rt; handed(&asked).len() == 2 });
    assert_eq!(handed(&asked).iter().map(|p| p["name"].as_str().unwrap()).collect::<Vec<_>>(), vec!["Shell", "compost"]);
    assert!(line(&mut rt, "bar.close").ok);
}

/// "Evan opens a shell and an agent beside a note, detaches, returns": two launches of the window against one
/// core, which is a stand-in here. What the core was asked, and what it still runs, is the proof.
#[test]
fn herdr_core_keeps_a_shell_and_an_agent_across_two_launches() {
    let dir = scratch("core");
    for folder in ["home", "state", "config", "run", "data"] { std::fs::create_dir_all(dir.join(folder)).unwrap(); }
    let core = Standin::start(&dir);
    let said = |out: &std::process::Output| format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));

    let first = launch("first_launch", &dir, &core.socket);
    assert!(first.status.success() && said(&first).contains("1 passed"), "the first launch:\n{}", said(&first));
    // The window is gone, and nothing was ended with it: its two terminals run on, viewed by nobody.
    std::thread::sleep(Duration::from_millis(300));
    {
        let state = core.state.lock().unwrap();
        let runs = state.calls_of("terminal.run");
        assert_eq!(runs.len(), 2, "a shell and an agent were started, once each: {runs:?}");
        for (run, key) in runs.iter().zip(["garden-1", "garden-2"]) {
            // Each was started to be nobody's child and to outlive what started it, at a size (the manual `hc --skill`
            // prints: a terminal ends with its parent unless it is started so, and an API client says its size),
            // under the labels Moonframe's backend finds its own by, and a name that reads in `hc ls`.
            assert_eq!((run["outlive_parent"].as_bool(), run["no_parent"].as_bool()), (Some(true), Some(true)), "{run}");
            assert!(run["size"]["cols"].as_u64().is_some_and(|cols| cols >= 2) && run["size"]["rows"].as_u64().is_some_and(|rows| rows >= 1), "{run}");
            assert_eq!(run["labels"], json!({ "moonframe": key, "moonframe-app": "ep0ch-native" }));
            assert_eq!(run["name"], format!("ep0ch-native.{key}"));
        }
        assert!(state.calls_of("terminal.kill").is_empty(), "a window that goes ends nothing");
        let ours: Vec<&Fake> = state.terminals.iter().filter(|t| t.labels.get("moonframe-app").is_some_and(|app| app == "ep0ch-native")).collect();
        assert!(ours.len() == 2 && ours.iter().all(|t| t.live && t.viewers.is_empty()), "both run on, attached to by nobody");
        // What was typed is what the person typed, and the agent's line once.
        assert_eq!(String::from_utf8_lossy(&ours[0].typed), "seeds\rse");
        assert_eq!(String::from_utf8_lossy(&ours[1].typed), "seedbot --plan beds\r");
        assert!(state.detached.contains(&ours[1].address), "the agent's stream was closed by its viewer when its tile was detached");
        assert!(state.terminals[0].typed.is_empty(), "nothing was typed into the terminal somebody else started");
    }

    let second = launch("second_launch", &dir, &core.socket);
    assert!(second.status.success() && said(&second).contains("1 passed"), "the second launch:\n{}", said(&second));
    let state = core.state.lock().unwrap();
    assert_eq!(state.calls_of("terminal.run").len(), 2, "what was found running was attached to: nothing was started a second time");
    let ours: Vec<&Fake> = state.terminals.iter().filter(|t| t.labels.get("moonframe-app").is_some_and(|app| app == "ep0ch-native")).collect();
    assert_eq!(String::from_utf8_lossy(&ours[0].typed), "seeds\rse", "nothing was typed into the shell that was found running");
    assert_eq!(String::from_utf8_lossy(&ours[1].typed), "seedbot --plan beds\r", "nor the agent's line a second time");
    // The close ended the agent and nothing else: one kill, of its address; the other's and the shell run on.
    assert_eq!(state.calls_of("terminal.kill").iter().map(|kill| kill["terminal"].as_str().unwrap().to_string()).collect::<Vec<_>>(), vec![ours[1].address.clone()]);
    assert!(ours[0].live && !ours[1].live && state.terminals[0].live && state.terminals[0].typed.is_empty());
    assert!(!state.calls.iter().any(|(method, params)| method == "terminal.attach" && params["terminal"] == "t9"), "the terminal somebody else started was never attached to");
    drop(state);
    let _ = std::fs::remove_dir_all(&dir);
}

// ── where a core listens ────────────────────────────────────────────────────────────────────────────────────

/// `hc.rs` finds a core's socket as `hc` does (herdr-gpui's client: `endpoint.rs`): `HC_SOCKET`, else `socket` in
/// its config, else the user's runtime folder, else beside the session's state.
#[test]
fn a_core_s_socket_is_found_as_hc_finds_it() {
    use std::ffi::OsString;
    let vars = |pairs: &'static [(&'static str, &'static str)]| move |name: &str| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| OsString::from(value));
    let none = |_: &Path| None;
    let at = |pairs, run_user: Option<&str>, config: &dyn Fn(&Path) -> Option<String>| pty::hc::Endpoint::found_in(&vars(pairs), run_user.map(PathBuf::from), config).map(|e| (e.socket.to_string_lossy().into_owned(), e.session));
    assert_eq!(at(&[("HOME", "/home/gardener"), ("HC_SOCKET", "/plots/core.sock"), ("XDG_RUNTIME_DIR", "/run/gardener")], None, &none), Some(("/plots/core.sock".into(), "default".into())));
    let configured = |path: &Path| (path == Path::new("/home/gardener/.config/herdr-core/config.toml")).then(|| "# where it listens\nsocket = \"/plots/own.sock\"  # by hand\n[machines]\nsocket = \"no\"\n".to_string());
    assert_eq!(at(&[("HOME", "/home/gardener"), ("XDG_RUNTIME_DIR", "/run/gardener")], None, &configured), Some(("/plots/own.sock".into(), "default".into())));
    assert_eq!(at(&[("HOME", "/home/gardener"), ("XDG_RUNTIME_DIR", "/run/gardener"), ("HC_SESSION", "beds")], Some("/run/user/7"), &none), Some(("/run/gardener/herdr-core/beds.sock".into(), "beds".into())));
    assert_eq!(at(&[("HOME", "/home/gardener")], Some("/run/user/7"), &none), Some(("/run/user/7/herdr-core/default.sock".into(), "default".into())));
    assert_eq!(at(&[("HOME", "/home/gardener"), ("XDG_STATE_HOME", "/plots/state"), ("HC_SESSION", "beds")], None, &none), Some(("/plots/state/herdr-core/beds/beds.sock".into(), "beds".into())));
    assert_eq!(at(&[("HOME", "/home/gardener")], None, &none), Some(("/home/gardener/.local/state/herdr-core/default/default.sock".into(), "default".into())));
    // A session's name is a folder's: one that isn't names no core.
    assert_eq!(at(&[("HOME", "/home/gardener"), ("HC_SESSION", "../beds")], None, &none), None);
    assert_eq!(pty::hc::name_for("ep0ch-native/garden-1").as_deref(), Some("ep0ch-native.garden-1"));
    assert_eq!(pty::hc::name_for("t7"), None);
}
