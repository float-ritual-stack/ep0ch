//! The `page` drawer: one note as the service answered it (`notes.page`). Prose arrives as Markdown and each
//! component with the service's answer; nothing here reads Blockdown. The reader tile is its one kind today, and
//! the note's source in the editor is drawn here while the draft is on this tile.
use std::hash::{Hash, Hasher};

use rune::{El, ScrollSpec, SurfaceFit, TextStyle, col, el, row, text};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, Keybind, Kit, Markdown};
use serde_json::{Value, json};

use super::{Drawer, TileCx};
use crate::actions::{self, Actor, App, Field, Shown, word};
use crate::keys::{self, Layer};
use crate::page::{Frame, ListRow, NoteRow, Page, Part, Picture};
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "page", asks, draw, facts, takes_keys: false, version };

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.note_of(cx.id).map(|note| ("page", cx.app.page_ask(&note))).into_iter().collect() }

fn facts(cx: &TileCx) -> Value {
    let page = cx.app.shown_of(cx.id);
    let editing = cx.app.editing.as_ref().filter(|e| e.tile == cx.id).map(|e| json!({ "note": e.note, "revision": e.revision, "unsaved": cx.app.unsaved() }));
    json!({ "note": cx.app.note_of(cx.id), "title": page.map(|p| p.title.clone()), "revision": page.map(|p| p.revision), "loading": cx.app.loading_of(cx.id), "editing": editing, "back": cx.ui.history })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.note, cx.ui.history.len(), cx.app.loading_of(cx.id)).hash(&mut h);
    if let Some(e) = cx.app.editing.as_ref().filter(|e| e.tile == cx.id) { (&e.note, e.revision, cx.app.unsaved(), cx.app.saving(), &cx.app.editor).hash(&mut h) }
    // A picture that finished decoding is drawn: how each of the page's pictures stands is part of what is shown.
    for picture in cx.app.shown_of(cx.id).into_iter().flat_map(Page::pictures) {
        match cx.app.picture(picture) { Some(Shown::Ready { image, .. }) => (2u8, image.size().is_some()).hash(&mut h), Some(Shown::Failed(why)) => (1u8, why).hash(&mut h), _ => 0u8.hash(&mut h) }
    }
    h.finish()
}

fn sized(base: TextStyle, size: f32, line: f32) -> TextStyle { TextStyle { size, line_height: line, ..base } }

/// A terminal row in points: a note gives a picture's height in rows, as the door reads it.
const ROW_POINTS: f32 = 20.0;
/// A header image's height when the note names none.
const HERO_POINTS: f32 = 220.0;

/// A button for an act line run in this tile: its label is the action's, its keycap the key table's.
fn button(cx: &TileCx, line: &str, variant: ButtonVariant) -> Button {
    let b = Button::new(actions::label(line)).variant(variant).on_press(cx.act(line));
    match keys::cap(line) { Some(cap) => b.shortcut(cap), None => b }
}

fn text_el(words: &str, font: TextStyle, color: rune::Color) -> El { text(words.to_string()).font(font).color(color) }
fn section(title: &str, k: &Kit) -> El { text(title.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint) }

fn prose(markdown: &str, cx: &TileCx, k: &Kit) -> El {
    let tile = word(&cx.name);
    Markdown::new(markdown).selectable(true).tasks_read_only().on_link_tx(move |s: &mut App, href: &str, _| { s.act(&format!("link.follow ref={} tile={tile}", word(href)), Actor::Person); }).build(k)
}

/// A row that opens a note when it names one, and is plain words when it doesn't.
pub(super) fn page_row(cx: &TileCx, text: &str, id: Option<&str>, trailing: Vec<String>, quiet: Option<&str>, key: String, k: &Kit) -> El {
    let c = &k.c;
    let mut line = row().w_full().gap(8.0).center_y().child(text_el(text, k.ty.ui, if id.is_some() { c.text_base } else { c.text_muted }).truncate().grow(1.0));
    for cell in trailing.into_iter().filter(|cell| !cell.is_empty()) { line = line.child(Badge::new(cell).variant(BadgeVariant::Subtle).build(k)) }
    if let Some(q) = quiet { line = line.child(text_el(q, k.ty.small, c.text_faint).truncate()) }
    let line = line.px(10.0).py(6.0).radius(k.radius.sm).key(key);
    match id {
        Some(id) => k.interactive(line).role("link").focusable(true).on_press(cx.emit("open", id)),
        None => line,
    }
}

/// A note in a list (a child, a backlink): press to open.
pub(super) fn link_row(cx: &TileCx, r: &NoteRow, scope: &str, k: &Kit) -> El {
    page_row(cx, if r.title.is_empty() { "untitled" } else { &r.title }, Some(&r.id), Vec::new(), (!r.context.is_empty()).then_some(r.context.as_str()), cx.key(format!("{scope}/{}", r.id)), k)
}

