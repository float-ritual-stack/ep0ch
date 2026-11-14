//! What an editor's keys make of a draft's Blockdown: Return on a list, lines moved, copied and deleted, a selection
//! wrapped, a bracket paired and typed over, a checklist's box, the line, word or text selected, a line erased to
//! its edge. No Rune, no socket: a text and the selection's two ends in, the text and the two ends out.
//!
//! - **Every rule here is outline-core's, by port** (`draft-keys.ts`, beside `draft-indent.ts`'s Tab): the door's
//!   `Draft` asks the same functions of its text, and `fixtures/core-contract.json` holds what each answers
//!   (`newline`, `lines`, `wrap`, `typed`, `select`, `go`, `erase`, `check`), asked row for row by `tests/contract.rs`.
//!   Nothing here decides how a list goes on or which lines a key takes that the table doesn't say.
//! - **Offsets are bytes** of the text (the wire's and the table's are UTF-16: `draft::utf16_of`, `byte_of`).
//! - **What a list item's lead is** (`lead`: its indent, marker, gap and box) is read here once, for these rules and
//!   for Tab's (`draft::indent`).
//! - **Not ported:** Return closing a component its line opens, and titling a page (the rows that say `needs`): both
//!   read the note's components and code fences, which only outline-core scans.

/// A draft after a key: its text, and where the selection's two ends are.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Change { pub text: String, pub anchor: usize, pub caret: usize }

impl Change {
    /// The one span that makes this text from `before` (outline-core's `changeSpan`): what is between their common
    /// start and their common end, never splitting a character. None: the text is the same, and only the selection moved.
    pub fn span(&self, before: &str) -> Option<(usize, usize, String)> {
        if before == self.text { return None }
        let start: usize = before.chars().zip(self.text.chars()).take_while(|(a, b)| a == b).map(|(a, _)| a.len_utf8()).sum();
        let tail: usize = before[start..].chars().rev().zip(self.text[start..].chars().rev()).take_while(|(a, b)| a == b).map(|(a, _)| a.len_utf8()).sum();
        Some((start, before.len() - tail, self.text[start..self.text.len() - tail].to_string()))
    }
}

/// A list item's lead (outline-core's `listLead`): its indent, its marker (`-`, `*`, `+`, `1.`, `1)`: up to nine
/// digits), the blanks after it, and a checklist's box with the blanks after that. `len`: how long they are together.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Lead { pub indent: String, pub marker: String, pub gap: String, pub boxed: String, pub len: usize }

const BLANK: [char; 2] = [' ', '\t'];
/// What a box may hold (outline-core's `STEP_BOX_CHARS`).
const BOX_CHARS: &str = " xX~!✓✗+-";

fn blanks(s: &str) -> usize { s.len() - s.trim_start_matches(BLANK).len() }
pub fn indent_of(line: &str) -> &str { &line[..blanks(line)] }

/// A marker at the start of `rest`, by its length: a bullet, or a number of up to nine digits with its closer.
fn marker(rest: &str) -> Option<usize> {
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    match rest.as_bytes().first() {
        Some(b'-' | b'*' | b'+') => Some(1),
        Some(_) if (1..=9).contains(&digits) && matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) => Some(digits + 1),
        _ => None,
    }
}

/// The list item `line` starts, or None. `- ` with nothing after it is an (empty) item; `-` alone isn't.
pub fn lead(line: &str) -> Option<Lead> {
    let indent = blanks(line);
    let mark = marker(&line[indent..])?;
    let gap = blanks(&line[indent + mark..]);
    if gap == 0 { return None }
    let rest = &line[indent + mark + gap..];
    // A box: `[`, one of its characters, `]`, then blanks or the line's end.
    let mut chars = rest.chars();
    let boxed = match (chars.next(), chars.next(), chars.next()) {
        (Some('['), Some(held), Some(']')) if BOX_CHARS.contains(held) => { let end = 2 + held.len_utf8(); let after = blanks(&rest[end..]); (after > 0 || end == rest.len()).then_some(end + after) }
        _ => None,
    }.unwrap_or(0);
    Some(Lead { indent: line[..indent].to_string(), marker: line[indent..indent + mark].to_string(), gap: line[indent + mark..indent + mark + gap].to_string(), boxed: rest[..boxed].to_string(), len: indent + mark + gap + boxed })
}

