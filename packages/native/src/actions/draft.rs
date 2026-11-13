//! Writing a block: its Blockdown source, edited in place where the reader shows it, saved at the revision read.
//!
//! - **Capture comes first.** What is typed is kept as it is typed (`draft::Recovery`); a save never ends editing
//!   and never waits on a reference resolving; a refusal keeps the text in front of the person with why; and nothing
//!   drops unsaved text but closing with `discard=true`, asked for by name.
//! - **The draft is held on the service while it is open** (`drafts.hold`, renewed by `App::beat`), so an agent's
//!   `draft.patch` on the note comes here and lands in the text in front of the person. This file is the holder's
//!   side: it answers what the service asks of a held draft (`asked`). Where a patch goes, and whether it may, is
//!   the service's (see `crate::draft`).
//! - **Completions are the service's too** (`completion.rows`, asked with the text and the caret): the list is its
//!   rows as it merged them, and a choice writes the row's own `insert` over the token it found.
//! - **The editor is the person's**: every action that opens, types in, saves or closes a draft says so on its row,
//!   and the dispatcher refuses an agent. An agent's way into a draft is `draft.patch`.
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{About, Action, Actor, App, Field, Notice, Outcome, Then, Tone, nav};
use crate::actline::Args;
use crate::draft::{self, DraftSession, Hold, Writes};
use crate::keys::{self, Text};
use crate::layout::{Id, Op, Request};
use crate::store::{OutlineAt, Reply};

/// Whose the editor is, for every row that is the person's own.
const THEIRS: &str = "the editor is the person's: an agent doesn't open, type in, save or close it · draft.patch changes its text, in front of the person and never in the block they are typing in";

static EDIT: ActionRow = ActionRow::new("edit", Touches::Draft, "open the note for editing: its text where the reader shows it, at the revision the service has now, held on the service while it is open so an agent's patch lands in it")
    .person(THEIRS)
    .keys(&[KeyRow::keys("mod+e", "edit the open note")])
    .menu(&[MenuRow::new("Edit", "Note", Some("mod+e"))]);

static SAVE: ActionRow = ActionRow::new("edit.save", Touches::Draft, "save the draft. A block's text is checked against the revision it started from, and saving never ends editing: what the service holds is then what was sent, and the editor goes on. A comment or a reply is sent, and its draft is done")
    .person(THEIRS)
    .keys(&[KeyRow::keys("mod+s", "save"), KeyRow::on("mod+enter", "draft", "save, from the note's source")])
    .menu(&[MenuRow::new("Save", "Note", Some("mod+s"))]);

static CLOSE: ActionRow = ActionRow::new("edit.close", Touches::Draft, "close the edit; unsaved changes need discard=true, and stay in the editor until then")
    .person(THEIRS)
    .args(&[("discard", ArgSpec::flag("close even with unsaved changes").optional())])
    .keys(&[KeyRow::on("escape", "draft", "leave the editor, when everything is saved")])
    .menu(&[
        MenuRow::new("Done", "Note", Some("escape")),
        MenuRow::with("Discard", "Note", Some(""), &[("discard", Scalar::Flag(true))]),
    ])
    .examples(&[Example { act: "edit.close discard=true", does: "leaves the editor and drops what it holds unsaved", safe: None }]);

static PASTE: ActionRow = ActionRow::new("draft.paste", Touches::Draft, "put text in at the caret of the open edit as it came, as a paste does (over the selection, if any; one step of the editor's undo, however much): text= says the words, and left out they are the clipboard's. Line ends are made plain on the way in (a carriage return is a newline); what completes it is offered as when it is typed")
    .person(THEIRS)
    .args(&[("text", ArgSpec::text("the text, as it is to stand (left out: what the clipboard holds)").optional())])
    .keys(&[KeyRow::on("mod+v", "draft", "paste the clipboard"), KeyRow::via("a paste into the block being written")])
    .examples(&[Example { act: "draft.paste text=\"See [[se\"", does: "writes that at the caret, and offers the pages that match", safe: None }]);

