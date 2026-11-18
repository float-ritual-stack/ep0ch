//! A change to a text, drawn: the `diff` primitive (outline-core's `DiffPrimitive`), which a proposal's row and a
//! revision's row carry as what they show under themselves. The service found what changed (its `text-diff.ts`):
//! every line comes with what it is (the same, written, taken out, or a run left out and said in words), and this
//! draws them. Nothing here compares two texts: the window never diffs.
use rune::{Color, El, col, row, text};
use rune_kit::Kit;
use serde_json::Value;

use super::prim::PrimCx;
use crate::parts::{self, list};

/// What a line is, as the service says it (`DiffLine.op`): the mark in its gutter, its ink and its ground.
fn look(op: &str, k: &Kit) -> (&'static str, Color, Color) {
    match op {
        "add" => ("+", k.c.success.fg, k.c.success.bg),
        "del" => ("−", k.c.danger.fg, k.c.danger.bg),
        _ => (" ", k.c.text_muted, Color::TRANSPARENT),
    }
}

/// The builder of the `diff` primitive: the two sides named and how many lines each way, then every line in the
/// code face, a mark in its gutter and its ground tinted by what it is. A run the service left out is its words.
pub fn build(prim: &Value, cx: &PrimCx, k: &Kit) -> El {
    let c = &k.c;
    let mut out = col().key(cx.key()).role("group").label("A change, line by line").w_full().radius(k.radius.sm).border(1.0, c.border_muted).fill(c.layer_01);
    // Which two texts, and how much changed: the primitive's own words and counts.
    let sides = [parts::text(prim, "from"), parts::text(prim, "to")].into_iter().flatten().collect::<Vec<_>>().join(" → ");
    let (added, removed) = (prim["added"].as_u64().unwrap_or(0), prim["removed"].as_u64().unwrap_or(0));
    let headed = !sides.is_empty() || added + removed > 0;
    let mut head = row().key(cx.sub("sides")).w_full().gap(8.0).center_y().px(8.0).py(4.0);
    if !sides.is_empty() { head = head.child(text(sides).font(k.ty.small).color(c.text_faint).truncate().grow(1.0).min_w(0.0)) }
    if added > 0 { head = head.child(text(format!("+{added}")).font(k.ty.small).color(c.success.fg)) }
    if removed > 0 { head = head.child(text(format!("−{removed}")).font(k.ty.small).color(c.danger.fg)) }
    if headed { out = out.child(head) }
    for (n, line) in list(prim, "lines").iter().enumerate() {
        let (op, words) = (parts::text(line, "op").unwrap_or("same"), line["text"].as_str().unwrap_or(""));
        if op == "skip" {
            out = out.child(text(words.to_string()).key(cx.sub(format!("line/{n}"))).font(k.ty.small).color(c.text_faint).wrap().px(8.0).py(3.0));
            continue;
        }
        let (mark, ink, ground) = look(op, k);
        out = out.child(row().key(cx.sub(format!("line/{n}"))).role("listitem").label(format!("{op}: {words}")).w_full().gap(6.0).px(8.0).py(1.0).fill(ground)
            .child(text(mark).font(k.ty.mono).color(ink).w(10.0))
            .child(text(words.to_string()).font(k.ty.mono).color(if op == "same" { c.text_muted } else { c.text_base }).wrap().selectable(true).grow(1.0).min_w(0.0)));
    }
    out
}
