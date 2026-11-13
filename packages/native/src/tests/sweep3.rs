//! The third hydra sweep, held by what the window does: each test is a failure a second decider caused, pressed
//! through act lines alone, and goes red when one comes back. (`one_owner.rs` scans the source for the same thing.)
use serde_json::json;

use super::support::*;
use super::sweep2::{asked_for, laid, leaf, note_in, split, with};
use crate::actions::{Actor, App, Field};

/// The rows a list tile shows, as the service answered them.
fn rows_in(app: &App, tile: &str) -> Vec<crate::page::ListRow> { app.layout.named(tile).and_then(|id| app.list_of(&id).map(|answer| answer.list.rows.clone())).unwrap_or_default() }
/// The act line of a row's own press, by what the press says.
fn press_of(app: &App, tile: &str, row: &str, says: &str) -> String {
    let rows = rows_in(app, tile);
    let row = rows.iter().find(|r| r.id == row).unwrap_or_else(|| panic!("{tile} lists no row {row}"));
    row.cells.iter().find(|cell| cell["text"] == says).and_then(|cell| cell["act"].as_str()).unwrap_or_else(|| panic!("{row:?} has no press {says}")).to_string()
}

// ── which reader a list about a note speaks for: one answer, for its subject, its mark, its press and its opens ────

/// A list of revisions that keeps its note (it doesn't follow) still lists that note's texts after the reader has
/// moved on. Its row's Restore names the note it is a text of, so it is refused in a reader that shows another:
/// revision 2 of one note never lands in another note's editor.
#[test]
fn a_revision_is_put_back_only_into_the_note_it_is_a_text_of() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), with(leaf("revisions", "kept"), json!({ "subject": "held" }))])) } }));
    assert!(act(&mut g.app, "open id=plot").ok);
    assert_eq!(asked_for(&g, "revisions")["of"], "plot", "it lists the note its home showed when it first listed");
    assert!(act(&mut g.app, "open id=shed").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), asked_for(&g, "revisions")["of"].as_str()), (Some("shed"), Some("plot")), "the reader moved on, and the list kept its note");
    let restore = press_of(&g.app, "kept", "2", "Restore");
    assert_eq!(restore, "revision.restore of=\"plot\" revision=\"2\"", "the press names the note, as the service wrote it");
    let before = g.asked.borrow().len();
    let refused = g.app.act_in(&restore, "kept", Actor::Person);
    g.app.settle();
    assert!(!refused.ok && refused.said.contains("bed shows another note (shed), not plot"), "{}", refused.said);
    assert!(g.asked.borrow()[before..].iter().all(|a| a["action"] != "block.revisions"), "no text was asked for");
    assert!(g.app.draft_on(&g.app.layout.named("bed").unwrap()).is_none(), "and no editor opened on the other note");
    // Back on its note, the same press puts the text in.
    assert!(act(&mut g.app, "open id=plot").ok);
    let put = g.app.act_in(&restore, "kept", Actor::Person);
    g.app.settle();
    assert!(put.ok, "{}", put.said);
    assert!(g.app.draft_on(&g.app.layout.named("bed").unwrap()).is_some_and(|draft| draft.note == "plot"));
}

/// A list that follows another list (`source: tile:<a list>`) and has no wire of its own speaks for a reader all
/// the same: its row's open lands where the screen's opens land, never "in" the list it follows.
#[test]
fn a_list_that_follows_a_list_opens_its_rows_in_a_reader() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "found", "root": split(json!([with(leaf("query", "found"), json!({ "query": "type=chore" })), with(leaf("query", "also"), json!({ "query": "type=chore", "source": "tile:found" })), leaf("reader", "almanac"), leaf("reader", "bed")])) } }));
    let also = g.app.layout.named("also").unwrap();
    assert_eq!(g.app.home_of(&also).map(|id| g.app.layout.name(&id)).as_deref(), Some("bed"), "its home is a tile that reads notes");
    assert_eq!(g.app.facts(&also).home.as_deref(), Some("bed"), "and the layout's rules are told the same tile");
    let opened = g.app.act_in("open id=beans", "also", Actor::Person);
    g.app.settle();
    assert_eq!((opened.ok, opened.answer["tile"].as_str()), (true, Some("bed")), "{}", opened.said);
    assert_eq!(note_in(&g.app, "bed").as_deref(), Some("beans"));
}

