//! About the note: a comment on it, a reply in one of its threads and a thread resolved; an edit proposed beside it
//! applied or dismissed; an earlier text of it put back. Each is the service's own write, recorded as whoever acts
//! (`annotations.batch`, `annotations.reply`, `annotations.lifecycle`, `draft.proposal.apply`,
//! `draft.proposal.dismiss`), and what the window shows of it is read again when the write answers.
//!
//! - **What is listed is the service's** (`lists.read from=threads|proposals|revisions`, tiles that follow a reader):
//!   a row's own presses carry these act lines, by the door's names for them, so a press, a key and an agent say one
//!   thing. A revision's change is opened by picking its row (`list.pick`): the row folds, like any that does.
//! - **A comment's and a reply's words are a draft** (`crate::draft`, `Writes`): the same session, field, completions
//!   and file as a block's, written where the note is read and sent by the action that saves (`edit.save`). With
//!   `body=` one is sent at once, which is an agent's way: it opens no editor.
//! - **A comment is on words by quoting them**: the reader's selection as it shows it, or `quote=`. Where those
//!   words are in the note, and whether they are there once, is the service's to find; nothing here anchors.
//! - **A revision is restored into the editor**, never over the note: its text goes into the block's draft as one
//!   step of the field's own way back, and nothing is written until the person saves.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{About, Action, Actor, App, Field, Notice, Outcome};
use crate::actline::Args;
use crate::draft::{self, Writes};
use crate::layout::Id;
use crate::store::Reply;

/// Whose a selection is, for the row that hears one.
const SELECTED: &str = "the selection in a reader is whoever reads there: a comment sent as somebody else names its words with comment quote=";
/// Whose the editor is, for the row that puts a text in it.
const EDITOR: &str = "the editor is whoever writes there: a revision's text goes into it for them to save or drop · draft.patch changes a note's text for anybody else";

static SELECT: ActionRow = ActionRow::new("passage.select", Touches::Tile, "pick the words of the open note a comment will be on: quote= the words as the reader shows them (left out: none are picked). A selection made in a reader runs this; comment then opens on those words")
    .person(SELECTED)
    .args(&[("quote", ArgSpec::text("the words, as the reader shows them").optional())])
    .keys(&[KeyRow::via("words selected in a reader, with the mouse")])
    .examples(&[Example { act: "passage.select quote=\"Before the rain.\"", does: "picks those words of the open note for a comment", safe: Some(true) }]);

/// How an agent gets the person's attention in this window: the action a refusal of the dispatcher's names as the way.
pub(super) static ATTENTION: &ActionRow = &COMMENT;

static COMMENT: ActionRow = ActionRow::new("comment", Touches::Draft, "comment on the note a reader shows: on quote= (words of it, as its text has them; near= the offset to be nearest, among repeats), else on the words selected there, else on the whole note. With body= it is sent at once, recorded as whoever acts; left out, it opens to be written where the note is read, in the editor a block has, and edit.save sends it")
    .args(&[
        ("quote", ArgSpec::text("the exact words to comment on, as the note's text has them").optional()),
        ("body", ArgSpec::text("the comment's words, sent at once; left out, they are written in the reader").optional()),
        ("near", ArgSpec::number("when the words are there more than once: the offset (UTF-16) to be nearest").optional()),
    ])
    .keys(&[KeyRow::keys("mod+shift+m", "comment on the selected words, or on the note")])
    .menu(&[MenuRow::new("Comment", "Note", Some("mod+shift+m"))])
    .examples(&[Example { act: "comment body=\"Which rain? Friday's.\" quote=\"Before the rain.\"", does: "comments on those words of the open note", safe: None }]);

