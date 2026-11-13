//! A draft session: something being written in a tile, held by this window until it is saved. One session type,
//! whatever it writes (`Writes`): a block's own source, a comment on a note or a reply in a thread. They share the
//! field, what completes a word, the file that keeps what is typed, and the actions that save and close.
//!
//! - **The session is the model**: the block it is about, the revision and text it stands on, what is typed
//!   (`keys::Text`, the field's own type), what it writes, its hold on the service, and what was last said about it.
//!   No Rune here: a drawer shows it.
//! - **What is typed is kept as it is typed** (`Recovery`): a file beside the arrangement's, written on every
//!   change while a draft holds unsaved text. A window that ends without saving finds it there when it starts.
//! - **The holder's side of the service's draft protocol** (`drafts.hold`, outline-core's draft-patch): while the
//!   draft is held, an agent's `draft.patch` on the note comes here. This window reads no Blockdown, so it places
//!   nothing: asked to `patch`, it answers with the draft as it stands (`stands`), the service decides where the
//!   patch goes and whether it may (the door's own rule, outline-core's `placeDraftPatch`), and hands back the
//!   spans to replace (`place`), which are taken only while the text is still the one it was placed in.
//! - **An agent's patch never takes the caret**: the spans are replaced under it, and the caret and the selection's
//!   other end move with the text (`map_cursor`, the one port of outline-core's `mapCursor`, held by
//!   `core-contract.json`).
use std::collections::HashMap;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{Value, json};

use crate::keys::Text;
use crate::layout::Id;
use crate::store::Ask;

/// How long a hold lasts unless it is renewed, and how often it is (the door's `DRAFT_LEASE_MS`, `DRAFT_HEARTBEAT_MS`).
pub const LEASE: std::time::Duration = std::time::Duration::from_secs(15);
pub const BEAT: std::time::Duration = std::time::Duration::from_secs(5);
/// How long the keys are quiet before the service is told the draft was typed in. (The door waits too, a second:
/// its `DRAFT_TOUCH_MS`. The two waits are each window's own.)
pub const QUIET: std::time::Duration = std::time::Duration::from_millis(600);

/// A draft's hold on the service: while it is held, an agent's patch on the note comes to this window.
#[derive(Clone, Debug, PartialEq)]
pub enum Hold {
    /// Not asked for yet (no link, or the link was made again).
    None,
    /// Asked for; the service hasn't said.
    Asked,
    /// Held under this id, renewed then.
    Held { id: String, renewed: Instant },
    /// The service refused it, in its words: patches go to the saved note.
    Refused(String),
}

/// What was last said about a draft, on its tile: somebody's patch, by whom (as the window names them; nobody for a
/// patch taken back) and what it did.
#[derive(Clone, Debug, PartialEq)]
pub struct Told {
    pub who: String,
    pub did: String,
}

impl Told {
    /// As one line: `an agent (tidy) edited text above your cursor`.
    pub fn line(&self) -> String { if self.who.is_empty() { self.did.clone() } else { format!("{} {}", self.who, self.did) } }
}

/// The list that completes what is being typed, as this draft holds it: the question asked (for the text and the
/// caret it was asked at), the lit row, and whether the person moved it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Completing {
    pub ask: Option<Ask>,
    /// The change of the text and the caret the question was asked for.
    pub at: (u64, usize),
    pub lit: usize,
    /// The person moved the lit row: Return is a choice, whatever the row says of it.
    pub moved: bool,
}

/// What a draft writes when it is saved.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Writes {
    /// The block's own text, checked against the revision it stands on: saving never ends the draft.
    #[default]
    Block,
    /// A comment on the block: on these words of it, as its source has them (`near`: among repeats, the ones
    /// nearest this UTF-16 offset), or on the whole of it. Sent, the draft is done.
    Comment { quote: Option<String>, near: Option<usize> },
    /// A reply in a thread on the block, by the thread's id; `to` is what it answers, in the thread's first words.
    Reply { thread: String, to: String },
}

