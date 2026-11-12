//! Editing the open note: its whole Blockdown source in the editor, saved at the revision read. Capture comes
//! first: a save never ends editing, a refusal keeps the text in front of the person, and nothing drops unsaved
//! text but closing with `discard=true`, asked for by name.
use rune::TextEdit;
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Editing, Notice, Outcome, Tone};
use crate::actline::Args;
use crate::keys;
use crate::store::Reply;

static EDIT: ActionRow = ActionRow::new("edit", Touches::Draft, "open the note for editing: its whole text, at the revision the service has now")
    .keys(&[KeyRow::keys("mod+e", "edit the open note")])
    .menu(&[MenuRow::new("Edit", "Note", Some("mod+e"))]);

static SAVE: ActionRow = ActionRow::new("edit.save", Touches::Draft, "save the draft, checked against the revision it started from. Saving never ends editing: what the service holds is then what was sent, and the editor goes on")
    .keys(&[KeyRow::keys("mod+s", "save"), KeyRow::on("mod+enter", "draft", "save, from the note's source")])
    .menu(&[MenuRow::new("Save", "Note", Some("mod+s"))]);

static CLOSE: ActionRow = ActionRow::new("edit.close", Touches::Draft, "close the edit; unsaved changes need discard=true, and stay in the editor until then")
    .args(&[("discard", ArgSpec::flag("close even with unsaved changes").optional())])
    .keys(&[KeyRow::on("escape", "draft", "leave the editor, when everything is saved")])
    .menu(&[
        MenuRow::new("Done", "Note", Some("escape")),
        MenuRow::with("Discard", "Note", Some(""), &[("discard", Scalar::Flag(true))]),
    ])
    .examples(&[Example { act: "edit.close discard=true", does: "leaves the editor and drops what it holds unsaved", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &EDIT, run: edit }, Action { row: &SAVE, run: save }, Action { row: &CLOSE, run: close }];

/// A field that takes the keyboard when it appears, the caret at its end.
pub(super) fn focused(text: &str) -> TextEdit {
    let mut edit = TextEdit::new(text);
    edit.focused = true;
    edit
}

/// The draft session's rule, while the person is the only holder there is: the editor is theirs.
fn theirs(by: &Actor, what: &str) -> Option<Outcome> {
    (!by.is_person()).then(|| Outcome::refused(format!("the editor is the person's: an agent doesn't {what} it · note.new and the service's own writes are an agent's way")))
}

fn edit(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    if let Some(no) = theirs(by, "open") { return no }
    let Some(page) = app.page() else { return Outcome::refused("the open note's page hasn't come yet") };
    if app.editing.is_some() { return Outcome::refused("the note is already open for editing") }
    let (note, revision, text) = (page.id.clone(), page.revision, page.text.clone());
    app.st.editor = focused(&text);
    app.st.editing = Some(Editing { note, revision, base: text });
    Outcome::done()
}

fn save(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    if let Some(no) = theirs(by, "save from") { return no }
    let Some(e) = &app.editing else { return Outcome::refused("no note is open for editing") };
    if app.saving() { return Outcome::refused("a save is already on its way") }
    let (note, sent) = (e.note.clone(), app.editor.text.clone());
    let request = json!({ "blockId": note, "text": sent, "expectedRevision": e.revision });
    let at = app.at.clone();
    app.store.write(&at, "update", request, by, saved, json!({ "note": note, "sent": sent }));
    Outcome::done()
}

pub(super) fn saved(app: &mut App, reply: Reply) {
    let result = match reply.result {
        Ok(result) => result,
        // A refusal keeps what the person wrote in front of them, with what to do.
        Err(refusal) if refusal.kind == "stale-revision" || refusal.kind == "conflict" => {
            app.st.notice = Some(Notice::problem("Not saved: the note changed since you opened it. Your text is still here; copy it, discard to see the new note, then edit again."));
            return;
        }
        Err(refusal) => { app.st.notice = Some(Notice::problem(refusal.error)); return }
    };
    let revision = result["revision"].as_u64().unwrap_or(0);
    let (note, sent) = (reply.ctx["note"].as_str().unwrap_or(""), reply.ctx["sent"].as_str().unwrap_or("").to_string());
    // Saving never ends editing: what the service holds is now what was sent, and the editor goes on.
    if let Some(e) = app.st.editing.as_mut().filter(|e| e.note == note) {
        e.revision = revision;
        e.base = sent;
        app.st.notice = Some(Notice::info(format!("Saved · revision {revision}")));
    }
    app.wrote(&[]);
}

/// Leaves the editor. With unsaved text it stays and says how to keep or drop it: closing never loses words.
fn close(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    if let Some(no) = theirs(by, "close") { return no }
    if app.editing.is_none() { return Outcome::refused("no note is open for editing") }
    if app.unsaved() && args.flag("discard") != Some(true) {
        let save = keys::cap("edit.save").map_or(String::new(), |cap| format!("{cap} saves it; "));
        let why = format!("Unsaved text. {save}{} drops it.", super::label("edit.close discard=true"));
        app.st.notice = Some(Notice::problem(why.clone()));
        return Outcome::refused(why);
    }
    app.st.editing = None;
    // What it said about the text it held is said no longer.
    if app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem) { app.st.notice = None }
    Outcome::done()
}
