//! The editor's keys: what Return, a line key, a bracket, a selection key and an erase do to the block being written.
//!
//! - **Every rule is asked of `crate::edit`**, outline-core's by contract (the door's `Draft` asks the same
//!   functions): this file finds the draft, asks, and puts the answer in the field as one step of its way back
//!   (`App::put`). Nothing here decides how a list goes on or which lines a key takes.
//! - **Each is an action with its key rows**, so the key table, the keys screen, the hint row and `act` say it
//!   without anybody writing it again; a label in the bar is its menu row.
//! - **What the field's own editor does better stays its own**: a motion by word and a word erased need the field's
//!   layout and its word breaks, an undo its history. Their rows list the editor's chord and never bind it
//!   (`KeyRow::field`); run as an act, the action hands the editor the key (`keys::Sent`) or calls its undo.
//! - **A character is asked before it is typed** (`App::types`, from the field's adapter): it may wrap a selection,
//!   bring or step over a closing bracket, or take an empty item's marker's place; and a pause, or a word and its
//!   space, ends a step of the field's way back, so an undo takes back a word and not everything typed since the
//!   caret last moved.
//! - **The editor is the person's**: every row says so, and the dispatcher refuses an agent.
use std::time::{Duration, Instant};

use serde_json::json;

use super::draft::{THEIRS, written};
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{About, Action, Actor, App, Field, Outcome};
use crate::actline::Args;
use crate::edit::{self, Change};
use crate::keys::Sent;

/// How long the keys are quiet before the next character starts a step of its own in the field's way back (the
/// door's `Draft`: 1,200 ms).
const PAUSE: Duration = Duration::from_millis(1200);