impl Writes {
    /// What it is, before the title of the note it is about: how a tile that holds one says what it holds.
    pub fn what(&self) -> &'static str { match self { Writes::Block => "an edit of", Writes::Comment { .. } => "a comment on", Writes::Reply { .. } => "a reply on" } }

    /// What its field is called, and what the field says while it is empty.
    pub fn named(&self) -> (&'static str, &'static str) {
        match self {
            Writes::Block => ("Block source", "Title [key::value]\nThen the note, in Blockdown."),
            Writes::Comment { .. } => ("Comment", "What you think of it, in Blockdown."),
            Writes::Reply { .. } => ("Reply", "Your answer, in Blockdown."),
        }
    }

    /// What it is on, said over its field: the words a comment quotes (or the whole note), the comment a reply
    /// answers. A block's own text is on nothing but itself.
    pub fn on(&self) -> Option<String> {
        match self {
            Writes::Block => None,
            Writes::Comment { quote: Some(quote), .. } => Some(format!("On “{quote}”")),
            Writes::Comment { quote: None, .. } => Some("On the whole note".to_string()),
            Writes::Reply { to, .. } if to.is_empty() => Some("In reply".to_string()),
            Writes::Reply { to, .. } => Some(format!("In reply to “{to}”")),
        }
    }

    /// As the wire and `peek` name it.
    pub fn kind(&self) -> &'static str { match self { Writes::Block => "block", Writes::Comment { .. } => "comment", Writes::Reply { .. } => "reply" } }

    fn json(&self) -> Value {
        match self {
            Writes::Block => Value::Null,
            Writes::Comment { quote, near } => json!({ "kind": "comment", "quote": quote, "near": near }),
            Writes::Reply { thread, to } => json!({ "kind": "reply", "thread": thread, "to": to }),
        }
    }
    fn read(kept: &Value) -> Writes {
        let text = |key: &str| kept[key].as_str().map(str::to_string);
        match kept["kind"].as_str() {
            Some("comment") => Writes::Comment { quote: text("quote"), near: kept["near"].as_u64().map(|at| at as usize) },
            Some("reply") => Writes::Reply { thread: text("thread").unwrap_or_default(), to: text("to").unwrap_or_default() },
            _ => Writes::Block,
        }
    }
}

pub struct DraftSession {
    /// The tile it is written in.
    pub tile: Id,
    /// The block it is about: the one whose text it is, or the one a comment or a reply is on.
    pub note: String,
    /// What saving it writes.
    pub writes: Writes,
    /// What names it among everything this window sends (`send_name`): the request of a comment or a reply sent
    /// from it is named by this and its words, so trying again sends the same request, never a second comment.
    pub send: String,
    /// The saved revision it stands on, and the text the service holds at it: a save names that revision, and
    /// there is something unsaved exactly when what is typed differs from that text.
    pub revision: u64,
    pub base: String,
    pub buf: Text,
    pub hold: Hold,
    pub told: Option<Told>,
    /// What somebody else's last patch wrote, as ranges of the text (bytes), while the text is as that patch left it.
    pub lit: Vec<Range<usize>>,
    lit_at: u64,
    /// Counts the changes to the text, whoever made them.
    pub changes: u64,
    /// The change at which the completion list was last put away (chosen from, closed, or never opened): it opens
    /// again when the person types.
    pub quiet_at: u64,
    pub completing: Completing,
    /// The service is to be told the person typed, once the keys are quiet.
    pub touched: Option<Instant>,
    /// What the draft stood on before a patch the saved note also took, by patch: taken back, it stands there again.
    stood: HashMap<String, (u64, String)>,
}

/// A byte offset of `text` as a UTF-16 offset, as the wire counts.
pub fn utf16_of(text: &str, byte: usize) -> usize { text[..text.floor_char_boundary(byte.min(text.len()))].encode_utf16().count() }

/// A UTF-16 offset of `text` as a byte offset. None: it is past the end, or inside a character.
pub fn byte_of(text: &str, utf16: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units == utf16 { return Some(byte) }
        if units > utf16 { return None }
        units += ch.len_utf16();
    }
    (units == utf16).then_some(text.len())
}

