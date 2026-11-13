//! The `page` drawer: one note as the service answered it (`notes.page`), drawn by walking its parts through the
//! primitive registry (`prim.rs`): nothing here reads Blockdown, and nothing here knows a figure from a button.
//! Whichever kinds the service's rows give this drawer are tiles it draws.
//!
//! A block is written where it is read: while a draft of the note is on this tile, its source stands in the page
//! in place of what is drawn from it (its title and chips, its parts), in the same column and the same scroll, with
//! the rest of the page around it (the way to it above, the notes under it below). The list that completes what is
//! being typed is drawn over the window at the caret (`over`), the service's rows as it merged them.
//!
//! What is written about the note (a comment, a reply) is written where its words are too: its field stands in the
//! page under the part that holds the passage's end, or carries its thread's mark, and at the top for the whole
//! note. Words picked in the note have their own actions by them, under the same part: the key table's rows for
//! where the keys are then, each a button its row labels.
//!
//! What is attached to the note's words (`parts::Mark`: a comment thread's passage) is beside them: the words are
//! tinted where they are drawn (`prim.rs`), and the thing itself is the row of the list the mark names, drawn by the
//! list drawer as a card, in a margin when the tile is wide enough for one, else under the part. Folded, a card is
//! the row's line; a press on it, or on the words, shows it whole (`thread.toggle`, the mark's own act).
use std::hash::{Hash, Hasher};

use rune::{Align, El, ScrollSpec, Side, col, el, row, text};
use rune_kit::{Button, ButtonVariant, Keybind, Kit, PopupItem, PopupList};
use serde_json::{Value, json};

use super::prim::{self, PrimCx};
use super::{Drawer, TileCx};
use super::picture::Shown;
use crate::actions::{self, Actor, App, Field};
use crate::draft::{DraftSession, Hold};
use crate::keys;
use crate::page::Page;
use crate::parts;
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "page", about: "one note as the service answers it: read, and written in place, a block's source where it stands", notes: true, lists: false, asks, draw, facts, takes_keys: false, version, over: Some(over) };

/// What its tile reads: the note's page, and the lists the things attached to that page's words are rows of.
fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> {
    cx.app.note_of(cx.id).map(|note| ("page", cx.app.page_ask(&note))).into_iter().chain(cx.app.beside_asks(cx.id).into_iter().map(|ask| ("beside", ask))).collect()
}

/// The draft written in this tile, when it is of the note the tile shows.
fn draft_of<'a>(cx: &'a TileCx) -> Option<&'a DraftSession> { cx.app.draft_on(cx.id) }