static INDENT: ActionRow = ActionRow::new("draft.indent", Touches::Draft, "indent the caret's line, or every line the selection touches, one level: a list item goes under the item above it, anything else two spaces (one tab where the line is indented with tabs). One step of the editor's undo")
    .person(THEIRS)
    .keys(&[KeyRow::on("tab", "draft", "indent the line, or the selected lines")]);

static OUTDENT: ActionRow = ActionRow::new("draft.outdent", Touches::Draft, "outdent the caret's line, or every line the selection touches, one level: a list item back to its parent's level, anything else two spaces or a tab. One step of the editor's undo")
    .person(THEIRS)
    .keys(&[KeyRow::on("shift+tab", "draft", "outdent the line, or the selected lines")]);

static PATCH: ActionRow = ActionRow::new("draft.patch", Touches::Nothing, "change a passage of the note a reader shows, through the service: in the draft a window holds of it (in front of whoever writes there, never in the block they are typing in), else in the saved note. Checked against the revision read; refused with why, and nothing changes")
    .args(&[
        ("observed", ArgSpec::text("the passage as it reads now")),
        ("replacement", ArgSpec::text("what it becomes")),
        ("start", ArgSpec::number("where the passage starts in the note's text (UTF-16), when it is there more than once").optional()),
    ])
    .keys(&[KeyRow::via("an agent, over the control socket")])
    .examples(&[Example { act: "draft.patch observed=\"beans  go\" replacement=\"beans go\"", does: "tidies that passage where the note is being written, or as saved", safe: None }]);

static ACCEPT: ActionRow = ActionRow::new("complete.accept", Touches::Draft, "write the lit row of the open completion list, or row n= (from 1), over what is being typed")
    .person(THEIRS)
    .args(&[("n", ArgSpec::number("the row, from 1").optional())])
    .keys(&[KeyRow::on("tab", "complete", "write the lit row"), KeyRow::via("a press on a row of the list")]);

static ENTER: ActionRow = ActionRow::new("complete.enter", Touches::Draft, "Return while the completion list is open: the lit row is written, unless it says Return is still the field's (nothing chosen yet), when a line is typed")
    .person(THEIRS)
    .keys(&[KeyRow::on("enter", "complete", "write the lit row, or a line when the row says so")]);

