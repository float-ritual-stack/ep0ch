//! An agent over the control socket: a real Unix socket in a scratch folder, speaking the door's control
//! protocol to the window. What it runs is attributed to it on the wire and on screen, and it takes nothing of
//! the person's: not their keys, not the bar they have open, not the note they read.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender, channel};
use std::time::{Duration, Instant};

use rune::Runtime;
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App};
use crate::control::{self, Job, Ui};

/// The test's way onto the UI thread: jobs queue here, and the test's own loop runs them on its window.
#[derive(Clone)]
struct Queue(Sender<Job>);

impl Ui for Queue {
    fn run(&self, _: Option<&str>, job: Job) -> Result<(), String> { let _ = self.0.send(job); Ok(()) }
}

pub(super) struct Door { pub(super) rt: Runtime<App>, jobs: Receiver<Job>, asked: Asked, _control: control::Control, path: PathBuf, dir: PathBuf }

impl Drop for Door {
    fn drop(&mut self) { let _ = std::fs::remove_file(&self.path); let _ = std::fs::remove_dir(&self.dir); }
}

fn door(name: &str) -> Door {
    let g = garden(ok());
    door_over(g.app, g.asked, name)
}

/// A window over `app` with its control socket served in a scratch folder: what an agent reaches.
pub(super) fn door_over(app: App, asked: Asked, name: &str) -> Door {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-control-{}-{name}", std::process::id()));
    let path = dir.join("native.sock");
    let (send, jobs) = channel();
    let control = control::serve(&path, Queue(send)).expect("the socket is served");
    Door { rt: window(app), jobs, asked, _control: control, path, dir }
}

impl Door {
    /// One request down the socket, with the window's loop turning until it is answered.
    pub(super) fn ask(&mut self, request: Value) -> Value {
        let mut stream = UnixStream::connect(&self.path).expect("the socket answers");
        writeln!(stream, "{request}").unwrap();
        stream.set_read_timeout(Some(Duration::from_millis(20))).unwrap();
        let mut reader = BufReader::new(stream);
        let (until, mut line) = (Instant::now() + Duration::from_secs(10), String::new());
        loop {
            while let Ok(job) = self.jobs.try_recv() { self.rt.update(move |s, tx| job(s, tx)); rest(&mut self.rt); }
            match reader.read_line(&mut line) {
                Ok(n) if n > 0 && line.ends_with('\n') => return serde_json::from_str(&line).unwrap(),
                _ if Instant::now() > until => panic!("no answer to {request}"),
                _ => {}
            }
        }
    }
}

#[test]
fn an_agent_s_act_is_attributed_to_it_and_takes_no_focus_and_no_selection() {
    let mut d = door("act");
    // The person is in the bar, a word typed, a row lit.
    d.rt.update(|s, _| { s.act("bar.open query=sh", Actor::Person); s.act("bar.move by=1", Actor::Person); });
    rest(&mut d.rt);
    let (person, cursor, note, steps) = (d.rt.state.person(), d.rt.state.bar.cursor, d.rt.state.subject(), d.rt.state.steps.len());
    assert_eq!((person.layer, cursor), (crate::keys::Layer::Bar, 1));

    // The wave's line, as the door's own client sends it: `ep0ch act note.trash ref=beans --as compost-agent`.
    let answer = d.ask(json!({ "cmd": "act", "action": "note.trash", "args": { "ref": "beans" }, "as": "compost-agent" }));
    assert_eq!(answer["ok"], true, "{answer}");
    let sent = d.asked.borrow().iter().rev().find(|a| a["action"] == "delete").cloned().expect("the note went to the Trash");
    assert_eq!((sent["blockId"].as_str(), &sent["mutation"]), (Some("beans"), &json!({ "author": "agent", "actorId": "compost-agent" })), "recorded as the agent's, on the wire");
    let step = d.rt.state.steps[steps..].iter().find(|step| step.action == "note.trash").cloned().unwrap();
    assert_eq!((step.by.clone(), step.ok), (Actor::Agent("compost-agent".into()), true));
    assert_eq!(d.rt.state.agent_said.as_deref(), Some("an agent (compost-agent) · note.trash"), "and said on screen");
    assert!(d.rt.find("status").is_some());

    // Nothing of the person's moved: their keys, the bar they have open, its words and lit row, the note they read.
    assert_eq!((d.rt.state.person(), d.rt.state.bar.cursor, d.rt.state.bar.edit.words(), d.rt.state.bar.edit.takes_keys(), d.rt.state.subject()), (person, cursor, "sh", true, note));
    typed(&mut d.rt, "ed");
    assert_eq!(d.rt.state.bar.edit.words(), "shed", "the bar's line still has the keys");

    // With no note named it is the open one, as the person's is: the same action, another actor.
    let answer = d.ask(json!({ "cmd": "act", "action": "note.trash" }));
    assert_eq!(answer["ok"], true, "{answer}");
    let sent = d.asked.borrow().iter().rev().find(|a| a["action"] == "delete").cloned().unwrap();
    assert_eq!((sent["blockId"].as_str(), sent["mutation"]["author"].as_str(), sent["mutation"]["actorId"].as_str()), (Some("plot"), Some("agent"), Some("agent")));
    assert!(d.rt.state.bar.open, "even then the bar stays the person's");
}