/// One answer, whoever asks: a list whose selection feeds a second reader follows that reader's note, marks it as
/// the one open, tells the layout that reader is its home, and a press in it that acts on a note acts there.
#[test]
fn a_list_speaks_for_one_reader_whatever_is_asked_of_it() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), leaf("reader", "bench"), with(leaf("props", "about"), json!({ "wires": [{ "verb": "select", "to": "bench" }] }))])) } }));
    assert!(act(&mut g.app, "open id=plot tile=bed").ok && act(&mut g.app, "open id=shed tile=bench").ok);
    let about = g.app.layout.named("about").unwrap();
    assert_eq!((note_in(&g.app, "bed").as_deref(), note_in(&g.app, "bench").as_deref()), (Some("plot"), Some("shed")));
    assert_eq!(g.app.home_of(&about).map(|id| g.app.layout.name(&id)).as_deref(), Some("bench"));
    assert_eq!((g.app.subject_of(&about).as_deref(), g.app.home_note(&about).as_deref(), g.app.facts(&about).home.as_deref()), (Some("shed"), Some("shed"), Some("bench")), "its subject, its mark and its home are one reader's");
    assert_eq!(asked_for(&g, "properties")["of"], "shed");
    let edited = g.app.act_in("edit", "about", Actor::Person);
    g.app.settle();
    assert!(edited.ok, "{}", edited.said);
    assert_eq!(g.app.drafts.iter().map(|draft| g.app.layout.name(&draft.tile)).collect::<Vec<_>>(), ["bench"], "a press in it that acts on a note acts in that reader");
}

// ── whether Return is the field's or the completion list's: the service's word on the row ──────────────────────────

/// A row that would leave the line as typed takes no Return: the service says so on the row (outline-core's
/// `enterKeeps`, the rule the door's completer asks), and the window types a line. It compares no text to know; a
/// deliberate choice (an arrow) makes Return take the row, as it does anywhere.
#[test]
fn return_types_a_line_under_a_row_that_would_write_nothing() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "edit").ok);
    let field = Field::Draft("reader".into());
    let text = format!("{}\nSee [[shed]]", words(&g.app));
    write(&mut g.app, &text);
    g.app.field(&field).select(text.len() - 2, text.len() - 2);
    g.app.typed(&field);
    g.app.settle();
    let rows: Vec<(String, Option<String>)> = g.app.completing("reader").expect("the list is open").rows.iter().map(|row| (row.insert.clone(), row.enter.clone())).collect();
    assert_eq!(rows, [("[[shed]]".to_string(), Some("new line".to_string()))], "the row that is already written says Return is the field's");
    assert!(act(&mut g.app, "complete.enter").ok);
    assert_eq!(words(&g.app), format!("{}\n]]", &text[..text.len() - 2]), "a line is typed where the caret is, and the row is not written");
}

// ── who a script's act runs as, and who its writes are recorded as: the script, on the press's invitation ─────────────

fn sent(asked: &Asked, action: &str) -> Vec<serde_json::Value> { asked.borrow().iter().filter(|a| a["action"] == action).cloned().collect() }

/// A script's act for this window, as the service sends one: the run it is of, who asked for the run, and the
/// invitation the press that started it minted (the service passes it on with every act of the run).
fn script_act(g: &mut Garden, request: &str, invitation: Option<&str>, action: &str, args: serde_json::Value) -> serde_json::Value {
    let client = g.app.store().client().to_string();
    let mut script = json!({ "requestId": request, "targetClientId": client, "action": action, "args": args, "actor": { "author": "agent", "actorId": "script:tidy", "sessionId": "run-1" }, "requestedBy": { "author": "user" } });
    if let Some(invitation) = invitation { script["invitation"] = json!(invitation) }
    host_says(&mut g.app, &g.said, json!({ "event": { "domain": "script", "action": "scripts.act", "script": script } }));
    g.asked.borrow().iter().rev().find(|a| a["action"] == "scripts.answer" && a["requestId"] == request).cloned().unwrap_or_else(|| panic!("{request} was answered"))
}