static MOVE: ActionRow = ActionRow::new("complete.move", Touches::Draft, "light another row of the open completion list: by= rows, negative up, round again")
    .person(THEIRS)
    .args(&[("by", ArgSpec::number("how many rows down; negative is up"))])
    .keys(&[
        KeyRow::with("down", Some("complete"), "the next row", &[("by", Scalar::Whole(1))]),
        KeyRow::with("up", Some("complete"), "the row before", &[("by", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "complete.move by=1", does: "lights the next row", safe: Some(true) }]);

static DISMISS: ActionRow = ActionRow::new("complete.dismiss", Touches::Draft, "close the open completion list, leaving what's typed as it is: it opens again when more is typed")
    .person(THEIRS)
    .keys(&[KeyRow::on("escape", "said", "put the list away")]);

pub static ACTIONS: &[Action] = &[
    Action { row: &EDIT, run: edit, about: About::Notes },
    Action { row: &SAVE, run: save, about: About::Drafts },
    Action { row: &CLOSE, run: close, about: About::Drafts },
    Action { row: &PASTE, run: paste, about: About::Drafts },
    Action { row: &INDENT, run: indent, about: About::Drafts },
    Action { row: &OUTDENT, run: outdent, about: About::Drafts },
    Action { row: &PATCH, run: patch, about: About::Notes },
    Action { row: &ACCEPT, run: accept, about: About::Drafts },
    Action { row: &ENTER, run: enter, about: About::Drafts },
    Action { row: &MOVE, run: step, about: About::Drafts },
    Action { row: &DISMISS, run: dismiss, about: About::Drafts },
];

/// A field that takes the keyboard when it appears, the caret at its end.
pub(super) fn focused(text: &str) -> Text { Text::focused(text) }

/// A request nobody waits on the answer of.
fn unheard(_: &mut App, _: Reply) {}

impl App {
    /// A draft opens on `tile`, for the person: the editor holds `text` as the service has it at `revision`, the
    /// service is asked to hold it, and the tile is given the keys by the layout (the caret is where
    /// `Layout.focus` is, never beside it).
    pub(super) fn begin(&mut self, tile: Id, note: String, revision: u64, text: String, by: &Actor) {
        self.seat(DraftSession::new(tile, note, revision, text.clone(), focused(&text)), by);
    }

    /// A session takes its place: among the drafts, held on the service, its tile with the keys.
    fn seat(&mut self, session: DraftSession, by: &Actor) {
        let (tile, note, block) = (session.tile.clone(), session.note.clone(), session.is_block());
        self.st.drafts.push(session);
        // Only a block's own text is held on the service: a comment or a reply being written is nobody's to patch.
        if block { self.hold(&note) }
        if self.layout.focus != tile { self.reshape(&Op::Focus { tile, quiet: false }, by); }
    }

    /// The service is asked to hold the draft of `note`: patches to the note come here while it does.
    fn hold(&mut self, note: &str) {
        let Some(draft) = self.st.drafts.iter_mut().find(|draft| draft.note == note && draft.is_block()) else { return };
        if !self.st.online || self.st.at.outline.is_empty() { draft.hold = Hold::None; return }
        draft.hold = Hold::Asked;
        let request = json!({ "blockId": note, "clientId": self.store.client(), "revision": draft.revision, "leaseMs": draft::LEASE.as_millis() as u64 });
        let at = self.at.clone();
        self.store.holding(&at, note);
        self.store.request(&at, "drafts.hold", request, &Actor::Person, held, json!({ "note": note }));
    }

    /// Every draft's hold is let go and its words kept: the window leaves their outline, and nobody is in front of
    /// them now. Held again when it comes back (`hold_all`).
    pub(super) fn unhold_all(&mut self) {
        let at = self.at.clone();
        for index in 0..self.drafts.len() {
            // (Only a block's own text is held: a comment or a reply being written holds nothing to let go.)
            if !self.drafts[index].is_block() { continue }
            let note = self.drafts[index].note.clone();
            if let Some(id) = self.drafts[index].hold_id().map(str::to_string) { self.store.request(&at, "drafts.release", json!({ "holdId": id }), &Actor::Person, unheard, Value::Null) }
            self.store.let_go(&at, &note);
            self.st.drafts[index].hold = Hold::None;
        }
    }

    /// Every draft is held again: the link was made, or made again, and the holds ended with the old one.
    pub(super) fn hold_all(&mut self) {
        let notes: Vec<String> = self.drafts.iter().filter(|draft| draft.is_block()).map(|draft| draft.note.clone()).collect();
        for note in notes { self.hold(&note) }
    }

    /// The service is told the revision a held draft stands on now (a save, a patch the saved note also took).
    fn revise(&mut self, note: &str) {
        let Some((id, revision)) = self.draft_of(note).and_then(|draft| draft.hold_id().map(|id| (id.to_string(), draft.revision))) else { return };
        let at = self.at.clone();
        self.store.request(&at, "drafts.heartbeat", json!({ "holdId": id, "revision": revision }), &Actor::Person, renewed, json!({ "note": note }));
    }

    /// What time asks of the drafts held: a hold renewed before its lease runs out, one the service never granted
    /// asked for again, and the service told the person typed once the keys are quiet (it reads the draft back, and
    /// runs a request line written there). How long until this wants asking again; None with nothing held.
    pub fn beat(&mut self) -> Option<Duration> {
        if self.drafts.is_empty() || !self.online { return None }
        let (now, at) = (Instant::now(), self.at.clone());
        let mut soon = false;
        for index in 0..self.drafts.len() {
            if !self.drafts[index].is_block() { continue }
            let (note, hold, revision) = (self.drafts[index].note.clone(), self.drafts[index].hold.clone(), self.drafts[index].revision);
            match hold {
                Hold::None => self.hold(&note),
                Hold::Held { id, renewed: last } if now.duration_since(last) >= draft::BEAT => {
                    self.st.drafts[index].hold = Hold::Held { id: id.clone(), renewed: now };
                    self.store.request(&at, "drafts.heartbeat", json!({ "holdId": id, "revision": revision }), &Actor::Person, renewed, json!({ "note": note }));
                }
                _ => {}
            }
            let draft = &mut self.st.drafts[index];
            if let Some(typed) = draft.touched {
                match (now.duration_since(typed) >= draft::QUIET, draft.hold_id().map(str::to_string)) {
                    (true, Some(id)) => { draft.touched = None; self.store.request(&at, "drafts.touch", json!({ "holdId": id }), &Actor::Person, unheard, Value::Null) }
                    (true, None) => draft.touched = None,
                    (false, _) => soon = true,
                }
            }
        }
        Some(if soon { draft::QUIET / 2 } else { draft::BEAT })
    }

    /// A tile's draft was typed in (the kit's editor, a paste, a choice from the list): what a patch lit is lit no
    /// longer, the service is told once the keys are quiet, and the text is kept where a window that ends finds it.
    pub(super) fn wrote_in(&mut self, tile: &str) {
        if let Some(draft) = self.st.drafts.iter_mut().find(|draft| draft.tile == tile) {
            draft.changed();
            draft.touched = Some(Instant::now());
        }
        self.remember();
    }

    /// What is being written and not saved, kept in the file beside the arrangement's.
    pub(super) fn remember(&self) {
        let Some(recovery) = &self.recovery else { return };
        let drafts: Vec<(String, &DraftSession)> = self.drafts.iter().map(|draft| (self.layout.name(&draft.tile), draft)).collect();
        recovery.keep(&drafts);
    }

    /// What a window left unsaved comes back, each in its block: in the tile it was written in when that still reads
    /// notes, else wherever the layout lands an open of its note. Once the service has listed the screens, so the
    /// arrangement is there to put it in.
    pub(super) fn recover(&mut self) {
        if self.recovered.is_empty() || self.screen.is_nowhere() || self.kinds().is_empty() { return }
        let mut back = 0;
        for kept in std::mem::take(&mut self.st.recovered) {
            if kept.writes == Writes::Block && self.draft_of(&kept.note).is_some() { continue }
            let own = self.layout.named(&kept.tile).filter(|tile| self.reads_notes(tile) && self.draft_on(tile).is_none());
            let tile = match own {
                Some(tile) => { if self.note_of(&tile).as_deref() != Some(kept.note.as_str()) { self.show(&tile, &kept.note, true) } Some(tile) }
                None => nav::land(self, Request { from: self.layout.focus.clone(), note: kept.note.clone(), default: true, ..Request::default() }, &Actor::Person, true).answer["tile"].as_str().and_then(|name| self.layout.named(name)),
            };
            // Nothing takes it yet (no reader in this arrangement): it waits, in the file and here, for one that does.
            let Some(tile) = tile else { self.st.recovered.push(kept); continue };
            let mut buf = focused(&kept.text);
            buf.select(kept.caret, kept.caret);
            self.seat(DraftSession::new(tile, kept.note, kept.revision, kept.base, buf).writing(kept.writes).sending(kept.send), &Actor::Person);
            back += 1;
        }
        // What another window's file held is in this one's hands now: that file is done with.
        if self.recovered.is_empty() { for stray in std::mem::take(&mut self.strays) { let _ = std::fs::remove_file(stray); } }
        if back > 0 {
            let save = keys::cap("edit.save").map_or(String::new(), |cap| format!(" {cap} saves it."));
            self.st.notice = Some(Notice::info(format!("{} is back in its block: the window closed before it was saved.{save}", if back == 1 { "What you were writing".to_string() } else { format!("What you were writing in {back} notes") })));
            self.keep();
        }
    }

    /// Something else than a block's own text opens to be written on `tile`, for the person (a comment on `note`, a
    /// reply in one of its threads): the same session, field and file as a block's, with nothing held on the service.
    pub(super) fn compose(&mut self, tile: Id, note: String, revision: u64, writes: Writes, by: &Actor) {
        self.seat(DraftSession::new(tile, note, revision, String::new(), focused("")).writing(writes), by);
    }

    /// A draft ends: its hold is let go, and the file that kept it keeps it no longer.
    pub(super) fn end(&mut self, tile: &str) {
        let Some(index) = self.drafts.iter().position(|draft| draft.tile == tile) else { return };
        let draft = self.st.drafts.remove(index);
        let at = self.at.clone();
        if let Some(id) = draft.hold_id() { self.store.request(&at, "drafts.release", json!({ "holdId": id }), &Actor::Person, unheard, Value::Null) }
        if draft.is_block() { self.store.let_go(&at, &draft.note) }
        self.remember();
    }

    /// The arrangement changed: a draft with nothing unsaved ends with its tile. (One that holds unsaved text never
    /// loses its tile: the layout refuses that. Should it all the same, it stays in the file that keeps it.)
    pub(super) fn end_gone(&mut self, here: &[Id]) {
        let gone: Vec<Id> = self.drafts.iter().filter(|draft| !here.contains(&draft.tile) && !draft.unsaved()).map(|draft| draft.tile.clone()).collect();
        for tile in gone { self.end(&tile) }
    }

    /// A headless render lands what the host says until the answer to a write that goes through this window is in:
    /// the service asks about the draft held here before it answers.
    pub(super) fn settled_for(&mut self, then: Then) {
        let until = Instant::now() + Duration::from_secs(5);
        while self.store.out_for(then) && Instant::now() < until { if !self.take() { std::thread::sleep(Duration::from_millis(5)) } }
    }
}

/// The service granted the hold, or said why not.
fn held(app: &mut App, reply: Reply) {
    let note = reply.ctx["note"].as_str().unwrap_or("").to_string();
    let granted = reply.result.as_ref().ok().and_then(|result| result["holdId"].as_str()).map(str::to_string);
    let at = app.at.clone();
    match (app.st.drafts.iter_mut().find(|draft| draft.note == note && draft.is_block()), granted) {
        (Some(draft), Some(id)) => draft.hold = Hold::Held { id, renewed: Instant::now() },
        (Some(draft), None) => draft.hold = Hold::Refused(reply.result.err().map_or_else(|| "the service gave no hold".to_string(), |refusal| refusal.error)),
        // The draft closed while the hold was on its way: it is let go as soon as it is granted.
        (None, Some(id)) => app.store.request(&at, "drafts.release", json!({ "holdId": id }), &Actor::Person, unheard, Value::Null),
        (None, None) => {}
    }
}

/// A hold renewed; one that lapsed (the service was away, the lease ran out) is asked for again at the next beat.
fn renewed(app: &mut App, reply: Reply) {
    if reply.result.is_ok() { return }
    let note = reply.ctx["note"].as_str().unwrap_or("");
    if let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.note == note && draft.is_block()) { draft.hold = Hold::None }
}

/// Why a patch is turned away while an input method is open in the draft: its marked text is the person's, not yet typed.
const COMPOSING: &str = "the person is composing a character there (an input method is open); try again once it is typed";

/// What this window says when asked to place a patch: it finds no passage itself, and hands the service its draft.
const PLACES_NONE: &str = "this window places no patch itself: the service places it in the draft it holds";

/// The service asks about a draft held here (outline-core's `DraftHolderRequest`): the draft as it is (`read`); a
/// patch or a patch taken back, which this window answers with the draft as it stands for the service to place
/// in; and the spans the service placed (`place`), taken under the caret when the text is still the one they were
/// found in. What an agent did is said on the tile and on the status line.
pub(super) fn asked(app: &mut App, at: &OutlineAt, ask: &Value, by: Option<Actor>) {
    let Some(request) = ask["requestId"].as_str() else { return };
    let (kind, note) = (ask["kind"].as_str().unwrap_or(""), ask["blockId"].as_str().unwrap_or("").to_string());
    let saving = app.saving();
    let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.note == note && draft.is_block()) else {
        app.store.held(at, request, Err("this window holds no draft of that note any more".into()));
        return;
    };
    let before = draft.revision;
    let mut told = None;
    let answer = match kind {
        "read" => Ok(draft.read()),
        // Replacing text under an open composition would drop what the input method holds: the patch waits its turn.
        "patch" | "place" if draft.buf.composing() => Ok(json!({ "applied": false, "reason": COMPOSING })),
        "patch" => Ok(json!({ "applied": false, "reason": PLACES_NONE, "draft": draft.stands(saving) })),
        "revert" => Ok(json!({ "reverted": false, "draft": draft.stands(saving) })),
        "place" => match draft.land(ask, by.as_ref().map(Actor::label)) {
            Ok(said) => { told = Some(said); Ok(json!({ "applied": true })) }
            Err(draft::Unplaced::Moved) => Ok(json!({ "applied": false, "reason": "the draft was typed in since it was read", "draft": draft.stands(saving) })),
            Err(draft::Unplaced::Unreadable(why)) => Ok(json!({ "applied": false, "reason": why })),
        },
        other => Err(format!("this window answers read, patch, revert and place for a draft it holds, not {other}")),
    };
    let moved = draft.revision != before;
    app.store.held(at, request, answer);
    let Some(told) = told else { return };
    // Said where the person sees it, whoever it was: on the status line, as any agent's act is, and on the tile.
    if let Some(told) = told { app.st.agent_said = Some(told.line()) }
    if moved { app.revise(&note) }
    app.remember();
    app.pump();
}

