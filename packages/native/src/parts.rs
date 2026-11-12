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
