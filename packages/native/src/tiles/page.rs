//! The `page` drawer: one note as the service answered it (`notes.page`), drawn by walking its parts through the
//! primitive registry (`prim.rs`): nothing here reads Blockdown, and nothing here knows a figure from a button.
//! Whichever kinds the service's rows give this drawer are tiles it draws.
//!
//! A block is written where it is read: while a draft of the note is on this tile, its source stands in the page
//! in place of what is drawn from it (its title and chips, its parts), in the same column and the same scroll, with
//! the rest of the page around it (the way to it above, the notes under it below). The list that completes what is
//! being typed is drawn over the window at the caret (`over`), the service's rows as it merged them.
use std::hash::{Hash, Hasher};

use rune::{Align, El, ScrollSpec, Side, col, el, row, text};
use rune_kit::{Button, ButtonVariant, Keybind, Kit, PopupItem, PopupList};
use serde_json::{Value, json};

use super::prim::{self, PrimCx};
use super::{Drawer, TileCx};
use super::picture::Shown;
use crate::actions::{self, Actor, App, Field};
use crate::draft::{DraftSession, Hold};
use crate::keys::{self, Layer};
use crate::page::Page;
use crate::parts;
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "page", about: "one note as the service answers it: read, and written in place, a block's source where it stands", notes: true, lists: false, asks, draw, facts, takes_keys: false, version, over: Some(over) };

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.note_of(cx.id).map(|note| ("page", cx.app.page_ask(&note))).into_iter().collect() }

/// The draft written in this tile, when it is of the note the tile shows.
fn draft_of<'a>(cx: &'a TileCx) -> Option<&'a DraftSession> { cx.app.draft_on(cx.id) }

/// How a draft's hold stands, in words: who else can reach it while it is written.
fn held(draft: &DraftSession) -> String {
    match &draft.hold {
        Hold::Held { .. } => "Held on the service: an agent's edit lands here, in front of you, and never in the block you are typing in.".to_string(),
        Hold::Asked => "Asking the service to hold this draft…".to_string(),
        Hold::None => "Not held on the service yet: an agent's edit goes to the saved note.".to_string(),
        Hold::Refused(why) => format!("Not held on the service ({why}): an agent's edit goes to the saved note."),
    }
}

fn facts(cx: &TileCx) -> Value {
    let page = cx.app.shown_of(cx.id);
    let editing = draft_of(cx).map(|draft| {
        let (anchor, caret) = draft.buf.ends();
        let completing = cx.app.completing(cx.id).map(|found| json!({ "token": found.token.as_ref().map(|token| json!({ "kind": token.kind, "query": token.query })), "lit": draft.completing.lit + 1, "heading": found.heading, "message": found.message, "rows": found.rows.iter().map(|row| json!({ "label": row.label, "detail": row.detail, "kind": row.kind, "insert": row.insert })).collect::<Vec<_>>() }));
        json!({ "note": draft.note, "revision": draft.revision, "unsaved": draft.unsaved(), "text": draft.buf.words(), "caret": caret, "anchor": anchor, "held": draft.hold_id().is_some(), "hold": held(draft), "said": draft.told.as_ref().map(|told| json!({ "who": told.who, "did": told.did })), "completing": completing })
    });
    // Its parts, as the service framed them, a box's own after it: what an agent presses a button by (`line`, as
    // `button.press line=` counts: from 1), and reads a component's state from.
    let mut framed: Vec<Value> = Vec::new();
    for part in page.into_iter().flat_map(|p| &p.parts) {
        parts::walk(part, &mut |part| if parts::ty(part) == "part" { framed.push(json!({
            "kind": part["kind"], "line": parts::line_of(part), "name": part["name"], "title": part["title"], "error": part["error"], "draws": parts::ty(&part["view"]), "label": part["view"]["label"],
        })) });
    }
    json!({ "note": cx.app.note_of(cx.id), "title": page.map(|p| p.title.clone()), "revision": page.map(|p| p.revision), "loading": cx.app.loading_of(cx.id), "editing": editing, "back": cx.ui.history, "parts": framed, "said": cx.ui.said.as_ref().map(|said| &said.words) })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.note, cx.ui.history.len(), cx.app.loading_of(cx.id), cx.ui.said.as_ref().map(|said| (&said.block, said.line, &said.words))).hash(&mut h);
    if let Some(draft) = draft_of(cx) { (&draft.note, draft.revision, draft.unsaved(), cx.app.saving(), &draft.buf, draft.changes, held(draft), draft.told.as_ref().map(|told| (&told.who, &told.did))).hash(&mut h) }
    // A picture that finished decoding is drawn: how each of the page's pictures stands is part of what is shown.
    for picture in cx.app.shown_of(cx.id).into_iter().flat_map(|page| page.pictures()) {
        match cx.app.picture(picture) { Some(Shown::Ready { image, .. }) => (2u8, image.size().is_some()).hash(&mut h), Some(Shown::Failed(why)) => (1u8, why).hash(&mut h), _ => 0u8.hash(&mut h) }
    }
    h.finish()
}

