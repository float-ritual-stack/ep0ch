//! A page as primitives: what a drawer walks, and what a press finds. No Rune here: a second renderer draws the
//! same walk with builders of its own.
//!
//! - **A primitive is data**: an object with a `type` (outline-core's primitive.ts and note-page.ts; the list is
//!   `outline-core/fixtures/primitives.json`). The service answers a note's body as `part` primitives, each a frame
//!   (the note it is in, its line, the service's word on its answer) around the primitive to draw.
//! - **The page's own head and foot are primitives too**, made here from the page's fields: its header image, the
//!   notes above it, its title beside the act line that edits it, its chips as presses, the notes under it. So a
//!   drawer has one thing to do with a page: build each primitive by its type.
//! - **A press is the act line the primitive carries** (`act`), and nothing else: the service says what a pick of a
//!   row, a card, a cell or a text runs, by the one rule (outline-core's `actOf`, stamped by `withActs`). Nothing
//!   here reads an activation (`do`, `link`) or writes a line for one.
use serde_json::{Value, json};

use crate::actions::{self, word};
use crate::page::Page;

/// A primitive's type, or `""` for a value that is none.
pub fn ty(prim: &Value) -> &str { prim["type"].as_str().unwrap_or("") }
pub fn text<'a>(prim: &'a Value, key: &str) -> Option<&'a str> { prim[key].as_str().filter(|s| !s.is_empty()) }
/// A list field (`children`, `rows`, `items`), empty when the primitive has none.
pub fn list<'a>(prim: &'a Value, key: &str) -> &'a [Value] { prim[key].as_array().map_or(&[], Vec::as_slice) }
/// A value's words: text as it is, a number as written, an object by its `text`.
pub fn words(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Object(o) => o.get("text").map(words).unwrap_or_default(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Every primitive under `prim`, itself first: a part's view, and whatever holds children.
pub fn walk<'a>(prim: &'a Value, f: &mut dyn FnMut(&'a Value)) {
    f(prim);
    if prim["view"].is_object() { walk(&prim["view"], f) }
    for child in list(prim, "children") { walk(child, f) }
}

/// What a press on a row or a primitive runs: the act line it carries, as the service wrote it.
pub fn act(v: &Value) -> Option<&str> { text(v, "act") }

/// What the page draws above its parts and under them, as primitives: the header image, the notes above, the title
/// beside its edit, the chips (each a query for the notes that carry it); then the notes under it, the list the
/// service answered them as (`under`: its rows are the service's, as any list's). `key` is the element key each is
/// found under.
pub fn around(page: &Page) -> (Vec<Value>, Vec<Value>) {
    let mut head = Vec::new();
    if let Some(hero) = &page.hero {
        let mut band = json!({ "type": "picture", "key": "hero", "band": true, "path": hero.path, "svg": hero.svg, "alt": hero.alt, "width": hero.width, "height": hero.height, "fit": hero.fit, "dim": hero.dim });
        band.as_object_mut().unwrap().retain(|_, v| !v.is_null());
        head.push(band);
    }
    if !page.ancestors.is_empty() {
        head.push(json!({ "type": "text", "key": "path", "tone": "dim", "text": page.ancestors.iter().map(|a| a.title.as_str()).collect::<Vec<_>>().join(" › ") }));
    }
    // (The title and the chips are drawn from the block's own first line: `source` says so, and the block's source
    // stands in their place while it is written.)
    head.push(json!({ "type": "row", "key": "head", "source": true, "children": [
        { "type": "band", "key": "title", "level": 1, "text": page.title },
        { "type": "button", "key": "edit", "label": actions::label("edit"), "act": "edit" },
    ] }));
    if !page.chips.is_empty() {
        head.push(json!({ "type": "row", "key": "chips", "source": true, "minWidth": 0, "children": page.chips.iter().map(|chip| json!({
            "type": "badge", "key": format!("chip/{}/{}", chip.key, chip.value), "label": format!("{} · {}", chip.key, chip.value),
            "act": format!("bar.narrow key={} value={}", word(&chip.key), word(&chip.value)),
        })).collect::<Vec<_>>() }));
    }
    let mut foot = Vec::new();
    if let Some(under) = page.under.as_ref().filter(|under| under.is_object()) {
        let mut list = under.clone();
        list["key"] = json!("child");
        foot.push(list);
    }
    (head, foot)
}

/// Where a part is written in its note's text (UTF-16 offsets), as the service framed it; none for a part that
/// says no span of words.
pub fn span_of(part: &Value) -> Option<(u64, u64)> {
    part["span"]["start"].as_u64().zip(part["span"]["end"].as_u64()).filter(|(start, end)| end > start)
}

/// An anchor: a place on drawn text that other things attach to (outline-core's part-anchor.ts). A part of a page,
/// by the line of its note it starts on, and a range of the text its view is drawn from (UTF-16, as the wire counts;
/// none: the part whole). The service finds it; nothing here, and nothing that draws, reads a note's source for one.
#[derive(Clone, Debug, PartialEq)]
pub struct Anchor {
    pub part: u64,
    pub range: Option<(usize, usize)>,
}

/// Something attached at an anchor, as the service says it on the part (`marks`): what it is, the thing by its id,
/// the act a press on its words runs, and the list whose row by that id is the thing (`lists.read from=`, of the
/// part's note). A comment thread's passage is the first; a proposal's passage and a range somebody just wrote attach
/// the same way.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub at: Anchor,
    pub kind: String,
    pub id: String,
    pub act: Option<String>,
    pub from: Option<String>,
}

/// What is attached to one part's own words, in the order the service lists it.
pub fn marks(part: &Value) -> Vec<Mark> {
    let Some(line) = part["line"].as_u64() else { return Vec::new() };
    list(part, "marks").iter().filter_map(|mark| Some(Mark {
        at: Anchor { part: line, range: mark["start"].as_u64().zip(mark["end"].as_u64()).filter(|(start, end)| end > start).map(|(start, end)| (start as usize, end as usize)) },
        kind: text(mark, "kind")?.to_string(), id: text(mark, "id")?.to_string(), act: text(mark, "act").map(str::to_string), from: text(mark, "from").map(str::to_string),
    })).collect()
}

/// Everything attached to a part's words and to the words of the parts written inside it (a box's), each thing
/// once, in order: what stands beside that part on a page.
pub fn marks_under(part: &Value) -> Vec<Mark> {
    let mut found: Vec<Mark> = Vec::new();
    walk(part, &mut |prim| if ty(prim) == "part" { for mark in marks(prim) { if !found.iter().any(|seen| seen.id == mark.id && seen.kind == mark.kind) { found.push(mark) } } });
    found
}

/// An anchor's range as the lines of `text` it covers, in bytes: one range a line, blank ends left out. A renderer
/// marks each where it draws that line, so a range across two paragraphs or two list items is a mark on each.
pub fn lines_of(text: &str, range: (usize, usize)) -> Vec<std::ops::Range<usize>> {
    let (Some(start), Some(end)) = (crate::draft::byte_of(text, range.0), crate::draft::byte_of(text, range.1)) else { return Vec::new() };
    let mut out = Vec::new();
    let mut at = start;
    for line in text[start..end].split('\n') {
        let (from, to) = (at + (line.len() - line.trim_start().len()), at + line.trim_end().len());
        if to > from { out.push(from..to) }
        at += line.len() + 1;
    }
    out
}

/// The part of a page, by its place among the page's own, that holds `end` of the note's text: an end of a passage,
/// so the part whose span it is in or closes. Where something written about that passage stands.
pub fn part_holding(page: &Page, end: usize) -> Option<usize> {
    page.parts.iter().position(|part| span_of(part).is_some_and(|(from, to)| (from as usize) < end && end <= to as usize))
}

/// The part of a page, by its place among the page's own, that carries the mark of a thing (or holds the part that
/// does): where something written about that thing stands.
pub fn part_marked(page: &Page, id: &str) -> Option<usize> { page.parts.iter().position(|part| marks_under(part).iter().any(|mark| mark.id == id)) }

/// The line a press names a part by: as the door's `button.press line=` counts, from 1 (the wire's `line` is from 0).
pub fn line_of(part: &Value) -> Option<u64> { part["line"].as_u64().map(|n| n + 1) }

/// The button a press names on a page: by the line it is written on (the wire's, from 0), else by what it says. The
/// part, whole. What it says back names lines as a press does, from 1 (`line_of`).
pub fn button<'a>(page: &'a Page, line: Option<u64>, label: Option<&str>) -> Result<&'a Value, String> {
    let mut found: Vec<&Value> = Vec::new();
    for part in &page.parts {
        walk(part, &mut |prim| {
            let view = &prim["view"];
            if ty(prim) == "part" && ty(view) == "button" && line.is_none_or(|n| prim["line"].as_u64() == Some(n)) && label.is_none_or(|l| view["label"] == l) { found.push(prim) }
        });
    }
    let named = match (line, label) { (Some(n), _) => format!("on line {}", n + 1), (None, Some(l)) => format!("labelled {l}"), (None, None) => "here".to_string() };
    match found.as_slice() {
        [one] => Ok(one),
        [] => Err(format!("no button {named} in this note · peek lists its parts")),
        many => Err(format!("{} buttons {named}: name one by line= ({})", many.len(), many.iter().filter_map(|part| line_of(part)).map(|n| n.to_string()).collect::<Vec<_>>().join(", "))),
    }
}