/// The person presses a button the service runs. Each act the run has for this window runs as the script: its step
/// says so, and so does what it writes. What lets it do what is the person's own (their editor, their keys) is the
/// invitation their press minted, which the run's acts carry: never who the service says asked for the run. A call
/// without the invitation, with one this window never minted, or after the run has ended, is an agent's like any other.
#[test]
fn a_pressed_script_acts_as_the_script_on_the_press_s_invitation_and_never_as_the_person() {
    let mut g = garden(ok());
    let pressed = act(&mut g.app, "button.press label=\"Tidy the shed\"");
    assert!(pressed.ok, "{}", pressed.said);
    let run = sent(&g.asked, "scripts.sequence").pop().expect("the service is asked to run it");
    let invitation = run["invitation"].as_str().expect("the press mints an invitation and the run carries it").to_string();
    assert_eq!(run["mutation"]["author"], "user", "the press itself is the person's");

    // On the invitation the script may move the person's keys, which no other agent may; it is still the script that did.
    let tree = g.app.layout.named("tree").unwrap();
    let focused = script_act(&mut g, "r1", Some(&invitation), "tile.focus", json!({ "tile": "tree" }));
    assert!(focused.get("error").is_none(), "{focused}");
    let step = g.app.steps.last().unwrap().clone();
    assert_eq!((g.app.layout.focus.as_str(), step.by.id().as_str(), step.ok), (tree.as_str(), "agent:script:tidy", true), "invited, it moves the keys; the step is the script's");
    // What it writes is recorded as the script's, never as the user's.
    let trashed = script_act(&mut g, "r2", Some(&invitation), "note.trash", json!({ "ref": "shed" }));
    assert!(trashed.get("error").is_none(), "{trashed}");
    let write = sent(&g.asked, "delete").pop().expect("the note was trashed on the wire");
    assert_eq!((write["mutation"]["author"].as_str(), write["mutation"]["actorId"].as_str()), (Some("agent"), Some("script:tidy")), "the write is the script's: {write}");

    // No invitation, or one nobody here minted: an agent's act, whoever the service says asked for the run.
    for (request, carried) in [("r3", None), ("r4", Some("a-token-from-somewhere-else"))] {
        let refused = script_act(&mut g, request, carried, "edit", json!({}));
        assert!(refused["error"].as_str().is_some_and(|why| why.contains("editor")) && g.app.drafts.is_empty(), "{request}: the person's editor is not an uninvited script's to open: {refused}");
    }
    // The run ends: its invitation is spent with it.
    host_says(&mut g.app, &g.said, json!({ "event": { "domain": "script", "action": "scripts.ended", "ended": { "run": "run-1", "reason": "done", "message": "swept", "requestedBy": { "author": "user" }, "written": [], "undo": true } } }));
    let late = script_act(&mut g, "r5", Some(&invitation), "edit", json!({}));
    assert!(late["error"].is_string() && g.app.drafts.is_empty(), "an invitation is one run's: {late}");
}

/// An agent's press of the same button invites nothing: the run it starts acts as an agent throughout.
#[test]
fn an_agent_s_press_mints_no_invitation() {
    let mut g = garden(ok());
    let pressed = g.app.act("button.press label=\"Tidy the shed\"", Actor::Agent("compost-agent".into()));
    g.app.settle();
    assert!(pressed.ok, "{}", pressed.said);
    let run = sent(&g.asked, "scripts.sequence").pop().expect("the service is asked to run it");
    assert!(run.get("invitation").is_none(), "an agent's press carries no invitation: {run}");
    let refused = script_act(&mut g, "r1", None, "tile.focus", json!({ "tile": "tree" }));
    assert!(refused["error"].is_string(), "{refused}");
}

// ── what a close leaves of the closed reader's note: the layout's answer, shown by the action ──────────────────────

/// A tree that feeds a reader, whose own opens are wired to a second reader beside it.
fn wired_pair() -> Garden {
    laid(json!({ "lands": "bed", "layout": { "focus": "beds", "root": split(json!([with(leaf("tree", "beds"), json!({ "wires": [{ "verb": "select", "to": "bed" }] })), with(leaf("reader", "bed"), json!({ "wires": [{ "verb": "open", "to": "spare" }] })), leaf("reader", "spare")])) } }))
}