#[test]
fn what_is_the_person_s_is_refused_to_an_agent_with_why() {
    let mut d = door("refusals");
    d.rt.update(|s, _| { s.act("edit", Actor::Person); });
    rest(&mut d.rt);
    d.rt.update(|s, _| write(s, "Plot, half written"));
    let before = d.asked.borrow().len();
    for (request, why) in [
        // An open aimed at the reader that holds their draft is the actor rule's no.
        (json!({ "cmd": "act", "action": "open", "args": { "id": "shed" }, "tile": "reader" }), "the person is in an edit on reader"),
        (json!({ "cmd": "act", "action": "tile.close", "tile": "reader" }), "not closed: it holds an edit of Plot"),
        // The person's own, said on its row: refused in the row's words whether or not they type.
        (json!({ "cmd": "act", "action": "tile.focus", "tile": "tree" }), "the person's keys are theirs: an agent never moves them"),
        (json!({ "cmd": "act", "action": "link.follow", "args": { "ref": "ep0ch:b/shed" } }), "the person is in an edit on reader"),
        (json!({ "cmd": "act", "action": "back" }), "the person is in an edit on reader"),
        (json!({ "cmd": "act", "action": "edit.close", "args": { "discard": "true" } }), "the editor is the person's"),
        (json!({ "cmd": "act", "action": "edit.save" }), "the editor is the person's"),
        (json!({ "cmd": "act", "action": "draft.paste", "args": { "text": "an agent's words" } }), "the editor is the person's"),
        (json!({ "cmd": "act", "action": "complete.accept" }), "the editor is the person's"),
        (json!({ "cmd": "act", "action": "note.trash" }), "has a draft open on it"),
        (json!({ "cmd": "act", "action": "dock.toggle", "args": { "side": "left" } }), "an agent doesn't move what they look at"),
        (json!({ "cmd": "act", "action": "bar.close" }), "the bar is the person's"),
        (json!({ "cmd": "act", "action": "notice.dismiss" }), "the notice is the person's"),
    ] {
        let answer = d.ask(request.clone());
        assert!(answer["ok"] == false && answer["error"].as_str().unwrap().contains(why), "{request}: {answer}");
    }
    assert_eq!((d.asked.borrow().len(), words(&d.rt.state), draft(&d.rt.state).unwrap().buf.takes_keys(), d.rt.state.subject().as_deref()), (before, "Plot, half written", true, Some("plot")), "nothing was written and nothing of theirs moved");
    assert!(d.rt.state.agent_said.as_deref().unwrap().contains("refused"), "a refusal is said too: {:?}", d.rt.state.agent_said);
    // An open that names no tile is the layout's to place, as the door places one from outside: the screen's
    // landing reader holds their draft, so it gets a reader of its own beside, and nothing of theirs moves.
    for request in [json!({ "cmd": "act", "action": "open", "args": { "id": "shed" }, "as": "seedling-agent" }), json!({ "cmd": "act", "action": "tree.pick", "args": { "id": "shed" } })] {
        let answer = d.ask(request.clone());
        // (A pick answers what its row ran and what that answered: the open's own answer is inside it.)
        let landed = if answer["result"]["ran"].is_string() { &answer["result"]["answer"] } else { &answer["result"] };
        assert!(answer["ok"] == true && landed["tile"].as_str().is_some_and(|tile| tile != "reader"), "{request}: {answer}");
    }
    assert_eq!((words(&d.rt.state), draft(&d.rt.state).unwrap().buf.takes_keys(), d.rt.state.note_of("reader").as_deref(), d.rt.state.layout.focus.as_str()), ("Plot, half written", true, Some("plot"), "reader"), "the draft, its reader and the keys are where they were");
    // A request that is itself wrong says so in the door's kinds.
    let answer = d.ask(json!({ "cmd": "act", "action": "note.bin" }));
    assert_eq!((answer["ok"].as_bool(), answer["kind"].as_str()), (Some(false), Some("invalid")));
    assert_eq!(d.ask(json!({ "cmd": "dance" }))["kind"], "invalid");
}