fn edit(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("there is no reader to edit a note in") };
    let Some(page) = app.page_of(&tile) else { return Outcome::refused("the open note's page hasn't come yet") };
    if let Some(draft) = app.draft_of(&page.id) {
        return Outcome::refused(if draft.tile == tile { "the note is already open for editing".to_string() } else { format!("the note is being written in {}: tile.focus goes there", app.layout.name(&draft.tile)) });
    }
    if app.draft_on(&tile).is_some() { return Outcome::refused(format!("{} is being written in {}: save or close it first", app.layout.name(&tile), super::label("edit.close"))) }
    // A block is written in one window at a time: the service's hold is one a run, and its asks go to one holder.
    if let Some(window) = app.store.held_elsewhere(&app.at, &page.id) { return Outcome::refused(format!("the note is being written in another window ({window}): save or close it there first")) }
    let (note, revision, text) = (page.id.clone(), page.revision, page.text.clone());
    app.begin(tile, note, revision, text, by);
    Outcome::done()
}

/// The tile the act is about, when a block is being written in it.
fn written(app: &App) -> Result<Id, Outcome> { app.about().filter(|tile| app.draft_on(tile).is_some()).ok_or_else(|| Outcome::refused("no note is open for editing")) }

fn save(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    if app.saving() { return Outcome::refused("a save is already on its way") }
    let Some(draft) = app.draft_on(&tile) else { return Outcome::refused("no note is open for editing") };
    // A comment or a reply is sent as one (`review.rs`): the same key and the same button, another write.
    if !draft.is_block() { return super::review::send(app, &tile, by) }
    // What is sent is what was typed, as typed: whether a reference in it resolves is said after, never asked first.
    let (note, sent) = (draft.note.clone(), draft.buf.words().to_string());
    let request = json!({ "blockId": note, "text": sent, "expectedRevision": draft.revision });
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
    let (note, sent) = (reply.ctx["note"].as_str().unwrap_or("").to_string(), reply.ctx["sent"].as_str().unwrap_or("").to_string());
    // Saving never ends editing: what the service holds is now what was sent, and the editor goes on.
    if let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.note == note && draft.is_block()) {
        draft.revision = revision;
        draft.base = sent;
        app.st.notice = Some(Notice::info(format!("Saved · revision {revision}")));
        app.revise(&note);
        app.remember();
    }
    app.wrote(&[]);
}