fn chips(cx: &TileCx, page: &Page, k: &Kit) -> El {
    page.chips.iter().fold(row().key(cx.key("chips")).gap(6.0).flex_wrap(), |r, chip| {
        r.child(
            k.interactive(Badge::new(format!("{} · {}", chip.key, chip.value)).variant(BadgeVariant::Subtle).standard().build(k))
                .key(cx.key(format!("chip/{}/{}", chip.key, chip.value)))
                .help(format!("Notes with {}={}", chip.key, chip.value))
                // A chip is a query: every note that carries it.
                .on_press(cx.act(format!("bar.narrow key={} value={}", word(&chip.key), word(&chip.value)))),
        )
    })
}

/// A `graph-stat` from its answered props: a tile per item, the number large over its label.
fn stat_tiles(props: &Value, k: &Kit) -> Option<El> {
    let items = props.get("items")?.as_array()?;
    let words = |v: Option<&Value>| match v { Some(Value::String(s)) => s.clone(), Some(Value::Null) | None => String::new(), Some(other) => other.to_string() };
    let tiles = items.iter().fold(row().w_full().gap(8.0).flex_wrap(), |tiles, item| {
        let accent = item.get("accent").and_then(Value::as_bool).unwrap_or(false);
        tiles.child(
            col().min_w(120.0).grow(1.0).padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_02).border(1.0, if accent { k.c.border_focus } else { k.c.border_muted })
                .child(text(words(item.get("value"))).font(sized(k.ty.body_medium, 24.0, 30.0)).color(if accent { k.c.text_accent } else { k.c.text_base }))
                .child(text(words(item.get("label"))).font(k.ty.small).color(k.c.text_muted).wrap()),
        )
    });
    (!items.is_empty()).then_some(tiles)
}

/// A component as the service answered it. One it has no answer for, or this window no drawing for, shows as it was written: never hidden.
fn component(cx: &TileCx, i: usize, part: &Part, k: &Kit) -> El {
    let c = &k.c;
    let (frame, body): (&Frame, Vec<El>) = match part {
        Part::Prose { .. } | Part::Picture { .. } => return el(),
        Part::Figure { frame, figure, props, markdown } => (frame, match (figure.as_str(), markdown) {
            ("stat", _) => vec![stat_tiles(props, k).unwrap_or_else(|| text_el(&frame.source, k.ty.mono, c.text_muted).wrap())],
            (_, Some(md)) => vec![prose(md, cx, k)],
            _ => vec![text_el(&frame.source, k.ty.mono, c.text_muted).wrap()],
        }),
        Part::View { frame, view, truncated } => {
            let mut rows: Vec<El> = Vec::new();
            let headers = if view.headers.is_empty() { &view.columns } else { &view.headers };
            if !headers.is_empty() && !view.rows.is_empty() { rows.push(text_el(&headers.join(" · "), k.ty.text_xsmall_medium, c.text_faint).px(10.0)) }
            rows.extend(view.rows.iter().map(|r| page_row(cx, &r.label, Some(&r.id), r.cells.iter().map(ListRow::cell).collect(), r.detail.as_deref(), cx.key(format!("part/{i}/{}", r.id)), k)));
            if view.rows.is_empty() { rows.push(text_el("No notes match.", k.ty.small, c.text_faint)) }
            if *truncated { rows.push(text_el("More match than are shown: open the query for all of them.", k.ty.small, c.text_faint)) }
            (frame, rows)
        }
        Part::Rows { frame, groups } => {
            let mut rows: Vec<El> = Vec::new();
            for (g, group) in groups.iter().enumerate() {
                if groups.len() > 1 { rows.push(section(&group.name, k).px(10.0)) }
                if group.rows.is_empty() { rows.push(text_el(group.empty.as_deref().unwrap_or("nothing here yet"), k.ty.small, c.text_faint).px(10.0)) }
                rows.extend(group.rows.iter().enumerate().map(|(n, r)| {
                    let key = r.id.as_ref().map_or(format!("part/{i}/{g}/{n}"), |id| format!("part/{i}/{id}"));
                    page_row(cx, &r.text, r.id.as_deref(), Vec::new(), r.note.as_deref(), cx.key(key), k)
                }));
            }
            (frame, rows)
        }
        Part::Component { frame } => (frame, vec![text_el(&frame.source, k.ty.mono, c.text_muted).wrap()]),
    };
    let mut head = row().w_full().gap(8.0).center_y().child(Badge::new(frame.name.clone()).variant(BadgeVariant::Accent).build(k));
    if let Some(t) = &frame.title { head = head.child(text_el(t, k.ty.ui_medium, c.text_base)) }
    head = head.child(el().grow(1.0));
    if let Some(q) = &frame.query {
        head = head.child(
            k.interactive(text_el(q, k.ty.mono, c.text_muted).truncate())
                .key(cx.key(format!("part/{i}/query")))
                .help("Open this query")
                .on_press(cx.act(format!("bar.open scope=query query={}", word(q)))),
        );
    } else if let Some(status) = &frame.status {
        head = head.child(text_el(status, k.ty.small, c.text_faint));
    }
    let mut card = col().key(cx.key(format!("part/{i}"))).w_full().padding(12.0).gap(6.0).radius(k.radius.md).fill(c.layer_01).border(1.0, c.border_muted).child(head);
    // The service's words on what is wrong, with whatever it could still answer under them.
    if let Some(e) = &frame.error { card = card.child(text_el(e, k.ty.small, c.danger.fg).wrap()) }
    body.into_iter().fold(card, |card, part| card.child(part))
}

