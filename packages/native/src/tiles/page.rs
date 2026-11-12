//! The `page` drawer: one note as the service answered it (`notes.page`), drawn by walking its parts through the
//! primitive registry (`prim.rs`): nothing here reads Blockdown, and nothing here knows a figure from a button. The reader tile is its one kind today, and
//! the note's source in the editor is drawn here while the draft is on this tile.
use std::hash::{Hash, Hasher};

use rune::{El, ScrollSpec, col, row, text};
use rune_kit::{Button, ButtonVariant, Keybind, Kit};
use serde_json::{Value, json};

use super::prim::{self, PrimCx};
use super::{Drawer, TileCx};
use crate::actions::{self, Field, Shown};
use crate::keys::{self, Layer};
use crate::page::{NoteRow, Page};
use crate::parts;
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "page", asks, draw, facts, takes_keys: false, version };

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.note_of(cx.id).map(|note| ("page", cx.app.page_ask(&note))).into_iter().collect() }

fn facts(cx: &TileCx) -> Value {
    let page = cx.app.shown_of(cx.id);
    let editing = cx.app.editing.as_ref().filter(|e| e.tile == cx.id).map(|e| json!({ "note": e.note, "revision": e.revision, "unsaved": cx.app.unsaved() }));
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
    if let Some(e) = cx.app.editing.as_ref().filter(|e| e.tile == cx.id) { (&e.note, e.revision, cx.app.unsaved(), cx.app.saving(), &cx.app.editor).hash(&mut h) }
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

/// A note in a list (a child, a backlink): press to open. The registry's own row.
pub(super) fn link_row(cx: &TileCx, r: &NoteRow, scope: &str, k: &Kit) -> El {
    prim::line(cx, if r.title.is_empty() { "untitled" } else { &r.title }, Some(&r.id), Vec::new(), (!r.context.is_empty()).then_some(r.context.as_str()), cx.key(format!("{scope}/{}", r.id)), k)
}

/// The page, walked: what stands above its parts, each part, what stands under them, every one a primitive built
/// by its type (`prim.rs`). Nothing here knows what a part is.
fn walked(cx: &TileCx, page: &Page, k: &Kit) -> El {
    let at = PrimCx::of(cx);
    let (head, foot) = parts::around(page);
    let mut body = col().key(cx.key("note")).w_full().max_w(820.0).padding(24.0).gap(14.0);
    for prim in &head { body = body.child(prim::build(prim, &at, k)) }
    for (i, part) in page.parts.iter().enumerate() { body = body.child(prim::build(part, &at.at(format!("part/{i}")), k)) }
    for prim in &foot { body = body.child(prim::build(prim, &at, k)) }
    // The tile's note is on its way: the last one stays, dimmed, so the tile never blanks.
    let opacity = if cx.app.loading_of(cx.id) { 0.55 } else { 1.0 };
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(row().w_full().justify_center().child(body.opacity(opacity))))
}

fn empty(cx: &TileCx, k: &Kit) -> El {
    let cap = |line: &str| keys::cap(line).unwrap_or_else(|| actions::label(line));
    let said = if cx.app.loading_of(cx.id) || (cx.app.online && cx.app.machine.is_empty()) { "Calling the outline…".to_string() } else if cx.app.note_of(cx.id).is_none() { format!("Nothing here yet. {} starts a note.", cap("note.new")) } else { format!("Pick a note, or find one with {}.", cap("bar.open")) };
    col().key(cx.key("empty")).w_full().h_full().center().gap(12.0).padding(28.0).child(text(said).font(k.ty.body).color(k.c.text_muted))
}

/// The note's Blockdown source in one text area: what was read is what a save sends back.
fn editor(cx: &TileCx, k: &Kit) -> El {
    let s = cx.app;
    let (saving, unsaved) = (s.saving(), s.unsaved());
    // Leaving is its own act: Done when everything is saved, Discard (by name) when it isn't.
    let buttons = row().w_full().gap(6.0).center_y().justify_end()
        .child(if unsaved { button(cx, "edit.close discard=true", ButtonVariant::Ghost).build(k).key(cx.key("discard")) } else { button(cx, "edit.close", ButtonVariant::Ghost).build(k).key(cx.key("done")) })
        .child(button(cx, "edit.save", ButtonVariant::Contrast).disabled(saving || !unsaved).build(k).key(cx.key("save")));
    // What the editor's own keys do, from the table: the save that keeps you here, the Esc that leaves.
    let hints = keys::bind_of("edit.save").map(|bind| (bind.cap(), bind.does)).into_iter().chain(keys::hints(Layer::Draft)).fold(row().key(cx.key("editor-keys")).w_full().gap(12.0).flex_wrap(), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(k.c.text_faint)))
    });
    col().key(cx.key("editor")).w_full().h_full().min_h(0.0).padding(16.0).gap(10.0)
        .child(buttons)
        .child(
            k.scroll_bar(
                col().key(cx.key("editor-scroll")).w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(
                    keys::area(&s.editor, Field::Draft)
                        .label("Note source")
                        .placeholder("Title [key::value]\nThen the note, in Blockdown.")
                        .width(None)
                        .auto_grow(16, 4000)
                        .build(k)
                        .key(cx.key("source")),
                ),
            ),
        )
        .child(hints)
}

fn draw(cx: &TileCx, k: &Kit) -> El {
    if cx.app.editing.as_ref().is_some_and(|e| e.tile == cx.id) { return editor(cx, k) }
    match cx.app.shown_of(cx.id) { Some(page) => walked(cx, page, k), None => empty(cx, k) }
}