/// What names a text between two asks of the service, or between two runs: the same words, the same name (FNV-1a).
pub fn version(text: &str) -> String { format!("{:016x}", text.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))) }

/// A name for one thing to send, unlike any other: when it was begun, by which process, and which of its sends
/// it is. A comment's or a reply's request is named by it (`DraftSession.send`), so one draft tried again is one
/// request and the same words written another time are another.
pub fn send_name() -> String { crate::store::fresh() }

/// What a placed span does to an offset beside it (outline-core's `PlacedSpan.caret`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Caret {
    /// An offset inside it goes to its end, one after it moves by the change.
    Moves,
    /// As `Moves`, but an offset at its start stays before it (an answer opens below its ask's line).
    Stays,
    /// It moves no offset (a paragraph of its own added at the very end).
    Apart,
}

/// Why a `place` wasn't taken.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unplaced {
    /// The text is no longer the one the spans were found in: typed in since.
    Moved,
    /// The ask names no place in the draft, in words for the service.
    Unreadable(String),
}

/// A span a patch replaces: `[start, end)` becomes text `len` long, in whatever unit the three are counted in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placed { pub start: usize, pub end: usize, pub len: usize, pub caret: Caret }

/// Where an offset of a text is once placed spans (in order, apart) are replaced: outline-core's `mapCursor`, and the
/// one copy of it here (`fixtures/core-contract.json` holds what that answers, and `tests/contract.rs` asks every row).
pub fn map_cursor(offset: usize, spans: &[Placed]) -> usize {
    let mut delta = 0isize;
    for span in spans.iter().filter(|span| span.caret != Caret::Apart) {
        if offset < span.start || (offset == span.start && (span.end > span.start || span.caret == Caret::Stays)) { break }
        if offset < span.end { return (span.start as isize + delta) as usize + span.len }
        delta += span.len as isize - (span.end - span.start) as isize;
    }
    (offset as isize + delta) as usize
}

impl DraftSession {
    /// A draft of `note` on `tile`: `text` as the service holds it at `revision`, in a field the caller made.
    pub fn new(tile: Id, note: String, revision: u64, base: String, buf: Text) -> DraftSession {
        DraftSession { tile, note, writes: Writes::Block, send: send_name(), revision, base, buf, hold: Hold::None, told: None, lit: Vec::new(), lit_at: 0, changes: 0, quiet_at: 0, completing: Completing::default(), touched: None, stood: HashMap::new() }
    }

    /// The same session, writing something else than the block's own text (a comment, a reply).
    pub fn writing(mut self, writes: Writes) -> DraftSession { self.writes = writes; self }

    /// The same session, under the name it had when the file kept it: found back, it is still the send it was.
    pub fn sending(mut self, send: Option<String>) -> DraftSession { if let Some(send) = send { self.send = send } self }

    /// It is the block's own text being written: the one draft of a block the service holds and patches.
    pub fn is_block(&self) -> bool { self.writes == Writes::Block }

    /// It holds text the service doesn't.
    pub fn unsaved(&self) -> bool { self.buf.words() != self.base }

    /// The hold's id, while the service has granted one.
    pub fn hold_id(&self) -> Option<&str> { match &self.hold { Hold::Held { id, .. } => Some(id), _ => None } }

    /// The text changed: what a patch lit is lit no longer, and what completes it is asked again.
    pub fn changed(&mut self) { self.changes += 1 }

    /// The ranges somebody else's last patch wrote, while nothing has changed since.
    pub fn lit(&self) -> &[Range<usize>] { if self.lit_at == self.changes { &self.lit } else { &[] } }

    /// The completion list is put away until the person types again.
    pub fn quiet(&mut self) { self.quiet_at = self.changes; self.completing = Completing::default() }

    /// What the service is asked to complete now: the text and the caret, once the person has typed since the
    /// list was last put away. Made again only when either moved.
    pub fn complete(&mut self, at: &crate::store::OutlineAt) {
        let caret = self.buf.ends().1;
        if self.changes == self.quiet_at { self.completing = Completing::default(); return }
        if self.completing.ask.is_some() && self.completing.at == (self.changes, caret) { return }
        let text = self.buf.words();
        let ask = Ask::read(at, "completion.rows", json!({ "text": text, "cursor": utf16_of(text, caret), "near": self.note }));
        self.completing = Completing { ask: Some(ask), at: (self.changes, caret), lit: 0, moved: false };
    }