#[test]
fn peek_says_where_the_person_is_and_actions_lists_every_row() {
    let mut d = door("peek");
    d.rt.update(|s, _| { s.act("bar.open scope=query query=type=chore", Actor::Person); });
    rest(&mut d.rt);
    let peek = d.ask(json!({ "cmd": "peek" }));
    let screen = &peek["result"]["screen"];
    for part in ["screen", "focus", "whereabouts", "watches", "tiles"] { assert!(!screen[part].is_null(), "peek has {part}: {screen}") }
    assert_eq!((screen["focus"].as_str(), screen["whereabouts"]["layer"].as_str(), screen["whereabouts"]["typingIn"].as_str(), screen["whereabouts"]["esc"].as_str()), (Some("reader"), Some("bar"), Some("bar"), Some("bar.close")));
    let tiles: Vec<&str> = screen["tiles"].as_array().unwrap().iter().map(|tile| tile["name"].as_str().unwrap()).collect();
    assert_eq!(tiles, ["tree", "reader", "props", "backlinks", "threads", "proposals", "revisions", "bar"], "every tile of the arrangement, then the bar while it is open");
    assert_eq!(screen["tiles"][1]["asks"][0]["action"], "notes.page");
    assert_eq!((screen["tiles"][7]["facts"]["rows"][0]["act"].as_str(), screen["tiles"][7]["asks"][0]["params"]["from"].as_str(), screen["tiles"][7]["asks"][0]["params"]["query"].as_str()), (Some("open id=\"beans\""), Some("query"), Some("type=chore")), "the bar's rows are a list the service answers, each with its act line");
    assert!(screen["tiles"][7]["facts"]["sources"].as_array().unwrap().iter().any(|source| source["id"] == "screens" && source["served"] == true), "the bar's sources say which are the service's: {}", screen["tiles"][7]["facts"]["sources"]);
    assert_eq!((screen["tiles"][2]["facts"]["follows"].as_str(), screen["tiles"][3]["facts"]["rows"][0]["id"].as_str(), screen["tiles"][3]["asks"][0]["params"]["of"].as_str(), screen["tiles"][3]["asks"][0]["params"]["from"].as_str()), (Some("reader"), Some("plan"), Some("plot"), Some("links")), "the tiles that follow the reader list what is about its note");
    assert_eq!((screen["tiles"][0]["facts"]["arrange"].as_str(), screen["tiles"][0]["facts"]["rows"][0]["act"].as_str(), screen["tiles"][0]["kind"].as_str()), (Some("tree"), Some("open id=\"plot\""), Some("screens.tree")), "the tree is a list like the rest, its kind the service's row");
    assert_eq!(screen["watches"]["budget"][0]["said"], "7/64", "the tree, the page (one slot, though several tiles are about its note), the three lists about it that are on screen (the properties, the links, the comments in front of their tabs), the outline's screens and the bar's query");
    assert!(peek["result"]["text"].as_array().unwrap().iter().any(|line| line.as_str().unwrap().contains("> Plot")), "the screen as text marks the open note");

    let listed = d.ask(json!({ "cmd": "actions" }));
    let rows = listed["result"]["actions"].as_array().unwrap();
    assert_eq!(rows.len(), crate::actions::all().count());
    let trash = rows.iter().find(|row| row["name"] == "note.trash").unwrap();
    assert_eq!((trash["touches"].as_str(), trash["args"]["ref"]["type"].as_str(), trash["keys"][0]["keys"].as_str()), (Some("draft"), Some("string"), Some("mod+backspace")));
}

#[test]
fn the_socket_is_the_user_s_alone() {
    let d = door("mode");
    assert_eq!(std::fs::metadata(&d.path).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(&d.dir).unwrap().permissions().mode() & 0o777, 0o700);
    // A folder others can reach is refused, with why, and nothing is served there.
    let open = std::env::temp_dir().join(format!("ep0ch-native-control-{}-open", std::process::id()));
    std::fs::create_dir_all(&open).unwrap();
    std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o755)).unwrap();
    let (send, _jobs) = channel();
    let refused = control::serve(&open.join("native.sock"), Queue(send)).err().expect("refused");
    assert!(refused.contains("isn't yours alone") && !open.join("native.sock").exists(), "{refused}");
    let _ = std::fs::remove_dir(&open);
}