/// The lines above `row` that say where they are, nearest first: a list item's lead (none for prose) and how far in
/// it starts. Blank lines say nothing.
fn above<'a>(lines: &'a [&'a str], row: usize) -> impl Iterator<Item = (Option<Lead>, usize)> + 'a {
    lines[..row].iter().rev().filter(|line| !line.trim().is_empty()).map(|line| { let lead = lead(line); let at = lead.as_ref().map_or(blanks(line), |lead| lead.indent.len()); (lead, at) })
}

/// The nearest list item above `row` indented less than `than`: the item this one is nested in (`listParent`).
pub fn parent(lines: &[&str], row: usize, than: usize) -> Option<Lead> {
    for (lead, at) in above(lines, row) { if at < than { return lead } if at == 0 { return None } }
    None
}

/// The nearest list item above `row` at exactly `indent`: the one this item follows (`listSibling`).
pub fn sibling(lines: &[&str], row: usize, indent: usize) -> Option<Lead> {
    for (lead, at) in above(lines, row) { if at < indent { return None } if lead.is_some() && at == indent { return lead } }
    None
}

/// Whether Tab with the caret at `col` of its line moves lines `from`..`to` in (`tabTakes`): several lines do, a list
/// item does from any column, any other line only from its start or inside its indent.
pub fn tab_takes(lines: &[&str], from: usize, to: usize, col: usize) -> bool {
    let line = lines.get(from).copied().unwrap_or("");
    from != to || lead(line).is_some() || col <= blanks(line)
}

/// The marker after `m`: the same bullet, or the next number with the same closer.
fn next_marker(m: &str) -> String {
    match m.as_bytes().first() { Some(first) if first.is_ascii_digit() => format!("{}{}", m[..m.len() - 1].parse::<u64>().map_or(1, |n| n + 1), &m[m.len() - 1..]), _ => m.to_string() }
}

/// An indent one level less: a tab, or two spaces.
fn outdent_by(indent: &str) -> &str { if indent.ends_with('\t') { &indent[..indent.len() - 1] } else { &indent[..indent.len().saturating_sub(2)] } }

/// An offset of a text as a row and a column of its lines.
fn place<S: AsRef<str>>(lines: &[S], offset: usize) -> (usize, usize) {
    let (mut at, mut row) = (offset, 0);
    while row + 1 < lines.len() && at > lines[row].as_ref().len() { at -= lines[row].as_ref().len() + 1; row += 1 }
    (row, at.min(lines[row].as_ref().len()))
}

fn offset_in(lines: &[String], (row, col): (usize, usize)) -> usize { lines[..row].iter().map(|line| line.len() + 1).sum::<usize>() + col.min(lines[row].len()) }

fn made(lines: &[String], anchor: (usize, usize), caret: (usize, usize)) -> Change { Change { text: lines.join("\n"), anchor: offset_in(lines, anchor), caret: offset_in(lines, caret) } }

fn lines_of(text: &str) -> Vec<String> { text.split('\n').map(str::to_string).collect() }

/// Return at the caret (`newlineText`; a selection goes first). On a list item the words after the caret go to a
/// new item: the same indent, the next marker, the same gap and a fresh box. On an empty item it goes up to its
/// parent's level instead, and at the top level the marker goes and the list ends. The caret on the marker itself:
/// the break goes before the item. Any other line keeps its indent; a line of only blanks steps back a level.
/// `plain`: just the break.
pub fn newline(text: &str, anchor: usize, caret: usize, plain: bool) -> Change {
    let (from, to) = (anchor.min(caret), anchor.max(caret));
    let mut lines = lines_of(&format!("{}{}", &text[..from], &text[to..]));
    let (row, col) = place(&lines, from);
    let line = lines[row].clone();
    let at = |lines: &[String], row: usize, col: usize| made(lines, (row, col), (row, col));
    let item = if plain { None } else { lead(&line) };
    let c = match &item { Some(item) if col < item.len => 0, _ => col };
    let rest = &line[c..];
    if let Some(item) = item.filter(|item| c >= item.len) {
        let fresh = if item.boxed.is_empty() { "" } else { "[ ] " };
        if line[item.len..].trim().is_empty() {
            let up = { let views: Vec<&str> = lines.iter().map(String::as_str).collect(); parent(&views, row, item.indent.len()) };
            let next = match up {
                Some(up) => format!("{}{}{}{fresh}", up.indent, next_marker(&up.marker), up.gap),
                None if !item.indent.is_empty() => format!("{}{}{}{}", outdent_by(&item.indent), item.marker, item.gap, item.boxed),
                None => String::new(),
            };
            let end = next.len();
            lines[row] = next;
            return at(&lines, row, end);
        }
        let next = format!("{}{}{}{fresh}", item.indent, next_marker(&item.marker), item.gap);
        lines[row] = line[..c].to_string();
        lines.insert(row + 1, format!("{next}{}", rest.trim_start_matches(BLANK)));
        return at(&lines, row + 1, next.len());
    }
    let indent = if plain { "" } else { indent_of(&line) };
    if !indent.is_empty() && line.trim().is_empty() && c == line.len() {
        lines[row] = outdent_by(indent).to_string();
        let end = lines[row].len();
        return at(&lines, row, end);
    }
    let keep = if !indent.is_empty() && c >= indent.len() { indent } else { "" };
    lines[row] = line[..c].to_string();
    lines.insert(row + 1, format!("{keep}{}", if keep.is_empty() { rest } else { rest.trim_start_matches(BLANK) }));
    at(&lines, row + 1, keep.len())
}

/// The whole lines a line key acts on: the selection's (one that ends at a line's very start leaves that line out),
/// else the caret's.
fn whole(a: (usize, usize), c: (usize, usize)) -> (usize, usize) {
    let (first, last) = if a <= c { (a, c) } else { (c, a) };
    (first.0, if last.1 == 0 && last.0 > first.0 { last.0 - 1 } else { last.0 })
}

/// What a line key does (`LINE_OPS`).
pub const LINE_OPS: [&str; 5] = ["up", "down", "copy-up", "copy-down", "delete"];

/// The caret's line, or every whole line the selection touches (`lineOpText`): moved a line `up` or `down` (nothing
/// at the text's edge), written again above (`copy-up`: the caret stays on the upper) or below (`copy-down`: it goes
/// to the copy), or taken out (`delete`). None: `op` is none of those.
pub fn line_op(text: &str, anchor: usize, caret: usize, op: &str) -> Option<Change> {
    let mut lines = lines_of(text);
    let (a, c) = (place(&lines, anchor), place(&lines, caret));
    let (first, last) = whole(a, c);
    let n = last - first + 1;
    Some(match op {
        "up" | "down" => {
            let down = op == "down";
            if (!down && first == 0) || (down && last + 1 >= lines.len()) { return Some(Change { text: text.to_string(), anchor, caret }) }
            let moving: Vec<String> = lines.drain(first..=last).collect();
            let to = if down { first + 1 } else { first - 1 };
            lines.splice(to..to, moving);
            let step = |(row, col): (usize, usize)| (if down { row + 1 } else { row - 1 }, col);
            made(&lines, step(a), step(c))
        }
        "copy-up" | "copy-down" => {
            let copy: Vec<String> = lines[first..=last].to_vec();
            lines.splice(last + 1..last + 1, copy);
            let by = if op == "copy-down" { n } else { 0 };
            made(&lines, (a.0 + by, a.1), (c.0 + by, c.1))
        }
        "delete" => {
            lines.drain(first..=last);
            if lines.is_empty() { lines.push(String::new()) }
            let row = first.min(lines.len() - 1);
            let at = (row, c.1.min(lines[row].len()));
            made(&lines, at, at)
        }
        _ => return None,
    })
}

/// What wraps a selection when typed over it, with its closer (`WRAPS`).
pub const WRAPS: [(char, char); 9] = [('(', ')'), ('[', ']'), ('{', '}'), ('"', '"'), ('\'', '\''), ('`', '`'), ('*', '*'), ('_', '_'), ('~', '~')];
/// What a bracket typed with nothing selected brings its closer with (`PAIRS`).
pub const PAIRS: [(char, char); 3] = [('(', ')'), ('[', ']'), ('{', '}')];

fn closer_of(table: &[(char, char)], open: char) -> Option<char> { table.iter().find(|(o, _)| *o == open).map(|(_, close)| *close) }

/// The selection between `open` and its closer (its mirror: `[[` closes with `]]`), the same text left selected
/// (`wrapText`). None with nothing selected.
pub fn wrap(text: &str, anchor: usize, caret: usize, open: &str) -> Option<Change> {
    if anchor == caret || open.is_empty() { return None }
    let (from, to) = (anchor.min(caret), anchor.max(caret));
    let close: String = open.chars().rev().map(|ch| closer_of(&WRAPS, ch).unwrap_or(ch)).collect();
    Some(Change { text: format!("{}{open}{}{close}{}", &text[..from], &text[from..to], &text[to..]), anchor: anchor + open.len(), caret: caret + open.len() })
}

/// A line that is an empty item with another marker typed on it, as that marker's own item (`typedMarker`).
fn typed_marker(line: &str) -> Option<String> {
    let item = lead(line)?;
    let rest = &line[item.len..];
    // (A box with nothing after it is the item's own, and no marker follows it.)
    (marker(rest) == Some(rest.len()) && !rest.is_empty()).then(|| format!("{}{rest}", item.indent))
}

/// One character typed, where it does more than go in at the caret (`typedText`); None where it is only text and
/// the editor types it. Over a selection the person made a wrap character wraps it (over one the window `filled` in
/// for typing over, it replaces it as any character does); a space at the end of an empty item that has another
/// marker typed on it makes that marker the item's; a closing bracket typed where the same one stands is typed over;
/// an opening bracket before the line's end, a blank or a closing bracket brings its closer.
pub fn typed(text: &str, anchor: usize, caret: usize, ch: char, filled: bool) -> Option<Change> {
    if anchor != caret { return if !filled && closer_of(&WRAPS, ch).is_some() { wrap(text, anchor, caret, ch.encode_utf8(&mut [0; 4])) } else { None } }
    let next = text[caret..].chars().next();
    let closes = |c: char| PAIRS.iter().any(|(_, close)| *close == c);
    if ch == ' ' && matches!(next, None | Some('\n')) {
        let start = text[..caret].rfind('\n').map_or(0, |at| at + 1);
        if let Some(item) = typed_marker(&text[start..caret]) {
            let at = start + item.len() + 1;
            return Some(Change { text: format!("{}{item} {}", &text[..start], &text[caret..]), anchor: at, caret: at });
        }
    }
    if closes(ch) && next == Some(ch) { return Some(Change { text: text.to_string(), anchor: caret + ch.len_utf8(), caret: caret + ch.len_utf8() }) }
    if let Some(close) = closer_of(&PAIRS, ch) && next.is_none_or(|next| next.is_whitespace() || closes(next)) {
        let at = caret + ch.len_utf8();
        return Some(Change { text: format!("{}{ch}{close}{}", &text[..caret], &text[caret..]), anchor: at, caret: at });
    }
    None
}

/// The word at `offset` of `line` (`wordIn`): a run of non-blanks, or the blank run it is in.
fn word_in(line: &str, offset: usize) -> (usize, usize) {
    let chars: Vec<(usize, char)> = line.char_indices().collect();
    if chars.is_empty() { return (0, 0) }
    let at = chars.iter().position(|(start, ch)| start + ch.len_utf8() > offset).unwrap_or(chars.len() - 1);
    let kind = chars[at].1.is_whitespace();
    let (mut a, mut b) = (at, at);
    while a > 0 && chars[a - 1].1.is_whitespace() == kind { a -= 1 }
    while b + 1 < chars.len() && chars[b + 1].1.is_whitespace() == kind { b += 1 }
    (chars[a].0, chars[b].0 + chars[b].1.len_utf8())
}

/// The word the caret is on, its line (with whole lines already selected: the next line too) or the whole text
/// (`selectText`): the selection's two ends, the caret at its end. None: `what` is none of `word`, `line`, `all`.
pub fn select(text: &str, anchor: usize, caret: usize, what: &str) -> Option<(usize, usize)> {
    let lines = lines_of(text);
    let (a, c) = (place(&lines, anchor), place(&lines, caret));
    let start = |row: usize| offset_in(&lines, (row, 0));
    Some(match what {
        "all" => (0, text.len()),
        "word" => { let (from, to) = word_in(&lines[c.0], c.1); (start(c.0) + from, start(c.0) + to) }
        "line" => {
            let (first, last) = if a <= c { (a, c) } else { (c, a) };
            let whole = anchor != caret && first.1 == 0 && last.1 == lines[last.0].len();
            let end = (if whole { last.0 + 1 } else { last.0 }).min(lines.len() - 1);
            (start(first.0), start(end) + lines[end].len())
        }
        _ => return None,
    })
}

/// Where the caret goes for a motion the text alone answers (`goText`): its line's start or end (the line as
/// written, however it wraps), the text's start or end. `extend` keeps the anchor. None: `to` is none of those (a
/// motion by word is the editor's own, which has the words).
pub fn go(text: &str, anchor: usize, caret: usize, to: &str, extend: bool) -> Option<(usize, usize)> {
    let at = caret.min(text.len());
    let landed = match to {
        "doc-start" => 0,
        "doc-end" => text.len(),
        "line-start" => text[..at].rfind('\n').map_or(0, |found| found + 1),
        "line-end" => text[at..].find('\n').map_or(text.len(), |found| at + found),
        _ => return None,
    };
    Some((if extend { anchor } else { landed }, landed))
}

/// The selection taken out; with none, what is between the caret and its line's start or end (`eraseText`).
pub fn erase(text: &str, anchor: usize, caret: usize, to: &str) -> Option<Change> {
    let edge = go(text, caret, caret, to, false)?.1;
    let (from, until) = if anchor != caret { (anchor.min(caret), anchor.max(caret)) } else { (edge.min(caret), edge.max(caret)) };
    Some(Change { text: format!("{}{}", &text[..from], &text[until..]), anchor: from, caret: from })
}

/// A checklist's box on the caret's line, or on every line the selection touches (`checkText`): an open step is
/// done, a step in any other state is open again, a list item with no box gets an open one, any other line becomes
/// an item with one. Several lines all go where the first goes, and blank lines among them stay.
pub fn check(text: &str, anchor: usize, caret: usize) -> Change {
    let mut lines = lines_of(text);
    let (mut a, mut c) = (place(&lines, anchor), place(&lines, caret));
    let (first, last) = whole(a, c);
    let open = lead(&lines[first]).is_some_and(|item| item.boxed.starts_with("[ ]"));
    let mark = if open { "[x]" } else { "[ ]" };
    for row in first..=last {
        let line = lines[row].clone();
        if line.trim().is_empty() && first != last { continue }
        let item = lead(&line);
        // Where the change is in the line, how long what goes was, and what stands there after.
        let (at, old, put) = match &item {
            Some(item) if !item.boxed.is_empty() => { let at = item.len - item.boxed.len(); (at, item.boxed.trim_end_matches(BLANK).len(), mark.to_string()) }
            Some(item) => (item.len, 0, format!("{mark} ")),
            None => (blanks(&line), 0, format!("- {mark} ")),
        };
        lines[row] = format!("{}{put}{}", &line[..at], &line[at + old..]);
        for end in [&mut a, &mut c] {
            if end.0 != row { continue }
            // An end past what changed moves with its text; one inside a box that changed stays before its `]`.
            if end.1 >= at + old { end.1 = end.1 + put.len() - old } else if end.1 > at + 1 { end.1 = at + put.len() - 1 }
        }
    }
    made(&lines, a, c)
}