/// How a draft's hold stands, in words: who else can reach it while it is written. (A comment or a reply is held
/// by nobody: it is nobody else's to change.)
fn held(draft: &DraftSession) -> String {
    if !draft.is_block() { return String::new() }
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
        json!({ "note": draft.note, "writes": draft.writes.kind(), "on": draft.writes.on(), "revision": draft.revision, "unsaved": draft.unsaved(), "text": draft.buf.words(), "caret": caret, "anchor": anchor, "held": draft.hold_id().is_some(), "hold": held(draft), "said": draft.told.as_ref().map(|told| json!({ "who": told.who, "did": told.did })), "completing": completing })
    });
    // Its parts, as the service framed them, a box's own after it: what an agent presses a button by (`line`, as
    // `button.press line=` counts: from 1), and reads a component's state from.
    let mut framed: Vec<Value> = Vec::new();
    for part in page.into_iter().flat_map(|p| &p.parts) {
        parts::walk(part, &mut |part| if parts::ty(part) == "part" { framed.push(json!({
            "kind": part["kind"], "line": parts::line_of(part), "name": part["name"], "title": part["title"], "error": part["error"], "draws": parts::ty(&part["view"]), "label": part["view"]["label"],
        })) });
    }
    // What is attached to its words, each as the service marked it, with whether its card is shown whole and whether
    // the row it is has come; and the words picked in it, with what the service said of them.
    let marked: Vec<Value> = page.into_iter().flat_map(|p| &p.parts).flat_map(parts::marks_under).map(|mark| json!({
        "kind": mark.kind, "id": mark.id, "part": mark.at.part + 1, "range": mark.at.range.map(|(start, end)| json!([start, end])), "act": mark.act, "from": mark.from,
        "whole": cx.ui.unfolded.contains(&mark.id), "says": cx.app.attached_row(cx.id, &mark).map(|row| &row.label),
    })).collect();
    let picked = cx.ui.passage.as_ref().map(|quoted| json!({ "words": quoted.words, "found": quoted.found.as_ref().and_then(|found| found.as_ref().ok()).map(|(start, end)| json!([start, end])), "refused": quoted.refused() }));
    json!({ "note": cx.app.note_of(cx.id), "title": page.map(|p| p.title.clone()), "revision": page.map(|p| p.revision), "loading": cx.app.loading_of(cx.id), "editing": editing, "back": cx.ui.history, "parts": framed, "marks": marked, "picked": picked, "said": cx.ui.said.as_ref().map(|said| &said.words) })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.note, cx.ui.history.len(), cx.app.loading_of(cx.id), cx.ui.said.as_ref().map(|said| (&said.block, said.line, &said.words))).hash(&mut h);
    // The cards shown whole, and the words picked (their actions stand by them, where the service found them).
    (&cx.ui.unfolded, cx.ui.passage.as_ref().map(|quoted| (&quoted.words, quoted.ends_at()))).hash(&mut h);
    // (The hint row says the keys of the layer they are in: the editor's, or the open list's.)
    if let Some(draft) = draft_of(cx) { (draft.writes.quoted().map(|quoted| (quoted.ends_at(), quoted.stands_at(), quoted.refused().map(str::to_string))), &draft.note, draft.writes.kind(), draft.writes.on(), draft.revision, draft.unsaved(), cx.app.saving(), &draft.buf, draft.changes, held(draft), draft.told.as_ref().map(|told| (&told.who, &told.did)), cx.app.writing(cx.id).name()).hash(&mut h) }
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
/// line (a primitive that says `source`). A comment or a reply being written here is the same field over the
/// note, which stays as it reads. Words selected in the note are told to the window as they are drawn, with where
/// the service says the parts they were selected in are written (`passage.select`).
fn walked(cx: &TileCx, page: Option<&Page>, draft: Option<&DraftSession>, k: &Kit) -> El {
    let at = PrimCx::of(cx);
    let from = cx.name.clone();
    // Each part's span of the note's text, as its frame says it, by the part's place: what a selection is within.
    let (parts, spans) = (format!("/{}", cx.key("part/")), page.map(|page| page.parts.iter().map(parts::span_of).collect::<Vec<_>>()).unwrap_or_default());
    // A page with something attached to its words has a margin beside its measure for what that is.
    let margin = page.is_some_and(|page| page.parts.iter().any(|part| !parts::marks_under(part).is_empty()));
    // Whether the tile has room for it: read off the tile's own width as it was last laid out, and drawn again only
    // when that crosses the line (a resize that doesn't, draws nothing again).
    let roomy = margin && rune::memo::layout_with(&cx.key("scroll"), |at| at[2] >= MEASURE_LEAST + GUTTER + MARGIN_LEAST + 2.0 * PAD).unwrap_or(false);
    let mut body = col().key(cx.key("note")).w_full().max_w(if roomy { MEASURE + GUTTER + MARGIN + 2.0 * PAD } else { MEASURE + 2.0 * PAD }).padding(PAD).gap(14.0)
        .on_selection_change(move |s: &mut App, change: &rune::SelectionChange, _| if !change.dragging() { s.act_in(&selected(change, &parts, &spans), &from, Actor::Person); });
    let (mut head, mut foot) = (Vec::new(), Vec::new());
    if let Some(page) = page { (head, foot) = parts::around(page) }
    // The block's own text being written, or something else written about it.
    let (own, aside) = (draft.filter(|draft| draft.is_block()), draft.filter(|draft| !draft.is_block()));
    // Where what is written about the note stands: under the part that holds the end of the words a comment is on,
    // or that carries the mark of the thread a reply answers; over the note when it is on the whole of it (or the
    // service hasn't said where its words are). Words picked have their own actions at the same place.
    let under = aside.zip(page).and_then(|(draft, page)| draft.writes.ends_at().and_then(|end| parts::part_holding(page, end)).or_else(|| draft.writes.answers().and_then(|thread| parts::part_marked(page, thread))));
    let picked = cx.ui.passage.as_ref().filter(|_| draft.is_none()).zip(page).and_then(|(quoted, page)| quoted.ends_at().and_then(|end| parts::part_holding(page, end)));
    let held = |built: El| if margin { el().w_full().max_w(MEASURE).child(built) } else { built };
    for prim in head.iter().filter(|prim| own.is_none() || prim["source"] != true) { body = body.child(held(prim::build(prim, &at, k))) }
    if let Some(aside) = aside.filter(|_| under.is_none()) { body = body.child(held(editor(cx, aside, k))) }
    match (own, page) {
        (Some(draft), _) => body = body.child(held(editor(cx, draft, k))),
        (None, Some(page)) => for (i, part) in page.parts.iter().enumerate() {
            // What is written about words of this part stands in it, under the block they end in, when the
            // service said where they are in the part's own text (a part is as long as its run of prose) and
            // the text can be cut there: handed to the part's builder with it. Else under the part whole.
            let written = aside.filter(|_| under == Some(i));
            let field = || written.map(|draft| editor(cx, draft, k));
            let inset = written.and_then(|draft| draft.writes.stands_at()).filter(|(line, _)| parts::line_of(part) == Some(line + 1)).and_then(|(_, place)| prim::inset(part, place, &field));
            let here = at.at(format!("part/{i}"));
            let built = prim::build(part, &match &inset { Some(inset) => here.taking(inset), None => here }, k);
            body = body.child(beside(cx, part, built, margin, roomy, k));
            if inset.is_none() && let Some(field) = field() { body = body.child(held(field)) }
            if picked == Some(i) { body = body.children(offered(cx, k).map(&held)) }
        },
        (None, None) => {}
    }
    for prim in &foot { body = body.child(held(prim::build(prim, &at, k))) }
    // The tile's note is on its way: the last one stays, dimmed, so the tile never blanks.
    let opacity = if cx.app.loading_of(cx.id) && draft.is_none() { 0.55 } else { 1.0 };
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(row().w_full().justify_center().child(body.opacity(opacity))))
}