/// Leaves the editor. With unsaved text it stays and says how to keep or drop it: closing never loses words.
fn close(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    if app.draft_on(&tile).is_some_and(DraftSession::unsaved) && args.flag("discard") != Some(true) {
        let save = keys::cap("edit.save").map_or(String::new(), |cap| format!("{cap} saves it; "));
        let why = format!("Unsaved text. {save}{} drops it.", super::label("edit.close discard=true"));
        app.st.notice = Some(Notice::problem(why.clone()));
        return Outcome::refused(why);
    }
    app.end(&tile);
    // What it said about the text it held is said no longer.
    if app.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem) { app.st.notice = None }
    Outcome::done()
}

impl App {
    /// Words pasted into the block being written on `tile`: at the caret, over the selection, as one step of the
    /// editor's undo, their line ends made plain. The one way in for a paste, whoever hands the words over: the
    /// field's own paste (`keys::area`), `draft.paste` with its words, and the clipboard read for it (`App::pasted`).
    pub(super) fn paste_in(&mut self, tile: &str, words: &str) {
        let field = Field::Draft(tile.to_string());
        self.field(&field).insert(&draft::plain_ends(words));
        self.typed(&field);
    }
}

/// Text put in at the caret, as a paste: the words the act says, else the clipboard's, read where the window's
/// hands are on the next frame (`keys::effects`) and handed back to `App::pasted`.
fn paste(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    match args.text("text") {
        Some(text) => { let text = text.to_string(); app.paste_in(&tile, &text) }
        None => app.st.pasting = Some(tile),
    }
    Outcome::done()
}