/// Two readers, the first's opens wired to the second, which was told no note. The first is closed: its note stays
/// on screen, in the reader the layout says is its heir (the door's `closeHeir`, held by the layout's contract
/// table), with the way back it had. A reader that shows a note of its own keeps it, and the closed note goes.
#[test]
fn a_closed_reader_s_note_stays_on_screen_in_the_reader_its_opens_land_in() {
    let mut g = wired_pair();
    let spare = g.app.layout.named("spare").unwrap();
    assert!(act(&mut g.app, "open id=plot tile=beds").ok && act(&mut g.app, "open id=shed tile=beds").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), g.app.ui(&spare).note.as_deref()), (Some("shed"), None), "the tree's picks land in the bed; the spare reader was told nothing");
    assert_eq!(g.app.facts(&spare).showing, None, "a reader told no note shows none, as the layout's rules read it");
    let closed = act(&mut g.app, "tile.close tile=bed");
    assert!(closed.ok, "{}", closed.said);
    assert_eq!((closed.answer["heir"].as_str(), closed.answer["note"].as_str()), (Some("spare"), Some("shed")), "the layout says who keeps the note: {}", closed.answer);
    assert_eq!((g.app.ui(&spare).note.as_deref(), g.app.ui(&spare).history.as_slice()), (Some("shed"), ["plot".to_string()].as_slice()), "the heir shows it, with the way back the closed reader had");

    // A reader that shows a note of its own takes none: the closed reader's note goes with it.
    let mut g = wired_pair();
    assert!(act(&mut g.app, "open id=plot tile=bed").ok, "an open from the bed goes down its wire");
    assert!(act(&mut g.app, "open id=shed tile=beds").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), note_in(&g.app, "spare").as_deref()), (Some("shed"), Some("plot")));
    let closed = act(&mut g.app, "tile.close tile=bed");
    assert!(closed.ok && closed.answer.get("heir").is_none(), "{} {}", closed.said, closed.answer);
    assert_eq!(note_in(&g.app, "spare").as_deref(), Some("plot"));
}

// ── what an agent the actor rule holds back is told to do instead: an action this window has ───────────────────────

/// Every action a refusal of this window's own names: a `word.word`, as an act line starts, and the word an
/// argument is written after (`comment body=…`), which is how an action of one word is named.
fn actions_named(said: &str) -> Vec<String> {
    let id = |word: &str| !word.is_empty() && !word.starts_with('.') && !word.ends_with('.') && word.chars().all(|c| c.is_ascii_lowercase() || c == '.');
    let dotted = said.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_')).filter(|word| word.contains('.') && id(word)).map(str::to_string);
    let words: Vec<&str> = said.split_whitespace().collect();
    let argued = words.windows(2).filter(|pair| pair[1].split_once('=').is_some_and(|(key, _)| !key.is_empty() && key.chars().all(|c| c.is_ascii_lowercase()))).map(|pair| pair[0].trim_start_matches('(')).filter(|word| id(word)).map(str::to_string);
    let mut named: Vec<String> = dotted.chain(argued).collect();
    named.sort();
    named.dedup();
    named
}

/// An agent refused by the dispatcher is told a way out it can take here: every action its refusal names is one
/// this window has. (It was told `block.mark`, the door's, and answered "no action named block.mark" when it tried.)
#[test]
fn a_refusal_of_the_dispatcher_s_names_only_actions_this_window_has() {
    let lacking = |said: &str| actions_named(said).into_iter().filter(|id| crate::actions::find(id).is_none()).collect::<Vec<_>>();
    // (The reading finds an action of one word too, which is what this window's way out is.)
    assert_eq!(actions_named("their keys are theirs · a remark gets their attention (remark body=…), or block.mark"), ["block.mark", "remark"]);
    // What is the person's own says so on its row.
    for action in crate::actions::all() {
        if let Some(theirs) = action.row.person { assert_eq!(lacking(theirs), Vec::<String>::new(), "{}'s refusal names an action this window hasn't: {theirs}", action.row.id) }
    }
    // The tile they type in, and what they look at while they are at the keys.
    let mut g = garden(ok());
    let agent = || Actor::Agent("seedling-agent".into());
    assert!(act(&mut g.app, "tile.focus tile=reader").ok && act(&mut g.app, "edit").ok);
    let theirs = g.app.act("back tile=reader", agent());
    assert!(!theirs.ok && theirs.said.contains("comment body="), "the way out is an action here, by its row's name: {}", theirs.said);
    assert_eq!(lacking(&theirs.said), Vec::<String>::new(), "{}", theirs.said);
    let typing = g.app.act("screen.open name=board", agent());
    assert!(!typing.ok && typing.said.contains("comment body="), "{}", typing.said);
    assert_eq!(lacking(&typing.said), Vec::<String>::new(), "{}", typing.said);
    let focus = g.app.act("tile.focus tile=tree", agent());
    assert!(!focus.ok && actions_named(&focus.said).contains(&"comment".to_string()) && lacking(&focus.said).is_empty(), "{}", focus.said);
}
