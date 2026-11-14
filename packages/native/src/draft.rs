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
/// caret it was asked at), the lit row, and whether the person chose it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Completing {
    pub ask: Option<Ask>,
    /// The change of the text and the caret the question was asked for.
    pub at: (u64, usize),
    pub lit: usize,
    /// The person chose the list: moved the lit row, pressed one, or asked for the list by its key. Return is a
    /// choice then, whatever the row says of it.
    pub moved: bool,
    /// The same question with the lit row named, once it is not the first: its answer carries what choosing that
    /// row makes, drawn (the list's own answer carries the first row's). The list is read from `ask` all the same,
    /// so it stays where it is while this one is on its way.
    pub shows: Option<Ask>,
    /// The list as it was for the text before this change, shown while the answer for the text as it is now is on
    /// its way: the list never blinks away between two letters of one word. Let go once the caret leaves the
    /// line it was asked on.
    pub held: Option<Held>,
    /// The row the person had lit when the text changed, by what it writes: lit again in the list that answers the
    /// text as it is now, when it is still one of its rows (a row is the same row wherever it sits). None: the first.
    pub kept: Option<String>,
    /// When the lit row was lit, on the window's clock: what the lit row says of itself is shown beside the list once
    /// it has been lit a moment (`CARD_QUIET`), so moving down a list draws no card a row.
    pub since: f64,
}

/// A list shown past the change of the text it was asked for: its question, and the row that was lit in it.
#[derive(Clone, Debug, PartialEq)]
pub struct Held { pub ask: Ask, pub lit: usize }

/// How long a row is lit before what it says of itself is drawn beside the list, in seconds.
pub const CARD_QUIET: f64 = 0.3;

/// The stops of what a completion wrote (a component's skeleton: each value of its example), as ranges of the
/// draft's text in bytes, and the one the caret is in: outline-core's `SnippetSession`, ported once. Typing inside
/// the stop the caret is in keeps the stops on their text; a change anywhere else ends them.
#[derive(Clone, Debug, PartialEq)]
pub struct Stops { pub at: usize, pub spans: Vec<(usize, usize)> }

impl Stops {
    /// The stops of `spans` (bytes of what was written), in a text where that starts at `offset`.
    pub fn new(spans: &[(usize, usize)], offset: usize) -> Option<Stops> {
        (!spans.is_empty()).then(|| Stops { at: 0, spans: spans.iter().map(|(start, end)| (start + offset, end + offset)).collect() })
    }
    pub fn current(&self) -> (usize, usize) { self.spans[self.at] }
    /// The stop `by` on (back, when negative, no further than the first). None: past the last, and the stops are done.
    pub fn step(&mut self, by: isize) -> Option<(usize, usize)> {
        let to = self.at as isize + by;
        if to >= self.spans.len() as isize { return None }
        self.at = to.max(0) as usize;
        Some(self.current())
    }
    /// The text changed from `before` to `after`: true when the change is inside the stop the caret is in, whose
    /// end and every later stop move with it; false when it is anywhere else (the stops are over).
    pub fn update(&mut self, before: &str, after: &str) -> bool {
        if before == after { return true }
        let (b, a) = (before.as_bytes(), after.as_bytes());
        let mut start = 0;
        while start < b.len() && start < a.len() && b[start] == a[start] { start += 1 }
        let (mut end, mut tail) = (b.len(), a.len());
        while end > start && tail > start && b[end - 1] == a[tail - 1] { end -= 1; tail -= 1 }
        let (from, to) = self.current();
        if start < from || end > to { return false }
        let delta = a.len() as isize - b.len() as isize;
        self.spans[self.at].1 = (to as isize + delta) as usize;
        for span in self.spans.iter_mut().skip(self.at + 1) { *span = ((span.0 as isize + delta) as usize, (span.1 as isize + delta) as usize) }
        true
    }
}