/// The caret's line, or every line the selection touches, a level in or out: the rule's edits (`draft::indent`,
/// outline-core's by contract) as one step of the field's way back, the caret and the selection kept on their text.
fn level(app: &mut App, out: bool) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.tile == tile) else { return Outcome::refused("no note is open for editing") };
    let (anchor, caret) = draft.buf.ends();
    let did = draft::indent(draft.buf.words(), out, anchor, caret);
    let lines = did.edits.len();
    if lines > 0 {
        let edits: Vec<(usize, usize, &str)> = did.edits.iter().map(|(start, end, with)| (*start, *end, with.as_str())).collect();
        // (The selection's two ends are the same place when nothing is selected, and one answer serves both.)
        draft.buf.splice(&edits, |offset| if offset == anchor { did.anchor } else { did.caret });
        app.typed(&Field::Draft(tile));
    }
    Outcome::answer(json!({ "lines": lines }))
}

fn indent(app: &mut App, _: &Args, _: &Actor) -> Outcome { level(app, false) }
fn outdent(app: &mut App, _: &Args, _: &Actor) -> Outcome { level(app, true) }

/// A passage changed through the service, as whoever acts: the service says where it goes (the draft a window
/// holds, this one's included, or the saved note) and whether it may.
fn patch(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("there is no reader whose note to patch") };
    let Some(note) = app.note_of(&tile) else { return Outcome::refused("no note is open there") };
    // The revision it was read at: the one the draft stands on while it is being written here, else the page's.
    let Some(revision) = app.draft_of(&note).map(|draft| draft.revision).or_else(|| app.page_of(&tile).map(|page| page.revision)) else { return Outcome::refused("the note's page hasn't come yet") };
    let (observed, replacement) = (args.text("observed").unwrap_or(""), args.text("replacement").unwrap_or(""));
    let mut span = json!({ "observed": observed, "replacement": replacement });
    if let Some(start) = args.number("start") { span["range"] = json!({ "start": start, "end": start + observed.encode_utf16().count() as f64 }) }
    let at = app.at.clone();
    app.store.write_through(&at, "draft.patch", json!({ "blockId": note, "revision": revision, "patches": [span] }), by, patched, json!({ "note": note }));
    if app.blocking { app.settled_for(patched) }
    Outcome::answer(json!({ "note": note, "revision": revision, "sent": true }))
}