/// The reading measure, the room around it, and the margin beside it for what is attached to the words, in points.
const MEASURE: f32 = 772.0;
const PAD: f32 = 24.0;
const GUTTER: f32 = 16.0;
const MARGIN: f32 = 300.0;
/// The narrowest a part is drawn beside its margin, and the narrowest the margin is: in a tile with less room than
/// both, the margin's cards go under their parts.
const MEASURE_LEAST: f32 = 440.0;
const MARGIN_LEAST: f32 = 220.0;

/// A part of the page with what is attached to its words beside it: on a page with a margin, the part at its
/// measure and its cards in the margin when the tile is wide enough for both (`roomy`), else under the part, which
/// keeps the tile's whole width. A page with nothing attached is drawn as it always was.
fn beside(cx: &TileCx, part: &Value, built: El, margin: bool, roomy: bool, k: &Kit) -> El {
    if !margin { return built }
    let cards: Vec<El> = parts::marks_under(part).iter().filter_map(|mark| card(cx, mark, k)).collect();
    let held = el().w_full().max_w(MEASURE).child(built);
    if cards.is_empty() { return held }
    if roomy {
        row().w_full().gap(GUTTER).items_start()
            .child(el().grow(4.0).min_w(0.0).max_w(MEASURE).child(held))
            .child(cards.into_iter().fold(col().grow(1.0).min_w(MARGIN_LEAST).max_w(MARGIN).gap(8.0), El::child))
    } else {
        cards.into_iter().fold(col().w_full().max_w(MEASURE).gap(8.0).child(held), El::child)
    }
}