/// A button for an act line run in this tile: its label is the action's, its keycap the key table's.
fn button(cx: &TileCx, line: &str, variant: ButtonVariant) -> Button {
    let b = Button::new(actions::label(line)).variant(variant).on_press(cx.act(line));
    match keys::cap(line) { Some(cap) => b.shortcut(cap), None => b }
}

/// The page, walked: what stands above its parts, each part, what stands under them, every one a primitive built
/// by its type (`prim.rs`). Nothing here knows what a part is. While the note is being written here, its source
/// stands where what is drawn from it would: in place of its parts, and of what the page makes of its own first
/// line (a primitive that says `source`).
fn walked(cx: &TileCx, page: Option<&Page>, draft: Option<&DraftSession>, k: &Kit) -> El {
    let at = PrimCx::of(cx);
    let mut body = col().key(cx.key("note")).w_full().max_w(820.0).padding(24.0).gap(14.0);
    let (mut head, mut foot) = (Vec::new(), Vec::new());
    if let Some(page) = page { (head, foot) = parts::around(page) }
    for prim in head.iter().filter(|prim| draft.is_none() || prim["source"] != true) { body = body.child(prim::build(prim, &at, k)) }
    match (draft, page) {
        (Some(draft), _) => body = body.child(editor(cx, draft, k)),
        (None, Some(page)) => for (i, part) in page.parts.iter().enumerate() { body = body.child(prim::build(part, &at.at(format!("part/{i}")), k)) },
        (None, None) => {}
    }
    for prim in &foot { body = body.child(prim::build(prim, &at, k)) }
    // The tile's note is on its way: the last one stays, dimmed, so the tile never blanks.
    let opacity = if cx.app.loading_of(cx.id) && draft.is_none() { 0.55 } else { 1.0 };
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(row().w_full().justify_center().child(body.opacity(opacity))))
}

fn empty(cx: &TileCx, k: &Kit) -> El {
    let cap = |line: &str| keys::cap(line).unwrap_or_else(|| actions::label(line));
    let said = if cx.app.loading_of(cx.id) || (cx.app.online && cx.app.machine.is_empty()) { "Calling the outline…".to_string() } else if cx.app.note_of(cx.id).is_none() { format!("Nothing here yet. {} starts a note.", cap("note.new")) } else { format!("Pick a note, or find one with {}.", cap("bar.open")) };
    col().key(cx.key("empty")).w_full().h_full().center().gap(12.0).padding(28.0).child(text(said).font(k.ty.body).color(k.c.text_muted))
}