static REPLY: ActionRow = ActionRow::new("reply", Touches::Draft, "reply in a comment thread of the note a reader shows: thread= its id, as the list of threads gives it. With body= it is sent at once, recorded as whoever acts; left out, it opens to be written where the note is read, and edit.save sends it")
    .args(&[("thread", ArgSpec::text("the thread's id")), ("body", ArgSpec::text("the reply's words, sent at once; left out, they are written in the reader").optional())])
    .keys(&[KeyRow::via("Reply on a thread, in the list of a note's comments")])
    .examples(&[Example { act: "reply body=\"Moved to June.\" thread=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "answers in that thread", safe: None }]);

static RESOLVE: ActionRow = ActionRow::new("resolve", Touches::Nothing, "resolve a comment thread (thread= its id): it leaves the note's open threads for the earlier ones; open=true brings it back. Recorded as whoever acts")
    .args(&[("thread", ArgSpec::text("the thread's id")), ("open", ArgSpec::flag("reopen it instead of resolving").optional())])
    .keys(&[KeyRow::via("Resolve (or Reopen) on a thread, in the list of a note's comments")])
    .examples(&[Example { act: "resolve thread=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "resolves that thread", safe: None }]);

static APPLY: ActionRow = ActionRow::new("proposal.apply", Touches::Nothing, "apply an edit proposed beside a note (id= the proposal's block id, as the list of proposals gives it), as an ordinary edit by whoever runs this: the service applies it, in the draft a window holds of the note or in the saved note, and refuses with why when its passage is gone")
    .args(&[("id", ArgSpec::text("the proposal's block id").kind("note"))])
    .keys(&[KeyRow::via("Apply on a proposal, in the list of a note's proposals")])
    .examples(&[Example { act: "proposal.apply id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "applies that proposed edit", safe: None }]);

static DISMISS: ActionRow = ActionRow::new("proposal.dismiss", Touches::Nothing, "dismiss an edit proposed beside a note without applying it (id= the proposal's block id): the service marks it dismissed and puts it in Trash, recorded as whoever runs this")
    .args(&[("id", ArgSpec::text("the proposal's block id").kind("note"))])
    .keys(&[KeyRow::via("Dismiss on a proposal, in the list of a note's proposals")])
    .examples(&[Example { act: "proposal.dismiss id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "dismisses that proposed edit", safe: None }]);

static RESTORE: ActionRow = ActionRow::new("revision.restore", Touches::Draft, "go back to an earlier text of the note a reader shows: revision= its number, as the list of revisions gives it (left out: the one before the note now). The editor opens, or the open one is used, and that text goes in as one step its own way back takes out; nothing is written until it is saved")
    .person(EDITOR)
    .args(&[
        ("revision", ArgSpec::number("the revision; left out, the one before the note now").optional()),
        ("of", ArgSpec::text("the note the revision is of (a block id), as the row of a list of revisions names it: refused when the reader shows another note").optional().kind("note")),
    ])
    .keys(&[KeyRow::via("Restore on a revision, in the list of a note's revisions")])
    .examples(&[Example { act: "revision.restore revision=2", does: "puts revision 2's text in the editor, to save or drop", safe: None }]);

pub static ACTIONS: &[Action] = &[
    Action { row: &SELECT, run: select, about: About::Notes },
    Action { row: &COMMENT, run: comment, about: About::Notes },
    Action { row: &REPLY, run: reply, about: About::Notes },
    Action { row: &RESOLVE, run: thread, about: About::Nothing },
    Action { row: &APPLY, run: accept, about: About::Nothing },
    Action { row: &DISMISS, run: decline, about: About::Nothing },
    Action { row: &RESTORE, run: restore, about: About::Notes },
];

/// How the wire names who wrote a comment (`AnnotationSource`): the store records the rest.
fn source(by: &Actor) -> &'static str { if by.is_person() { "user" } else { "agent" } }

/// What names a request between two tries of it: the send it is (`send`: a draft's own name, or a new one for
/// words sent at once) and what is sent. One draft tried again as it stands is the same request, so a comment that
/// did land writes no second one (the service keeps the first receipt and answers with it). The same words written
/// another time are another send, and so another request: a second "Agreed." in a thread is a reply of its own.
fn request_id(send: &str, parts: &[&str]) -> String { format!("native-{}", draft::version(&[&[send], parts].concat().join("\u{0}"))) }

/// The reader an act here is about, and the note it shows with the revision it was read at.
fn read(app: &App) -> Result<(Id, String, u64), Outcome> {
    let tile = app.about().ok_or_else(|| Outcome::refused("there is no reader here to comment in"))?;
    let page = app.page_of(&tile).ok_or_else(|| Outcome::refused("the open note's page hasn't come yet"))?;
    Ok((tile, page.id.clone(), page.revision))
}

/// A tile takes one thing being written: what is there says so, in a refusal that names the way out.
fn free(app: &App, tile: &str) -> Result<(), Outcome> {
    match app.draft_on(tile) {
        Some(draft) => Err(Outcome::refused(format!("{} this note is being written in {}: {} it or leave it ({}) first", draft.writes.what(), app.layout.name(tile), super::label("edit.save"), super::label("edit.close")))),
        None => Ok(()),
    }
}

fn select(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("there is no reader here to select in") };
    app.ui_mut(&tile).passage = args.text("quote").map(str::to_string).filter(|quote| !quote.trim().is_empty());
    Outcome::done()
}

fn comment(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (tile, note, revision) = match read(app) { Ok(read) => read, Err(no) => return no };
    // The words it is on: the ones named, else the ones selected in this reader, else none (the whole note).
    let quote = args.text("quote").map(str::to_string).or_else(|| app.ui(&tile).passage.clone()).filter(|quote| !quote.trim().is_empty());
    let near = args.number("near").map(|at| at.max(0.0) as usize);
    let writes = Writes::Comment { quote, near };
    if let Some(body) = args.text("body") { return post(app, None, &draft::send_name(), &note, revision, &writes, body, by) }
    // Its words are written here, by whoever is at the keys: sent as somebody else, it names them.
    if !app.stands(by) { return Outcome::refused("a comment sent over the control socket names its words: body=") }
    if let Err(no) = free(app, &tile) { return no }
    app.ui_mut(&tile).passage = None;
    app.compose(tile, note, revision, writes, by);
    Outcome::done()
}

fn reply(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let thread = args.text("thread").unwrap_or("").to_string();
    // What it answers, in the thread's own first words, when a list on screen shows the thread.
    let to = app.layout.all().iter().find_map(|tile| app.rows_of(tile).iter().find(|row| row.id == thread).map(|row| row.label.clone())).unwrap_or_default();
    let writes = Writes::Reply { thread, to };
    if let Some(body) = args.text("body") {
        // A reply names its thread, which is all the service asks: no reader has to show the note.
        let note = app.about().and_then(|tile| app.note_of(&tile)).unwrap_or_default();
        return post(app, None, &draft::send_name(), &note, 0, &writes, body, by);
    }
    if !app.stands(by) { return Outcome::refused("a reply sent over the control socket names its words: body=") }
    let (tile, note, revision) = match read(app) { Ok(read) => read, Err(no) => return no };
    if let Err(no) = free(app, &tile) { return no }
    app.compose(tile, note, revision, writes, by);
    Outcome::done()
}

/// What is being written in `tile` and is no block's own text (a comment, a reply), sent: `edit.save`'s run for one.
/// The note's revision is the one its page has now, so words written while the note moved on are still sent.
pub(super) fn send(app: &mut App, tile: &str, by: &Actor) -> Outcome {
    let Some(draft) = app.draft_on(tile) else { return Outcome::refused("nothing is being written here") };
    let (note, writes, body, name) = (draft.note.clone(), draft.writes.clone(), draft.buf.words().to_string(), draft.send.clone());
    if body.trim().is_empty() { return Outcome::refused("nothing is written yet") }
    let revision = app.page_of(tile).filter(|page| page.id == note).map_or(draft.revision, |page| page.revision);
    post(app, Some(tile), &name, &note, revision, &writes, &body, by)
}

/// One comment or reply sent to the service, as `by`. `tile`: the tile it was written in, whose draft is done once
/// it has landed; a refusal leaves every word there, with why. `send`: what names this send among all of them.
#[allow(clippy::too_many_arguments)]
fn post(app: &mut App, tile: Option<&str>, send: &str, note: &str, revision: u64, writes: &Writes, body: &str, by: &Actor) -> Outcome {
    let at = app.at.clone();
    let ctx = json!({ "tile": tile, "what": writes.kind() });
    match writes {
        Writes::Comment { quote, near } => {
            let mut input = json!({ "blockId": note, "expectedRevision": revision, "body": body, "source": source(by) });
            if let Some(quote) = quote {
                input["passage"] = json!({ "quote": quote });
                if let Some(near) = near { input["passage"]["near"] = json!(near) }
            }
            let request = json!({ "requestId": request_id(send, &[note, quote.as_deref().unwrap_or(""), body]), "operations": [{ "operationId": "1", "type": "block-comment", "input": input }] });
            app.store.write(&at, "annotations.batch", request, by, posted, ctx);
        }
        Writes::Reply { thread, .. } => {
            let request = json!({ "requestId": request_id(send, &[thread, body]), "input": { "annotationId": thread, "body": body, "source": source(by) } });
            app.store.write(&at, "annotations.reply", request, by, posted, ctx);
        }
        Writes::Block => return Outcome::refused("a block's own text is saved, not sent"),
    }
    Outcome::answer(json!({ "note": note, "sent": writes.kind() }))
}

/// The service's word on a comment or a reply: landed, its draft is done and what lists it is read again; refused,
/// what was written stays where it was written, with why.
fn posted(app: &mut App, reply: Reply) {
    let (tile, what) = (reply.ctx["tile"].as_str().map(str::to_string), reply.ctx["what"].as_str().unwrap_or("comment").to_string());
    match reply.result {
        Ok(_) => {
            // (Only its own draft ends: a block opened for editing there since is another session.)
            if let Some(tile) = tile.filter(|tile| app.draft_on(tile).is_some_and(|draft| !draft.is_block())) { app.end(&tile) }
            if reply.by.is_person() { app.st.notice = Some(Notice::info(format!("The {what} is sent."))) }
            app.wrote(&[]);
        }
        Err(refusal) => told(app, &reply.by, &format!("The {what} wasn't sent: {}", refusal.error)),
    }
}

/// What became of a write whose answer came later, said to whoever looks: the notice for the person's, the status
/// line for anybody else's.
fn told(app: &mut App, by: &Actor, words: &str) {
    if by.is_person() { app.st.notice = Some(Notice::problem(words)) } else { app.st.agent_said = Some(format!("{} · {words}", by.label())) }
}

/// A thread resolved, or brought back: its lifecycle, as the service keeps it.
fn thread(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let thread = args.text("thread").unwrap_or("");
    let lifecycle = if args.flag("open") == Some(true) { "open" } else { "resolved" };
    let at = app.at.clone();
    app.store.write(&at, "annotations.lifecycle", json!({ "input": { "annotationId": thread, "lifecycle": lifecycle } }), by, resolved, json!({ "lifecycle": lifecycle }));
    Outcome::answer(json!({ "thread": thread, "lifecycle": lifecycle }))
}

fn resolved(app: &mut App, reply: Reply) {
    match reply.result {
        Ok(_) => app.wrote(&[]),
        Err(refusal) => told(app, &reply.by, &format!("The thread is as it was: {}", refusal.error)),
    }
}

/// A proposal's fate, asked of the service as whoever acts. The service applies one in the draft a window holds of
/// the note (this one's too: it asks about that draft before it answers), so the write is never waited for with
/// the link held.
fn decide(app: &mut App, action: &'static str, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let at = app.at.clone();
    app.store.write_through(&at, action, json!({ "proposalId": id }), by, decided, json!({ "action": action }));
    if app.blocking { app.settled_for(decided) }
    Outcome::answer(json!({ "proposal": id, "sent": true }))
}

fn accept(app: &mut App, args: &Args, by: &Actor) -> Outcome { decide(app, "draft.proposal.apply", args, by) }
fn decline(app: &mut App, args: &Args, by: &Actor) -> Outcome { decide(app, "draft.proposal.dismiss", args, by) }

fn decided(app: &mut App, reply: Reply) {
    match reply.result {
        // The note it was beside, and the list that held it, are read again: the edit is in the note, or gone.
        Ok(_) => app.wrote(&[]),
        Err(refusal) => told(app, &reply.by, &format!("The proposal is as it was: {}", refusal.error)),
    }
}

fn restore(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (tile, note, now) = match read(app) { Ok(read) => read, Err(no) => return no };
    // The note a list's row is of is the row's to say (the service writes it into the press): a list that kept its
    // note while the reader moved on puts none of that note's texts into another's editor.
    if let Some(of) = args.text("of").filter(|of| *of != note) { return Outcome::refused(format!("{} shows another note ({note}), not {of}: open it there first", app.layout.name(&tile))) }
    // Something else being written there (a comment) keeps the tile; the block's own draft is what the text goes into.
    if app.draft_on(&tile).is_some_and(|draft| !draft.is_block()) && let Err(no) = free(app, &tile) { return no }
    let revision = match args.number("revision") { Some(n) if n >= 1.0 => n as u64, Some(_) => return Outcome::refused("revision= is a revision's number, from 1"), None if now > 1 => now - 1, None => return Outcome::refused("this note has no earlier text: it is at its first revision") };
    let at = app.at.clone();
    app.store.request(&at, "block.revisions", json!({ "blockId": note, "revision": revision }), by, restored, json!({ "tile": tile, "note": note, "revision": revision }));
    Outcome::answer(json!({ "note": note, "revision": revision }))
}

/// An earlier text came: it goes into the block's draft where the note is read, opened now when none is, as one
/// step of the field's own way back. The service's refusal (a revision it doesn't keep) is said as it says it.
fn restored(app: &mut App, reply: Reply) {
    let (tile, note, revision) = (reply.ctx["tile"].as_str().unwrap_or("").to_string(), reply.ctx["note"].as_str().unwrap_or("").to_string(), reply.ctx["revision"].as_u64().unwrap_or(0));
    let result = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return } };
    let Some(text) = result["text"].as_str().map(str::to_string) else { app.st.notice = Some(Notice::problem(format!("The service answered no text for revision {revision}."))); return };
    if app.draft_on(&tile).is_none() {
        // The reader moved on while the text was on its way: it is put nowhere it wasn't asked for.
        let Some((standing, saved)) = app.page_of(&tile).filter(|page| page.id == note).map(|page| (page.revision, page.text.clone())) else { app.st.notice = Some(Notice::problem(format!("Revision {revision} came for a note the reader no longer shows; nothing was changed."))); return };
        app.begin(tile.clone(), note.clone(), standing, saved, &reply.by);
    }
    if !app.draft_on(&tile).is_some_and(|draft| draft.is_block() && draft.note == note) { app.st.notice = Some(Notice::problem(format!("Revision {revision} came, and another text is being written there; nothing was changed."))); return }
    let field = Field::Draft(tile);
    app.field(&field).replace(text);
    app.typed(&field);
    // When it was saved, as the service says: the day and the minute.
    let when = result["savedAt"].as_str().map_or(String::new(), |at| format!(" (saved {})", at.chars().take(16).collect::<String>().replace('T', " ")));
    let save = crate::keys::cap("edit.save").map_or(String::new(), |cap| format!(" {cap} saves it;"));
    app.st.notice = Some(Notice::info(format!("Revision {revision}'s text{when} is in the editor.{save} {} leaves the note as it is.", super::label("edit.close discard=true"))));
}