/// What is attached to words, beside them: the row of the list the mark names (a thread's), drawn by the list
/// drawer as a card. Folded it is the row's line and detail; shown whole (`TileUi.unfolded`, by the mark's own act)
/// it is the row with what it shows under itself and its own presses. A row that hasn't come is nothing yet.
fn card(cx: &TileCx, mark: &parts::Mark, k: &Kit) -> Option<El> {
    let listed = cx.app.attached_row(cx.id, mark)?;
    let whole = cx.ui.unfolded.contains(&mark.id);
    Some(col().key(cx.key(format!("card/{}", mark.id))).role("note").label(listed.label.clone()).w_full().radius(k.radius.md).fill(k.c.layer_01).border(1.0, if whole { k.alpha(k.c.warning.icon, 0.7) } else { k.c.border_muted })
        .child(super::list::card(cx, listed, "margin", mark.act.as_deref(), whole, k)))
}

/// The picked words' own actions, by them: the key table's rows for where the keys are while words are picked
/// (`App::offered`), each a button its row labels and caps. A press on one leaves the selection as it is,
/// so the action finds the words it is for. None while no such row is bound.
fn offered(cx: &TileCx, k: &Kit) -> Option<El> {
    let lines = cx.app.offered(cx.id);
    if lines.is_empty() { return None }
    Some(lines.into_iter().fold(row().key(cx.key("picked")).w_full().gap(6.0).center_y().flex_wrap().keeps_text_selection(), |offered, line| {
        offered.child(button(cx, line, ButtonVariant::Outline).build(k).key(cx.key(format!("picked/{line}"))))
    }))
}

/// The act line a selection in the note says: the words selected, as copying takes them, and the span of the note's
/// text they were drawn within (from where the first part selected in starts to where the last one ends, when the
/// service said where both are written); no words when it is cleared. `parts`: the key every part is built under.
fn selected(change: &rune::SelectionChange, parts: &str, spans: &[Option<(u64, u64)>]) -> String {
    let Some(selection) = change.selection().filter(|selection| !selection.text().trim().is_empty()) else { return "passage.select".to_string() };
    // The part a selected text is in, by its place: read off the key the part was built under (`part/<n>`).
    let part = |text: &rune::SelectedText| -> Option<(u64, u64)> {
        let rest = &text.path()[text.path().find(parts)? + parts.len()..];
        spans.get(rest[..rest.find('/').unwrap_or(rest.len())].parse::<usize>().ok()?).copied().flatten()
    };
    let chosen: Vec<&rune::SelectedText> = selection.texts().iter().filter(|text| text.is_selected()).collect();
    let within = chosen.first().and_then(|first| part(first)).zip(chosen.last().and_then(|last| part(last))).filter(|(first, last)| last.1 > first.0);
    let quote = actions::word(selection.text());
    match within {
        Some((first, last)) => format!("passage.select quote={quote} from={} to={}", first.0, last.1),
        None => format!("passage.select quote={quote}"),
    }
}