/// The service's word on a patch sent from here: where it went, or why it didn't.
fn patched(app: &mut App, reply: Reply) {
    match reply.result {
        // In a draft, the holder has said so already (`asked`); in the saved note, what is shown of it is read again.
        Ok(result) if result["outcome"] == "applied" => { if result["edits"].as_array().into_iter().flatten().any(|edit| edit["route"] == "saved") { app.wrote(&[]) } }
        Ok(result) => said(app, &reply.by, format!("kept as a proposal beside the note: {}", result["reason"].as_str().unwrap_or("it couldn't be placed"))),
        Err(refusal) => said(app, &reply.by, format!("not changed: {}", refusal.error)),
    }
}

/// What became of an act whose answer came later, said to whoever looks: the status line for an agent's, the notice for the person's.
fn said(app: &mut App, by: &Actor, words: String) {
    if by.is_person() { app.st.notice = Some(Notice::problem(words)) } else { app.st.agent_said = Some(format!("{} · draft.patch {words}", by.label())) }
}

// ── the completion list ─────────────────────────────────────────────────────────────────────────────────────────

/// A row of the open list written over the token it completes: the row's own `insert`, as one step of the field's
/// way back, with what the row says to select once it is in. The choice is counted where every client's are.
fn choose(app: &mut App, tile: &str, row: Option<usize>, by: &Actor) -> Outcome {
    let Some(found) = app.completing(tile).cloned() else { return Outcome::refused("no completion list is open here") };
    let Some(index) = app.drafts.iter().position(|draft| draft.tile == tile) else { return Outcome::refused("no note is open for editing") };
    let lit = row.unwrap_or(app.drafts[index].completing.lit);
    let (Some(row), Some(token)) = (found.rows.get(lit), found.token.as_ref()) else { return Outcome::refused(format!("the list has {} rows", found.rows.len())) };
    let draft = &mut app.st.drafts[index];
    let text = draft.buf.words().to_string();
    let (Some(start), Some(end)) = (draft::byte_of(&text, token.start), draft::byte_of(&text, token.end)) else { return Outcome::refused("the words moved under the list") };
    let after = start + row.insert.len();
    draft.buf.splice(&[(start, end, row.insert.as_str())], |_| after);
    if let Some(span) = row.select && let (Some(from), Some(to)) = (draft::byte_of(&row.insert, span.start), draft::byte_of(&row.insert, span.end)) { draft.buf.select(start + from, start + to) }
    app.wrote_in(tile);
    // The list is put away: it opens again when more is typed.
    app.st.drafts[index].quiet();
    app.pump();
    if let Some(key) = &found.pick_key {
        let at = app.at.clone();
        app.store.request(&at, "completion.picked", json!({ "key": key, "insert": row.pick, "outcome": "accepted", "source": row.from, "query": token.query, "row": { "id": row.id, "label": row.label, "insertion": row.insert } }), by, unheard, Value::Null);
    }
    Outcome::answer(json!({ "wrote": row.insert }))
}