/// The block's Blockdown source where the block stands: what was read is what a save sends back. The field grows
/// with its text and has no scroll of its own, so the page's scroll is the one that follows the caret.
fn editor(cx: &TileCx, draft: &DraftSession, k: &Kit) -> El {
    let c = &k.c;
    let (saving, unsaved) = (cx.app.saving(), draft.unsaved());
    let field = keys::area(&draft.buf, Field::Draft(cx.id.to_string()), draft.lit(), c.info.bg)
        .label("Block source")
        .placeholder("Title [key::value]\nThen the note, in Blockdown.")
        .width(None)
        .rows(4)
        .build(k)
        .key(cx.key("source"));
    // Leaving is its own act: Done when everything is saved, Discard (by name) when it isn't.
    let buttons = row().gap(6.0).center_y()
        .child(if unsaved { button(cx, "edit.close discard=true", ButtonVariant::Ghost).build(k).key(cx.key("discard")) } else { button(cx, "edit.close", ButtonVariant::Ghost).build(k).key(cx.key("done")) })
        .child(button(cx, "edit.save", ButtonVariant::Contrast).disabled(saving || !unsaved).build(k).key(cx.key("save")));
    // What somebody else last did to the text, by name, then how the draft is held.
    let told = draft.told.as_ref().map(|told| text(told.line()).key(cx.key("told")).font(k.ty.small).color(c.info.fg).wrap());
    let status = col().grow(1.0).min_w(0.0).gap(2.0)
        .children(told)
        .child(text(held(draft)).key(cx.key("held")).font(k.ty.small).color(c.text_faint).wrap());
    // What the editor's own keys do, from the table: the save that keeps you here, the Esc that leaves.
    let hints = keys::bind_of("edit.save").map(|bind| (bind.cap(), bind.does)).into_iter().chain(keys::hints(Layer::Draft)).fold(row().key(cx.key("editor-keys")).w_full().gap(12.0).flex_wrap(), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(c.text_faint)))
    });
    col().key(cx.key("editor")).w_full().gap(8.0)
        .child(field)
        .child(row().w_full().gap(10.0).child(status).child(buttons))
        .child(hints)
}

fn draw(cx: &TileCx, k: &Kit) -> El {
    let draft = draft_of(cx);
    match (cx.app.shown_of(cx.id), draft) {
        (None, None) => empty(cx, k),
        (page, draft) => walked(cx, page, draft, k),
    }
}

/// The list that completes what is being typed in this tile's draft, over the window at the caret: the service's
/// rows, the lit one marked, a press on one writing it. It takes no keys: they stay in the field, and the list's
/// own (the next row, the one before, write it, put it away) are the key table's rows for it.
fn over(cx: &TileCx, caret: Option<[f32; 4]>, k: &Kit, layer: &mut Vec<El>) {
    let (Some(draft), Some(found)) = (draft_of(cx), cx.app.completing(cx.id)) else { return };
    if !cx.focused { return }
    // Where the list hangs: a mark at the caret, when the window has drawn one; else the field.
    let anchor = match caret {
        Some([x, y, w, h]) => { layer.push(el().key(cx.key("caret")).absolute(x, y).w(w.max(1.0)).h(h)); cx.key("caret") }
        None => cx.key("source"),
    };
    let from = cx.name.clone();
    let items: Vec<PopupItem> = found.rows.iter().enumerate().map(|(n, row)| {
        let detail = [row.detail.as_deref(), row.kind.as_deref()].into_iter().flatten().collect::<Vec<_>>().join(" · ");
        PopupItem::new((n + 1).to_string(), row.label.clone()).description(detail)
    }).collect();
    PopupList::<App>::new(cx.key("complete"), anchor.clone())
        .anchored(anchor, Side::Bottom, Align::Start, 4.0)
        .width(420.0)
        .label(found.heading.clone().unwrap_or_default())
        .empty_message(found.message.clone().unwrap_or_default())
        .active(Some(draft.completing.lit).filter(|_| !found.rows.is_empty()))
        .items(items)
        .on_choose(move |s: &mut App, row, _| { s.act_in(&format!("complete.accept n={row}"), &from, Actor::Person); })
        .build(k, layer);
}