const fn text(value: &'static str) -> Scalar { Scalar::Text(value) }

static NEWLINE: ActionRow = ActionRow::new("draft.newline", Touches::Draft, "a line break at the caret (a selection goes first). On a list item the words after the caret go to a new item: the same indent, the next marker (the same bullet, or the next number) and a fresh box when the item had one; on an empty item it goes up to its parent's level, and at the top level the marker goes and the list ends. Any other line keeps its indent. plain=true is just the break. One step of the editor's undo")
    .person(THEIRS)
    .args(&[("plain", ArgSpec::flag("just the break: no marker, no indent").optional())])
    .keys(&[
        KeyRow::on("enter", "draft", "a new line; a list goes on, and ends on an empty item").quiet(),
        KeyRow::with("shift+enter", Some("draft"), "a plain line break: no marker, no indent", &[("plain", Scalar::Flag(true))]).quiet(),
        KeyRow::with("alt+enter", Some("draft"), "a plain line break, the same", &[("plain", Scalar::Flag(true))]).quiet(),
    ])
    .examples(&[Example { act: "draft.newline plain=true", does: "breaks the line with no list marker or indent carried over", safe: None }]);

const GOES: &[&str] = &["line-start", "line-end", "doc-start", "doc-end", "word-back", "word-forward"];

static GO: ActionRow = ActionRow::new("draft.go", Touches::Draft, "move the caret in the block being written: to its line's start or end (the line as written, however it wraps), the text's start or end, or a word back or forward; extend=true selects from where it was. A motion by word is the field's own: the act hands it the key")
    .person(THEIRS)
    .args(&[("to", ArgSpec::text("where to").choices(GOES)), ("extend", ArgSpec::flag("select from the caret to there").optional())])
    .keys(&[
        KeyRow::with("home", Some("draft"), "to the line's start", &[("to", text("line-start"))]).quiet(),
        KeyRow::with("end", Some("draft"), "to the line's end", &[("to", text("line-end"))]).quiet(),
        KeyRow::with("shift+home", Some("draft"), "select to the line's start", &[("extend", Scalar::Flag(true)), ("to", text("line-start"))]).quiet(),
        KeyRow::with("shift+end", Some("draft"), "select to the line's end", &[("extend", Scalar::Flag(true)), ("to", text("line-end"))]).quiet(),
        KeyRow::with("mod+up", Some("draft"), "to the start of the text", &[("to", text("doc-start"))]).quiet(),
        KeyRow::with("mod+down", Some("draft"), "to the end of the text", &[("to", text("doc-end"))]).quiet(),
        KeyRow::with("mod+shift+up", Some("draft"), "select to the start of the text", &[("extend", Scalar::Flag(true)), ("to", text("doc-start"))]).quiet(),
        KeyRow::with("mod+shift+down", Some("draft"), "select to the end of the text", &[("extend", Scalar::Flag(true)), ("to", text("doc-end"))]).quiet(),
        KeyRow::field("word+left", "draft", "back a word", &[("to", text("word-back"))]).quiet(),
        KeyRow::field("word+right", "draft", "forward a word", &[("to", text("word-forward"))]).quiet(),
        KeyRow::field("word+shift+left", "draft", "select back a word", &[("extend", Scalar::Flag(true)), ("to", text("word-back"))]).quiet(),
        KeyRow::field("word+shift+right", "draft", "select forward a word", &[("extend", Scalar::Flag(true)), ("to", text("word-forward"))]).quiet(),
        KeyRow::field("line+left", "draft", "to the start of the row as drawn (the field's own: a wrapped line has several)", &[("to", text("line-start"))]).quiet(),
        KeyRow::field("line+right", "draft", "to the end of the row as drawn", &[("to", text("line-end"))]).quiet(),
    ])
    .examples(&[Example { act: "draft.go to=line-end extend=true", does: "selects from the caret to the end of its line", safe: Some(true) }]);

static SELECT: ActionRow = ActionRow::new("draft.select", Touches::Draft, "select the word the caret is on (a run of non-blanks), its line (again: the next line too) or the whole text of the block being written")
    .person(THEIRS)
    .args(&[("what", ArgSpec::text("what to select").choices(&["word", "line", "all"]))])
    .keys(&[
        KeyRow::with("mod+shift+a", Some("draft"), "select the line; again takes in the next", &[("what", text("line"))]).quiet(),
        KeyRow::with("mod+shift+w", Some("draft"), "select the word", &[("what", text("word"))]).quiet(),
        KeyRow::field("mod+a", "draft", "select the whole text", &[("what", text("all"))]).quiet(),
        KeyRow::via("a double click selects a word, a triple click its paragraph"),
    ])
    .menu(&[MenuRow::with("Select line", "Edit", Some("mod+shift+a"), &[("what", text("line"))]), MenuRow::with("Select word", "Edit", Some("mod+shift+w"), &[("what", text("word"))])])
    .examples(&[Example { act: "draft.select what=line", does: "selects the caret's line; run again it takes in the next line", safe: Some(true) }]);

static LINE: ActionRow = ActionRow::new("draft.line", Touches::Draft, "act on the caret's line, or every whole line the selection touches: op=up or down moves them a line (the selection with them), copy-up or copy-down writes them again above or below, delete takes them out. One step of the editor's undo")
    .person(THEIRS)
    .args(&[("op", ArgSpec::text("what to do with the lines").choices(&edit::LINE_OPS))])
    .keys(&[
        KeyRow::with("alt+up", Some("draft"), "move the line up", &[("op", text("up"))]),
        KeyRow::with("alt+down", Some("draft"), "move the line down", &[("op", text("down"))]),
        KeyRow::with("alt+shift+up", Some("draft"), "copy the line above itself", &[("op", text("copy-up"))]).quiet(),
        KeyRow::with("alt+shift+down", Some("draft"), "copy the line below itself", &[("op", text("copy-down"))]).quiet(),
        KeyRow::with("mod+shift+k", Some("draft"), "delete the line", &[("op", text("delete"))]).quiet(),
    ])
    .menu(&[
        MenuRow::with("Move line up", "Edit", Some("alt+up"), &[("op", text("up"))]),
        MenuRow::with("Move line down", "Edit", Some("alt+down"), &[("op", text("down"))]),
        MenuRow::with("Copy line down", "Edit", Some("alt+shift+down"), &[("op", text("copy-down"))]),
        MenuRow::with("Delete line", "Edit", Some("mod+shift+k"), &[("op", text("delete"))]),
    ])
    .examples(&[Example { act: "draft.line op=up", does: "moves the caret's line, or the selected lines, up one line", safe: None }]);

static ERASE: ActionRow = ActionRow::new("draft.erase", Touches::Draft, "erase the selection in the block being written; with none, from the caret to its line's start or end, or the word before or after it (a word is the field's own: the act hands it the key). One step of the editor's undo")
    .person(THEIRS)
    .args(&[("to", ArgSpec::text("how far").choices(&["word-back", "word-forward", "line-start", "line-end"]))])
    .keys(&[
        KeyRow::with("ctrl+u", Some("draft"), "erase to the line's start", &[("to", text("line-start"))]).quiet(),
        KeyRow::with("line+delete", Some("draft"), "erase to the line's end", &[("to", text("line-end"))]).quiet(),
        KeyRow::field("line+backspace", "draft", "erase to the line's start", &[("to", text("line-start"))]).quiet(),
        KeyRow::field("word+backspace", "draft", "erase the word before the caret", &[("to", text("word-back"))]).quiet(),
        KeyRow::field("word+delete", "draft", "erase the word after the caret", &[("to", text("word-forward"))]).quiet(),
    ])
    .examples(&[Example { act: "draft.erase to=line-end", does: "erases from the caret to the end of its line", safe: None }]);

static WRAP: ActionRow = ActionRow::new("draft.wrap", Touches::Draft, "wrap the selected text of the block being written: with=[[ makes [[text]], with=** makes **text**, the text left selected so the same again wraps again. Typing ( [ { \" ' ` * _ ~ over a selection does it a key at a time. One step of the editor's undo")
    .person(THEIRS)
    .args(&[("with", ArgSpec::text("what opens it; the closer is its mirror"))])
    .keys(&[KeyRow::via("( [ { \" ' ` * _ ~ typed over a selection"), KeyRow::via("( [ { typed with nothing selected bring their closer, and the closer typed there is typed over")])
    .examples(&[Example { act: "draft.wrap with=[[", does: "turns the selected text into a [[page]] link", safe: None }]);

static CHECK: ActionRow = ActionRow::new("draft.check", Touches::Draft, "a checklist's box on the caret's line, or on every line the selection touches: an open step is done, a step in any other state is open again, a list item with no box gets an open one, and any other line becomes an item with one. One step of the editor's undo")
    .person(THEIRS)
    .keys(&[KeyRow::on("mod+shift+u", "draft", "tick the step, or make the line one")])
    .menu(&[MenuRow::new("Tick or untick the step", "Edit", Some("mod+shift+u"))]);

static UNDO: ActionRow = ActionRow::new("draft.undo", Touches::Draft, "take back the last step in the block being written: a word and its space, what was typed before a pause, a paste, a line key, a wrap, somebody else's patch. The field's own way back")
    .person(THEIRS)
    .keys(&[KeyRow::field("mod+z", "draft", "undo", &[])]);

static REDO: ActionRow = ActionRow::new("draft.redo", Touches::Draft, "put back the step an undo took, in the block being written")
    .person(THEIRS)
    .keys(&[KeyRow::field("mod+shift+z", "draft", "redo", &[]).quiet()]);

static COPY: ActionRow = ActionRow::new("draft.copy", Touches::Draft, "copy the selected text of the block being written to the clipboard")
    .person(THEIRS)
    .keys(&[KeyRow::field("mod+c", "draft", "copy", &[]).when("selection")]);

static CUT: ActionRow = ActionRow::new("draft.cut", Touches::Draft, "cut the selected text of the block being written to the clipboard. One step of the editor's undo")
    .person(THEIRS)
    .keys(&[KeyRow::field("mod+x", "draft", "cut", &[]).when("selection")]);

pub static ACTIONS: &[Action] = &[
    Action { row: &NEWLINE, run: newline, about: About::Drafts },
    Action { row: &GO, run: go, about: About::Drafts },
    Action { row: &SELECT, run: select, about: About::Drafts },
    Action { row: &LINE, run: line, about: About::Drafts },
    Action { row: &ERASE, run: erase, about: About::Drafts },
    Action { row: &WRAP, run: wrap, about: About::Drafts },
    Action { row: &CHECK, run: check, about: About::Drafts },
    Action { row: &UNDO, run: undo, about: About::Drafts },
    Action { row: &REDO, run: redo, about: About::Drafts },
    Action { row: &COPY, run: copy, about: About::Drafts },
    Action { row: &CUT, run: cut, about: About::Drafts },
];

/// Why a key's change waits while an input method is open in the draft: replacing text under it drops what it holds.
const COMPOSING: &str = "an input method is composing a character there: finish it, then try again";

impl App {
    /// What an editor's rule made of the draft on `tile`, put in its field: the one span between the two texts as
    /// one step of the field's way back, the selection's two ends where the rule says. True when anything moved.
    /// The one way a key's change goes in (a paste is `paste_in`, somebody else's patch `DraftSession::land`).
    pub(super) fn put(&mut self, tile: &str, did: Change) -> bool {
        let Some(draft) = self.st.drafts.iter_mut().find(|draft| draft.tile == tile) else { return false };
        draft.filled = None;
        let Some((start, end, with)) = did.span(draft.buf.words()) else {
            let moved = draft.buf.ends() != (did.anchor, did.caret);
            draft.buf.select(did.anchor, did.caret);
            return moved;
        };
        draft.buf.put(&[(start, end, with.as_str())], did.anchor, did.caret);
        self.typed(&Field::Draft(tile.to_string()));
        true
    }

    /// The draft on `tile` as a rule reads it: its words and the selection's two ends. None: nothing is written
    /// there, or an input method has a composition open in it.
    fn reads(&self, tile: &str) -> Option<(String, usize, usize)> {
        let draft = self.draft_on(tile).filter(|draft| !draft.buf.composing())?;
        let (anchor, caret) = draft.buf.ends();
        Some((draft.buf.words().to_string(), anchor, caret))
    }

    /// Return in the block being written on `tile`: the rule's break (`edit::newline`). The draft's own Return, the
    /// list's when its lit row leaves Return to the field, and a Return the table didn't take all come here.
    pub(crate) fn break_line(&mut self, tile: &str, plain: bool) -> bool {
        let Some((text, anchor, caret)) = self.reads(tile) else { return false };
        self.put(tile, edit::newline(&text, anchor, caret, plain))
    }

    /// A character about to be typed in the block being written on `tile` (the field's adapter asks, before its
    /// editor): true when a rule took it (`edit::typed`: it wrapped the selection, brought or stepped over a
    /// closing bracket, or took an empty item's marker's place) and the editor is not to type it. Either way a
    /// step of the field's way back ends where a person would expect one to: after a pause, and after a word and
    /// its space.
    pub(crate) fn types(&mut self, tile: &str, ch: char) -> bool {
        let Some(draft) = self.st.drafts.iter_mut().find(|draft| draft.tile == tile) else { return false };
        if draft.buf.composing() { return false }
        let (now, (anchor, caret)) = (Instant::now(), draft.buf.ends());
        // A word and its space are a step: the next word starts another. So is what was typed before a pause.
        let spaced = {
            let words = draft.buf.words();
            let mut before = words[..caret.min(words.len())].chars().rev();
            !ch.is_whitespace() && before.next().is_some_and(char::is_whitespace) && before.next().is_some_and(|c| !c.is_whitespace())
        };
        if spaced || draft.typed_at.is_some_and(|at| now.duration_since(at) >= PAUSE) { draft.buf.rest() }
        draft.typed_at = Some(now);
        let filled = draft.filled == Some((anchor, caret));
        let Some(did) = edit::typed(draft.buf.words(), anchor, caret, ch, filled) else { return false };
        self.put(tile, did);
        true
    }

    /// Keys an action handed to the field's own editor, taken once (`keys::effects` sends them).
    pub fn sending(&mut self) -> Vec<Sent> { std::mem::take(&mut self.st.sending) }
}

/// The tile whose draft a key's rule is asked of, with the draft as the rule reads it.
fn read(app: &App) -> Result<(String, String, usize, usize), Outcome> {
    let tile = written(app)?;
    let (text, anchor, caret) = app.reads(&tile).ok_or_else(|| Outcome::refused(COMPOSING))?;
    Ok((tile, text, anchor, caret))
}

/// Where the caret is after, as a person counts: its line and column, from 1.
fn landed(app: &App, tile: &str) -> serde_json::Value {
    let Some(draft) = app.draft_on(tile) else { return json!({}) };
    let (text, (anchor, caret)) = (draft.buf.words(), draft.buf.ends());
    let before = &text[..caret.min(text.len())];
    json!({ "line": before.matches('\n').count() + 1, "col": before.rsplit('\n').next().map_or(0, |line| line.chars().count()) + 1, "selected": text[anchor.min(caret)..anchor.max(caret)].chars().count() })
}

fn newline(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    app.put(&tile, edit::newline(&text, anchor, caret, args.flag("plain") == Some(true)));
    Outcome::answer(landed(app, &tile))
}

fn go(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    let (to, extend) = (args.text("to").unwrap_or(""), args.flag("extend") == Some(true));
    match (to, edit::go(&text, anchor, caret, to, extend)) {
        (_, Some((anchor, caret))) => { app.put(&tile, Change { text, anchor, caret }); Outcome::answer(landed(app, &tile)) }
        // By word is the field's own (its editor has the word breaks): it is handed the key, and moves on the next frame.
        ("word-back" | "word-forward", None) => { app.st.sending.push(Sent::Word { forward: to == "word-forward", extend }); Outcome::answer(json!({ "sent": "the field's own key" })) }
        _ => Outcome::refused(format!("draft.go takes to={}, not {to}", GOES.join("|"))),
    }
}

fn select(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    let what = args.text("what").unwrap_or("");
    let Some((anchor, caret)) = edit::select(&text, anchor, caret, what) else { return Outcome::refused(format!("draft.select takes what=word|line|all, not {what}")) };
    let picked = text[anchor..caret].to_string();
    app.put(&tile, Change { text, anchor, caret });
    Outcome::answer(json!({ "text": picked }))
}

fn line(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    let op = args.text("op").unwrap_or("");
    let Some(did) = edit::line_op(&text, anchor, caret, op) else { return Outcome::refused(format!("draft.line takes op={}, not {op}", edit::LINE_OPS.join("|"))) };
    let changed = did.text != text;
    app.put(&tile, did);
    let mut answer = landed(app, &tile);
    answer["changed"] = json!(changed);
    Outcome::answer(answer)
}

fn erase(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    let to = args.text("to").unwrap_or("");
    match (to, edit::erase(&text, anchor, caret, to)) {
        (_, Some(did)) => { let erased = did.text != text; app.put(&tile, did); Outcome::answer(json!({ "erased": erased })) }
        ("word-back" | "word-forward", None) => { app.st.sending.push(Sent::EraseWord { forward: to == "word-forward" }); Outcome::answer(json!({ "sent": "the field's own key" })) }
        _ => Outcome::refused(format!("draft.erase takes to=word-back|word-forward|line-start|line-end, not {to}")),
    }
}

fn wrap(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    let Some(did) = edit::wrap(&text, anchor, caret, args.text("with").unwrap_or("")) else { return Outcome::refused(format!("nothing is selected in the block being written: select text (Shift with the arrows, a drag, {}), then wrap it", super::label("draft.select what=word"))) };
    let inner = did.text[did.anchor.min(did.caret)..did.anchor.max(did.caret)].to_string();
    app.put(&tile, did);
    Outcome::answer(json!({ "text": inner }))
}

fn check(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    let (tile, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    app.put(&tile, edit::check(&text, anchor, caret));
    Outcome::answer(landed(app, &tile))
}

/// The field's own undo or redo, run for an act: the same step the key takes.
fn back(app: &mut App, redo: bool) -> Outcome {
    let tile = match written(app) { Ok(tile) => tile, Err(no) => return no };
    let Some(draft) = app.st.drafts.iter_mut().find(|draft| draft.tile == tile) else { return Outcome::refused("no note is open for editing") };
    if draft.buf.composing() { return Outcome::refused(COMPOSING) }
    let before = draft.buf.words().to_string();
    if redo { draft.buf.redo() } else { draft.buf.undo() }
    draft.filled = None;
    let changed = draft.buf.words() != before;
    if changed { app.typed(&Field::Draft(tile)) }
    Outcome::answer(json!({ "changed": changed }))
}

fn undo(app: &mut App, _: &Args, _: &Actor) -> Outcome { back(app, false) }
fn redo(app: &mut App, _: &Args, _: &Actor) -> Outcome { back(app, true) }

/// What is selected, copied or cut: the field's own editor writes the clipboard, so it is handed the key
/// (`keys::Sent`), and a cut is one step of its way back as the key's is.
fn clip(app: &mut App, cut: bool) -> Outcome {
    let (_, text, anchor, caret) = match read(app) { Ok(read) => read, Err(no) => return no };
    if anchor == caret { return Outcome::refused("nothing is selected in the block being written") }
    app.st.sending.push(if cut { Sent::Cut } else { Sent::Copy });
    Outcome::answer(json!({ "text": text[anchor.min(caret)..anchor.max(caret)] }))
}

fn copy(app: &mut App, _: &Args, _: &Actor) -> Outcome { clip(app, false) }
fn cut(app: &mut App, _: &Args, _: &Actor) -> Outcome { clip(app, true) }