/// A reader with no page to draw. Told no note, it is empty and says so in its kind's own words (`tiles::waiting`),
/// with the ways to give it a note under them, each a button its action's row labels and the key table caps; told
/// one whose page is on its way (or with the outline still being called), that.
fn empty(cx: &TileCx, k: &Kit) -> El {
    let calling = cx.app.loading_of(cx.id) || (cx.app.online && cx.app.machine.is_empty());
    if !calling && cx.app.note_of(cx.id).is_none() {
        let ways = row().key(cx.key("empty/ways")).gap(8.0).center_y()
            .child(button(cx, "bar.open", ButtonVariant::Ghost).build(k).key(cx.key("empty/find")))
            .child(button(cx, "note.new", ButtonVariant::Ghost).build(k).key(cx.key("empty/new")));
        return super::waiting(cx, Some(ways), k);
    }
    col().key(cx.key("empty")).w_full().h_full().center().gap(12.0).padding(28.0).child(text(if calling { "Calling the outline…" } else { "Offline: the note isn't read yet." }).font(k.ty.body).color(k.c.text_muted))
}

/// What is being written in this tile, in its one field: a block's Blockdown source where the block stands (what
/// was read is what a save sends back), or a comment or a reply over the note it is about, under what it is on.
/// The field's name and its words while empty are the draft's own (`Writes::named`). It grows with its text and has
/// no scroll of its own, so the page's scroll is the one that follows the caret.
fn editor(cx: &TileCx, draft: &DraftSession, k: &Kit) -> El {
    let c = &k.c;
    let (saving, unsaved) = (cx.app.saving(), draft.unsaved());
    let (name, hint) = draft.writes.named();
    let field = keys::area(&draft.buf, Field::Draft(cx.id.to_string()), draft.lit(), c.info.bg)
        .label(name)
        .placeholder(hint)
        .width(None)
        .rows(if draft.is_block() { 4 } else { 2 })
        .build(k)
        .key(cx.key("source"));
    // Leaving is its own act: Done when everything is saved, Discard (by name) when it isn't.
    let buttons = row().gap(6.0).center_y()
        .child(if unsaved { button(cx, "edit.close discard=true", ButtonVariant::Ghost).build(k).key(cx.key("discard")) } else { button(cx, "edit.close", ButtonVariant::Ghost).build(k).key(cx.key("done")) })
        .child(button(cx, "edit.save", ButtonVariant::Contrast).disabled(saving || !unsaved).build(k).key(cx.key("save")));
    // What somebody else last did to the text, by name, then how the draft is held.
    let told = draft.told.as_ref().map(|told| text(told.line()).key(cx.key("told")).font(k.ty.small).color(c.info.fg).wrap());
    let how = Some(held(draft)).filter(|held| !held.is_empty()).map(|held| text(held).key(cx.key("held")).font(k.ty.small).color(c.text_faint).wrap());
    let status = col().grow(1.0).min_w(0.0).gap(2.0).children(told).children(how);
    // What a comment or a reply is on, over its field: the words it quotes (a long passage by its start and its
    // end), the comment it answers; and, when the service says those words are no passage of the note, why.
    let on = draft.writes.on().map(|on| text(on).key(cx.key("on")).font(k.ty.small).color(c.text_muted).wrap());
    let unfound = draft.writes.quoted().and_then(|quoted| quoted.refused()).map(|why| text(why.to_string()).key(cx.key("on-problem")).font(k.ty.small).color(c.danger.fg).wrap());
    // What the keys do where they are now, from the table: the save that keeps you here, then the draft's own (the
    // Esc that leaves), or the list's while one is open over the block (the Esc that puts it away, the keys that choose).
    let hints = keys::bind_of("edit.save").map(|bind| (bind.cap(), bind.does)).into_iter().chain(keys::hints(cx.app.writing(cx.id))).fold(row().key(cx.key("editor-keys")).w_full().gap(12.0).flex_wrap(), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(c.text_faint)))
    });
    let framed = if draft.is_block() { col().key(cx.key("editor")).w_full().gap(8.0) } else { col().key(cx.key("editor")).w_full().gap(8.0).padding(12.0).radius(k.radius.md).fill(c.layer_01).border(1.0, c.border_focus) };
    framed
        .children(on)
        .children(unfound)
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