    /// The question whose answer is for the text and the caret as they are now.
    pub fn completes(&self) -> Option<&Ask> { self.completing.ask.as_ref().filter(|_| self.completing.at == (self.changes, self.buf.ends().1)) }

    // ── the holder's answers ────────────────────────────────────────────────────────────────────────────────

    /// A `read`: the draft as it is now, and the line the caret is on.
    pub fn read(&self) -> Value {
        let text = self.buf.words();
        json!({ "text": text, "revision": self.revision, "cursorLine": text[..self.buf.ends().1].matches('\n').count() })
    }

    /// The draft as it stands, for the service to place a patch in (outline-core's `HeldDraft`): its text, the
    /// revision it stands on, where the caret and the selection's other end are, and the name of this text.
    pub fn stands(&self, saving: bool) -> Value {
        let text = self.buf.words();
        let (anchor, caret) = self.buf.ends();
        json!({ "text": text, "revision": self.revision, "version": version(text), "cursor": utf16_of(text, caret), "anchor": utf16_of(text, anchor), "busy": saving })
    }

    /// A placed patch lands (`place`): the spans the service found, replaced under the caret, when the text is still
    /// the one it found them in. `who`: whoever it is recorded as, as the window names them. Ok: what the tile says
    /// of it (who, what they did), when the ask says. Err: the text moved (the service is told what the draft holds
    /// now and places it again), or the ask doesn't read.
    pub fn land(&mut self, ask: &Value, who: Option<String>) -> Result<Option<Told>, Unplaced> {
        let text = self.buf.words().to_string();
        if ask["version"].as_str() != Some(version(&text).as_str()) { return Err(Unplaced::Moved) }
        let mut edits: Vec<(usize, usize, &str)> = Vec::new();
        let mut placed: Vec<Placed> = Vec::new();
        for span in ask["spans"].as_array().into_iter().flatten() {
            let (Some(start), Some(end), Some(with)) = (span["start"].as_u64().and_then(|at| byte_of(&text, at as usize)), span["end"].as_u64().and_then(|at| byte_of(&text, at as usize)), span["replacement"].as_str()) else { return Err(Unplaced::Unreadable("a span of the patch names no place in the draft".into())) };
            if start > end || edits.last().is_some_and(|(_, before, _)| start < *before) { return Err(Unplaced::Unreadable("the spans of the patch aren't apart and in order".into())) }
            let caret = match span["caret"].as_str() { Some("stays") => Caret::Stays, Some("apart") => Caret::Apart, _ => Caret::Moves };
            edits.push((start, end, with));
            placed.push(Placed { start, end, len: with.len(), caret });
        }
        self.buf.splice(&edits, |offset| map_cursor(offset, &placed));
        // Somebody else's change is not the person typing: a completion list that was put away (or never opened)
        // stays away, so what their keys do is as it was. One that was open is asked again for the text as it is now.
        let away = self.changes == self.quiet_at;
        self.changed();
        if away { self.quiet_at = self.changes }
        // What it wrote, where it is now: each span's new text, after the ones before it moved it.
        let mut delta = 0isize;
        self.lit = placed.iter().map(|span| { let start = (span.start as isize + delta) as usize; delta += span.len as isize - (span.end - span.start) as isize; start..start + span.len }).filter(|range| !range.is_empty()).collect();
        self.lit_at = self.changes;
        let patch = ask["patchId"].as_str().unwrap_or("").to_string();
        if ask["revert"] == true {
            // The patch the saved note also took is taken back: the draft stands where it stood.
            if let Some((revision, base)) = self.stood.remove(&patch) { self.revision = revision; self.base = base }
        } else if let (Some(revision), Some(base)) = (ask["standsOn"]["revision"].as_u64(), ask["standsOn"]["text"].as_str()) {
            // The saved note took the same change as this revision and text: the draft stands on it.
            self.stood.insert(patch, (self.revision, std::mem::replace(&mut self.base, base.to_string())));
            self.revision = revision;
        }
        // What it did is the service's word (`did`), by whoever it is recorded as: said as sent, and nothing when it sends none.
        self.told = ask["did"].as_str().map(|did| Told { who: who.unwrap_or_default(), did: did.to_string() });
        Ok(self.told.clone())
    }
}