/// What stands where a picture will be, or would have been: its alt text and why it isn't drawn.
fn no_picture(picture: &Picture, why: &str, key: &str, k: &Kit) -> El {
    let name = picture.alt.clone().or_else(|| picture.path.clone()).unwrap_or_else(|| "picture".into());
    col().key(key.to_string()).w_full().padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted)
        .child(text_el(&name, k.ty.ui, k.c.text_muted))
        .child(text_el(why, k.ty.small, k.c.text_faint).wrap())
}

/// A picture where it stands: at its own size up to the reading measure (`full`: the width there is), or the height the note gives it.
fn picture(cx: &TileCx, picture: &Picture, key: String, k: &Kit) -> El {
    let (image, points) = match cx.app.picture(picture) {
        Some(Shown::Ready { image, points }) => (image, *points),
        Some(Shown::Failed(why)) => return no_picture(picture, why, &key, k),
        Some(Shown::Asked) | None => return no_picture(picture, "on its way…", &key, k),
    };
    let Some([width, _]) = image.size() else {
        return match image.error() { Some(e) => no_picture(picture, &format!("{e:?}"), &key, k), None => no_picture(picture, "decoding…", &key, k) };
    };
    let mut drawn = el().key(key).role("image").label(picture.alt.clone().unwrap_or_else(|| "Picture".into())).w_full().radius(6.0);
    drawn = match picture.height {
        // The note says how tall: the picture is shown whole inside that band.
        Some(rows) => drawn.h(rows * ROW_POINTS).pixels_fit(image.pixels(), SurfaceFit::Fit),
        None => drawn.pixels(image.pixels()),
    };
    if picture.width != "full" && picture.height.is_none() { drawn = drawn.max_w(width as f32 / points) }
    let mut body = col().w_full().gap(4.0).child(drawn);
    // What's written on its line that isn't a layout value is said under it, as the door's caption does.
    for problem in &picture.problems { body = body.child(text_el(problem, k.ty.small, k.c.warning.fg).wrap()) }
    body
}

/// The note's header image: a band above the title, cropped to fill it (`contain`: shown whole), dimmed as the note asks.
fn hero(cx: &TileCx, picture: &Picture, k: &Kit) -> Option<El> {
    let Some(Shown::Ready { image, .. }) = cx.app.picture(picture) else { return None };
    image.size()?;
    let fit = if picture.fit.as_deref() == Some("contain") { SurfaceFit::Fit } else { SurfaceFit::Fill };
    let band = el().key(cx.key("hero")).role("image").label(picture.alt.clone().unwrap_or_else(|| "Header image".into())).w_full()
        .h(picture.height.map_or(HERO_POINTS, |rows| rows * ROW_POINTS)).radius(10.0).pixels_fit(image.pixels(), fit);
    Some(match picture.dim.filter(|dim| *dim > 0.0) {
        Some(dim) => band.child(el().w_full().h_full().radius(10.0).fill(k.alpha(k.c.black, dim.min(1.0)))),
        None => band,
    })
}

fn note(cx: &TileCx, page: &Page, k: &Kit) -> El {
    let c = &k.c;
    let mut body = col().key(cx.key("note")).w_full().max_w(820.0).padding(24.0).gap(14.0);
    if let Some(band) = page.hero.as_ref().and_then(|picture| hero(cx, picture, k)) { body = body.child(band) }
    if !page.ancestors.is_empty() {
        let path = page.ancestors.iter().map(|a| a.title.as_str()).collect::<Vec<_>>().join(" › ");
        body = body.child(text(path).key(cx.key("path")).font(k.ty.small).color(c.text_faint).truncate());
    }
    body = body.child(
        row().w_full().gap(10.0).center_y()
            .child(text(page.title.clone()).key(cx.key("title")).font(sized(k.ty.body_medium, 26.0, 32.0)).color(c.text_base).wrap().selectable(true).grow(1.0))
            .child(button(cx, "edit", ButtonVariant::Neutral).build(k).key(cx.key("edit"))),
    );
    if !page.chips.is_empty() { body = body.child(chips(cx, page, k)) }
    for (i, part) in page.parts.iter().enumerate() {
        body = body.child(match part {
            Part::Prose { markdown } => prose(markdown, cx, k).key(cx.key(format!("part/{i}"))),
            Part::Picture { picture: shown } => picture(cx, shown, cx.key(format!("part/{i}")), k),
            part => component(cx, i, part, k),
        });
    }
    if !page.children.is_empty() {
        body = body.child(el().h(6.0)).child(section(&format!("Under this note · {}", page.children.len()), k));
        body = page.children.iter().fold(body, |b, r| b.child(link_row(cx, r, "child", k)));
    }
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
    match cx.app.shown_of(cx.id) { Some(page) => note(cx, page, k), None => empty(cx, k) }
}