/// Words of a note a comment is on, and what whoever picked them knows of where they are. Where they are in the
/// note's text is the service's to find (outline-core's drawn-passage.ts): nothing here anchors.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Quoted {
    /// The words: as the note's text has them, or (`drawn`) as a reader showed them.
    pub words: String,
    /// They were selected in what a reader drew (a link's label, bold without its marks, two paragraphs).
    pub drawn: bool,
    /// The span of the note's text (UTF-16) they were drawn within: the parts of the page the selection was made
    /// in, as the service says where each part is written.
    pub within: Option<(usize, usize)>,
    /// Among repeats, the ones nearest this UTF-16 offset of the note's text.
    pub near: Option<usize>,
    /// The service's word on where they are, once it has said (`passages.find`, asked when words are picked): the
    /// span of the note's text they are, or why they are no passage of it. Its to say, and never kept between runs.
    pub found: Option<Result<(usize, usize), String>>,
    /// The words as they were picked, when the service answered wider ones: picked again, they are these still.
    pub asked: Option<String>,
    /// Where they are in what the reader drew, when the service said (`passages.find`, asked with the part they end
    /// in): that part, and the range of the text its view is drawn from. What is written about them stands there,
    /// inside a part as long as its run of prose. The service's, as a page's marks are, and never kept between runs.
    pub at: Option<crate::parts::Anchor>,
}

impl Quoted {
    /// Words as the note's text has them (an act's `quote=`), nearest `near` among repeats.
    pub fn written(words: impl Into<String>, near: Option<usize>) -> Quoted { Quoted { words: words.into(), near, ..Quoted::default() } }
    /// Words selected in what a reader drew, within a span of the note's text when the reader knows one.
    pub fn drawn(words: impl Into<String>, within: Option<(usize, usize)>) -> Quoted { Quoted { words: words.into(), drawn: true, within, ..Quoted::default() } }

    /// The service found them: the span of the note's text they are, and the quote to send for it (their words as
    /// picked when those are the passage whole; the whole words, when the selection began or ended inside one).
    pub fn found(&mut self, span: (usize, usize), quote: &str) { self.words = quote.to_string(); self.found = Some(Ok(span)); }

    /// Where in the note's text they end, as far as anybody has said: where the service found them, else the end
    /// of the span they were drawn within. What is written about them stands under the part that holds it.
    pub fn ends_at(&self) -> Option<usize> { self.found.as_ref().and_then(|found| found.as_ref().ok()).map(|span| span.1).or(self.within.map(|within| within.1)) }

    /// The place in a part's own drawn text the service found them at (`Quoted::at`), by the part's line and the
    /// offset they end at there (UTF-16): where in that part what is written about them stands.
    pub fn stands_at(&self) -> Option<(u64, usize)> { self.at.as_ref().and_then(|at| at.range.map(|range| (at.part, range.1))) }

    /// Why they are no passage of the note, when the service said so.
    pub fn refused(&self) -> Option<&str> { self.found.as_ref().and_then(|found| found.as_ref().err()).map(String::as_str) }

    /// The passage as the service takes it (`BlockCommentPassage`).
    pub fn passage(&self) -> Value {
        let mut passage = json!({ "quote": self.words });
        if self.drawn { passage["drawn"] = json!(true) }
        if let Some((start, end)) = self.within { passage["within"] = json!({ "start": start, "end": end }) }
        if let Some(near) = self.near { passage["near"] = json!(near) }
        passage
    }

    fn read(kept: &Value) -> Option<Quoted> {
        let span = |v: &Value| Some((v["start"].as_u64()? as usize, v["end"].as_u64()? as usize));
        Some(Quoted { words: kept["quote"].as_str()?.to_string(), drawn: kept["drawn"] == true, within: span(&kept["within"]), near: kept["near"].as_u64().map(|at| at as usize), found: None, asked: None, at: None })
    }
}

/// The most of a quote said over the field of what is written about it, in characters: a line or two.
const QUOTE_SHOWN: usize = 140;

/// Words quoted, as one or two lines say them: every run of blanks one space (a selection across list items and
/// paragraphs is lines of them), and a long one its start and its end with an ellipsis between, each cut at a word.
pub fn shortened(words: &str) -> String {
    let one: Vec<char> = words.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    if one.len() <= QUOTE_SHOWN { return one.into_iter().collect() }
    let (head, tail) = (QUOTE_SHOWN * 3 / 5, QUOTE_SHOWN * 2 / 5 - 3);
    // (Cut at the blank nearest the cut, when one is near: no word is left in half.)
    let start = (head.saturating_sub(16)..=head).rev().find(|at| one[*at] == ' ').unwrap_or(head);
    let from = one.len() - tail;
    let end = (from..from + 16).find(|at| one[*at] == ' ').map_or(from, |at| at + 1);
    format!("{} … {}", one[..start].iter().collect::<String>(), one[end..].iter().collect::<String>())
}