/// Where drafts are kept while they hold unsaved text: a file an outline, beside the arrangement's.
#[derive(Clone, Debug)]
pub struct Recovery(pub PathBuf);

/// A draft as the file kept it.
#[derive(Clone, Debug, PartialEq)]
pub struct Kept {
    /// The tile it was written in, by name.
    pub tile: String,
    pub note: String,
    pub revision: u64,
    pub base: String,
    pub text: String,
    pub caret: usize,
    pub writes: Writes,
    /// The name it sends under (`DraftSession.send`); a file from before drafts had one keeps none.
    pub send: Option<String>,
}

impl Recovery {
    /// The drafts file beside an arrangement's file (`native-<outline>.layout.json` → `native-<outline>.drafts.json`).
    pub fn beside(layout: &Path) -> Recovery {
        let name = layout.file_name().and_then(|name| name.to_str()).unwrap_or("native.layout.json");
        Recovery(layout.with_file_name(match name.strip_suffix(".layout.json") { Some(stem) => format!("{stem}.drafts.json"), None => format!("{name}.drafts.json") }))
    }

    /// The drafts files of the other windows of this outline (`native-<outline>.<window>.drafts.json`, a window torn
    /// from this one keeps its own): what a run that ended left in them is the next run's first window's to bring back.
    pub fn strays(&self) -> Vec<PathBuf> {
        let Some((dir, stem)) = self.0.parent().zip(self.0.file_name().and_then(|name| name.to_str()).and_then(|name| name.strip_suffix(".drafts.json"))) else { return Vec::new() };
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir).into_iter().flatten().flatten().map(|entry| entry.path()).filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(&format!("{stem}.")) && name.ends_with(".drafts.json") && name != format!("{stem}.drafts.json"))).collect();
        found.sort();
        found
    }

    /// The drafts that hold unsaved text, written whole (to a file beside, then moved over): none, and the file goes.
    pub fn keep(&self, drafts: &[(String, &DraftSession)]) {
        let unsaved: Vec<Value> = drafts.iter().filter(|(_, draft)| draft.unsaved()).map(|(tile, draft)| json!({ "tile": tile, "note": draft.note, "revision": draft.revision, "base": draft.base, "text": draft.buf.words(), "caret": draft.buf.ends().1, "writes": draft.writes.json(), "send": draft.send })).collect();
        if unsaved.is_empty() { let _ = std::fs::remove_file(&self.0); return }
        if let Some(dir) = self.0.parent() { let _ = std::fs::create_dir_all(dir); }
        let beside = self.0.with_extension("json.writing");
        let written = std::fs::write(&beside, serde_json::to_vec(&json!({ "drafts": unsaved })).unwrap_or_default()).and_then(|()| std::fs::rename(&beside, &self.0));
        if let Err(e) = written { eprintln!("ep0ch-native: can't keep what is being written in {}: {e}", self.0.display()) }
    }

    /// What the file holds: the drafts a window left unsaved.
    pub fn read(&self) -> Vec<Kept> {
        let Some(kept) = std::fs::read(&self.0).ok().and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) else { return Vec::new() };
        kept["drafts"].as_array().into_iter().flatten().filter_map(|draft| {
            let text = |key: &str| draft[key].as_str().map(str::to_string);
            Some(Kept { tile: text("tile").unwrap_or_default(), note: text("note")?, revision: draft["revision"].as_u64()?, base: text("base")?, text: text("text")?, caret: draft["caret"].as_u64().unwrap_or(0) as usize, writes: Writes::read(&draft["writes"]), send: text("send") })
        }).collect()
    }
}