fn accept(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    choose(app, &tile, args.number("n").map(|n| (n.max(1.0) as usize) - 1), by)
}

fn enter(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    let (lit, moved) = app.draft_on(&tile).map_or((0, false), |draft| (draft.completing.lit, draft.completing.moved));
    // Until a deliberate choice, Return belongs to the field for a row that says so: a line is typed.
    let fields = app.completing(&tile).is_some_and(|found| found.rows.get(lit).is_none_or(|row| row.enter.is_some() && !moved));
    if !fields { return choose(app, &tile, None, by) }
    let field = Field::Draft(tile);
    app.field(&field).insert("\n");
    app.typed(&field);
    Outcome::done()
}

fn step(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    let Some(rows) = app.completing(&tile).map(|found| found.rows.len() as i64).filter(|rows| *rows > 0) else { return Outcome::refused("no completion list is open here") };
    let by = args.number("by").unwrap_or(1.0) as i64;
    let at = app.at.clone();
    if let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.tile == tile) { draft.light((draft.completing.lit as i64 + by).rem_euclid(rows) as usize, &at) }
    // What choosing the row now lit makes is asked for.
    app.pump();
    Outcome::done()
}

fn dismiss(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    if let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.tile == tile) { draft.quiet() }
    app.pump();
    Outcome::done()
}