/// What a draft writes when it is saved.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum Writes {
    /// The block's own text, checked against the revision it stands on: saving never ends the draft.
    #[default]
    Block,
    /// A comment on the block: on these words of it (`Quoted`), or on the whole of it. Sent, the draft is done.
    Comment { on: Option<Quoted> },
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
            Writes::Comment { on: Some(quoted) } => Some(format!("On “{}”", shortened(&quoted.words))),
            Writes::Comment { on: None } => Some("On the whole note".to_string()),
            Writes::Reply { to, .. } if to.is_empty() => Some("In reply".to_string()),
            Writes::Reply { to, .. } => Some(format!("In reply to “{to}”")),
        }
    }

    /// Where in the note's text the words a comment is on end, as far as anybody has said (`Quoted::ends_at`): what
    /// is written stands under the part of the page that holds it. None: a comment on the whole note, or anything else.
    pub fn ends_at(&self) -> Option<usize> { self.quoted().and_then(Quoted::ends_at) }

    /// Where in a part's own drawn text the words a comment is on end (`Quoted::stands_at`): the part by its line,
    /// and the offset there. None: nobody has said, and what is written stands under the part whole.
    pub fn stands_at(&self) -> Option<(u64, usize)> { self.quoted().and_then(Quoted::stands_at) }

    /// The thing a reply answers (its thread), by id: what is written stands under the part that carries its mark.
    pub fn answers(&self) -> Option<&str> { match self { Writes::Reply { thread, .. } => Some(thread.as_str()), _ => None } }

    /// The words a comment is on, whole: what `on` says shortened.
    pub fn quoted(&self) -> Option<&Quoted> { match self { Writes::Comment { on } => on.as_ref(), _ => None } }

    /// As the wire and `peek` name it.
    pub fn kind(&self) -> &'static str { match self { Writes::Block => "block", Writes::Comment { .. } => "comment", Writes::Reply { .. } => "reply" } }

    fn json(&self) -> Value {
        match self {
            Writes::Block => Value::Null,
            Writes::Comment { on } => { let mut kept = on.as_ref().map_or(json!({}), Quoted::passage); kept["kind"] = json!("comment"); kept }
            Writes::Reply { thread, to } => json!({ "kind": "reply", "thread": thread, "to": to }),
        }
    }
    fn read(kept: &Value) -> Writes {
        let text = |key: &str| kept[key].as_str().map(str::to_string);
        match kept["kind"].as_str() {
            Some("comment") => Writes::Comment { on: Quoted::read(kept) },
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
    /// The stops of the skeleton a completion wrote, while it is being filled in, and the text they were last read in.
    pub stops: Option<(Stops, String)>,
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

/// Words that come into a draft from outside it, their line ends made plain: a CRLF and a bare carriage return are
/// each a newline. Everything that enters by a paste goes through here and nowhere else (a paste event, `draft.paste`
/// with or without its words): a carriage return left between two lines is one line to the service, whatever is
/// written on each (two files copied in a file manager are a path a line, a carriage return between them).
pub fn plain_ends(words: &str) -> std::borrow::Cow<'_, str> {
    if !words.contains('\r') { return std::borrow::Cow::Borrowed(words) }
    std::borrow::Cow::Owned(words.replace("\r\n", "\n").replace('\r', "\n"))
}

/// A list item's lead, as far as a level in or out reads it (outline-core's `listLead`): how long its indent, its
/// marker (`-`, `*`, `+`, `1.`, `1)`: up to nine digits) and the space after it are. None: the line starts no item
/// (`-` alone isn't one; `- ` with nothing after it is).
fn list_lead(line: &str) -> Option<(usize, usize, usize)> {
    let blank = |rest: &str| rest.bytes().take_while(|b| matches!(b, b' ' | b'\t')).count();
    let indent = blank(line);
    let rest = &line[indent..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let marker = match rest.as_bytes().first() {
        Some(b'-' | b'*' | b'+') => 1,
        Some(_) if (1..=9).contains(&digits) && matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) => digits + 1,
        _ => return None,
    };
    let gap = blank(&rest[marker..]);
    (gap > 0).then_some((indent, marker, gap))
}

/// A draft's lines one level in or out: the edits (apart, in order, bytes of the text) and where the selection's two
/// ends are once they are made.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Indented { pub edits: Vec<(usize, usize, String)>, pub anchor: usize, pub caret: usize }

/// The line the caret is on, or every line the selection touches, one level in or out (Tab, Shift+Tab):
/// outline-core's `indentText`, and the one copy of it here (`fixtures/core-contract.json` holds what that answers
/// under `indent`, and `tests/contract.rs` asks every row). A list item goes under the item above it by that item's
/// marker and gap, or back to its parent's level; anything else moves two spaces, or one tab where the line is
/// indented with tabs; every line moves by the first line's step; blank lines in a selection of several stay; the
/// caret stays on its text. Offsets are bytes.
pub fn indent(text: &str, out: bool, anchor: usize, caret: usize) -> Indented {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut starts = Vec::with_capacity(lines.len());
    let mut at = 0;
    for line in &lines { starts.push(at); at += line.len() + 1 }
    let place = |offset: usize| { let offset = offset.min(text.len()); let row = starts.iter().rposition(|start| *start <= offset).unwrap_or(0); (row, offset - starts[row]) };
    let (a, c) = (place(anchor), place(caret));
    let (from, to) = (a.0.min(c.0), a.0.max(c.0));
    let indent_of = |line: &str| line.bytes().take_while(|b| matches!(b, b' ' | b'\t')).count();
    // The lines above `from` that say where they are, nearest first: a list item's lead (none for prose) and how far in.
    let above = || lines[..from].iter().rev().filter(|line| !line.trim().is_empty()).map(|line| { let lead = list_lead(line); (lead, lead.map_or(indent_of(line), |lead| lead.0)) });
    let (first, lead) = (lines[from], list_lead(lines[from]));
    let ind = lead.map_or(indent_of(first), |lead| lead.0);
    let tabs = first[..ind].contains('\t');
    let step = if out {
        // Back to the level of the item it is nested in: the nearest one above indented less.
        let mut up = None;
        if lead.is_some() { for (lead, at) in above() { if at < ind { up = lead; break } if at == 0 { break } } }
        match up { Some(up) if !tabs => ind - up.0, _ => ind.min(if tabs { 1 } else { 2 }) }
    } else {
        // Under the item above it at its own level: by that item's marker and gap.
        let mut sibling = None;
        if lead.is_some() { for (lead, at) in above() { if at < ind { break } if lead.is_some() && at == ind { sibling = lead; break } } }
        match sibling { Some(sibling) if !tabs => sibling.1 + sibling.2, _ => if tabs { 1 } else { 2 } }
    };
    let put = if tabs { "\t".to_string() } else { " ".repeat(step) };
    // Each line that moves, and by how much: in by the step, out by the step or what indent it has.
    let shifts: Vec<(usize, isize)> = if step == 0 { Vec::new() } else {
        (from..=to).filter(|row| from == to || !lines[*row].trim().is_empty()).map(|row| (row, if out { -(step.min(indent_of(lines[row])) as isize) } else { step as isize })).filter(|(_, by)| *by != 0).collect()
    };
    let edits = shifts.iter().map(|(row, by)| if *by > 0 { (starts[*row], starts[*row], put.clone()) } else { (starts[*row], starts[*row] + by.unsigned_abs(), String::new()) }).collect();
    let moved = |(row, col): (usize, usize)| {
        let before: isize = shifts.iter().filter(|(at, _)| *at < row).map(|(_, by)| by).sum();
        let own = shifts.iter().find(|(at, _)| *at == row).map_or(0, |(_, by)| *by);
        (starts[row] as isize + before) as usize + (col as isize + own).max(0) as usize
    };
    Indented { edits, anchor: moved(a), caret: moved(c) }
}

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
        DraftSession { tile, note, writes: Writes::Block, send: send_name(), revision, base, buf, hold: Hold::None, told: None, lit: Vec::new(), lit_at: 0, changes: 0, quiet_at: 0, completing: Completing::default(), stops: None, touched: None, stood: HashMap::new() }
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

    /// The text changed: what a patch lit is lit no longer, and what completes it is asked again. The stops of a
    /// skeleton being filled in follow a change inside the one the caret is in, and end on any other.
    pub fn changed(&mut self) {
        self.changes += 1;
        if let Some((mut stops, before)) = self.stops.take() && stops.update(&before, self.buf.words()) { self.stops = Some((stops, self.buf.words().to_string())) }
    }

    /// The ranges somebody else's last patch wrote, while nothing has changed since.
    pub fn lit(&self) -> &[Range<usize>] { if self.lit_at == self.changes { &self.lit } else { &[] } }

    /// The completion list is put away until the person types again.
    pub fn quiet(&mut self) { self.quiet_at = self.changes; self.completing = Completing::default() }

    /// The completion list is asked for by its key, where the caret is, with nothing typed: it is open from now, and
    /// asking for it is a choice (Return takes the lit row).
    pub fn summon(&mut self) { self.quiet_at = u64::MAX; self.completing = Completing { moved: true, ..Completing::default() } }

    /// A skeleton was written at `offset` with these stops (bytes of what was written): the first is selected, and
    /// the next key that steps goes to the one after.
    pub fn fill(&mut self, spans: &[(usize, usize)], offset: usize) {
        self.stops = Stops::new(spans, offset).map(|stops| (stops, self.buf.words().to_string()));
        if let Some((stops, _)) = &self.stops { let (from, to) = stops.current(); self.buf.select(from, to) }
    }

    /// The stop `by` on is selected. False: past the last one (the caret goes after it and the stops are done), or
    /// no skeleton is being filled in.
    pub fn stop(&mut self, by: isize) -> bool {
        let Some((stops, _)) = self.stops.as_mut() else { return false };
        match stops.step(by) {
            Some((from, to)) => { self.buf.select(from, to); true }
            None => { let end = stops.current().1; self.stops = None; self.buf.select(end, end); false }
        }
    }

    /// What the service is asked to complete now: the text and the caret, once the person has typed since the
    /// list was last put away. Made again only when either moved. `shown`: the list on screen until now (its
    /// question, its lit row, and what that row writes when the person chose it): it stays on screen until the
    /// answer for the text as it is now lands, while the caret is still on the line it was asked on, and the row
    /// the person chose is lit again in the new list. `now`: the window's clock.
    pub fn complete(&mut self, at: &crate::store::OutlineAt, shown: Option<(Held, Option<String>)>, now: f64) {
        let caret = self.buf.ends().1;
        if self.changes == self.quiet_at { self.completing = Completing::default(); return }
        if self.completing.ask.is_some() && self.completing.at == (self.changes, caret) { return }
        // The list before is held only along one line: the caret on another line is in another token.
        let same_line = |held: &Held| held.ask.params["text"].as_str().zip(held.ask.params["cursor"].as_u64()).is_some_and(|(text, cursor)| {
            let was = byte_of(text, cursor as usize).unwrap_or(text.len());
            text[..was].matches('\n').count() == self.buf.words()[..caret].matches('\n').count()
        });
        let (held, kept) = match shown { Some((held, kept)) if same_line(&held) => (Some(held), kept), _ => (None, None) };
        let moved = self.completing.moved && (kept.is_some() || self.quiet_at == u64::MAX);
        self.completing = Completing { ask: Some(self.asks(at, None)), at: (self.changes, caret), lit: 0, moved, shows: None, held, kept, since: now };
    }

    /// `completion.rows` for the text and the caret as they are: the list, or (`lit`) the list with that row's drawn form.
    fn asks(&self, at: &crate::store::OutlineAt, lit: Option<usize>) -> Ask {
        let text = self.buf.words();
        let mut ask = json!({ "text": text, "cursor": utf16_of(text, self.buf.ends().1), "near": self.note });
        if let Some(lit) = lit.filter(|lit| *lit > 0) { ask["lit"] = json!(lit) }
        Ask::read(at, "completion.rows", ask)
    }

    /// A row of the open list is lit: what choosing it makes is asked for, drawn. `chosen`: by the person's own
    /// choice (a key that moves, a press), which makes Return take the row; a pointer passing over a row lights it
    /// and chooses nothing. The list the answer landed in is the one on screen from now (nothing held, nothing kept).
    pub fn light(&mut self, row: usize, chosen: bool, at: &crate::store::OutlineAt, now: f64) {
        let shows = (row > 0).then(|| self.asks(at, Some(row)));
        let was = std::mem::take(&mut self.completing);
        self.completing = Completing { lit: row, moved: was.moved || chosen, shows, held: None, kept: None, since: if was.lit == row && was.kept.is_none() { was.since } else { now }, ..was };
    }

    /// The question whose answer carries the lit row's drawn form: the list's own while its first row is lit.
    pub fn shows(&self) -> Option<&Ask> { self.completes().and_then(|ask| if self.completing.lit == 0 { Some(ask) } else { self.completing.shows.as_ref() }) }

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
