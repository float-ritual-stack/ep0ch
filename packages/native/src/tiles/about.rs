//! The `about` drawer: what the service knows about the note another tile shows. A tile of it follows its
//! source by wire (`source: tile:<name>`): it reads that tile's note's page, the same answer the reader holds, so
//! the two never disagree. `props` draws the note's properties and record; `backlinks` the notes that link to it.
use std::hash::{Hash, Hasher};

use rune::{El, ScrollSpec, col, el, text};
use rune_kit::Kit;
use serde_json::{Value, json};

use super::page::link_row;
use super::{Drawer, TileCx};
use crate::page::Page;
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "about", asks, draw, facts, takes_keys: false, version };

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.followed_by(cx.id).map(|note| ("page", cx.app.page_ask(&note))).into_iter().collect() }

fn page<'a>(cx: &'a TileCx) -> Option<&'a Page> { cx.app.followed_by(cx.id).and_then(|note| cx.store().read::<Page>(&cx.app.page_ask(&note)).or_else(|| cx.store().last::<Page>(cx.id, "page"))) }

fn facts(cx: &TileCx) -> Value {
    let page = page(cx);
    json!({ "follows": cx.spec.text("source"), "note": cx.app.followed_by(cx.id), "title": page.map(|p| p.title.clone()),
        "properties": page.filter(|_| cx.spec.kind == "props").map(|p| p.properties.iter().map(|chip| json!({ "key": chip.key, "value": chip.value })).collect::<Vec<_>>()),
        "backlinks": page.filter(|_| cx.spec.kind == "backlinks").map(|p| p.backlinks.iter().map(|r| json!({ "id": r.id, "title": r.title })).collect::<Vec<_>>()) })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    cx.app.followed_by(cx.id).hash(&mut h);
    h.finish()
}

fn section(title: &str, k: &Kit) -> El { text(title.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint) }

/// An ISO time as a person reads it: the day and the minute.
fn when(iso: &str) -> String { iso.get(..16).map_or(iso.to_string(), |minute| minute.replace('T', " ")) }

fn draw(cx: &TileCx, k: &Kit) -> El {
    let c = &k.c;
    let Some(page) = page(cx) else { return col().key(cx.key("empty")).w_full().padding(16.0).child(text("Nothing is open to say anything about.").font(k.ty.small).color(c.text_faint).wrap()) };
    let field = |label: &str, value: String| col().gap(2.0).child(text(label.to_owned()).font(k.ty.small).color(c.text_faint)).child(text(value).font(k.ty.ui).color(c.text_base).wrap().selectable(true));
    let mut body = col().key(cx.key("details")).w_full().padding(16.0).gap(12.0);
    if cx.spec.kind == "backlinks" {
        body = body.child(section(&format!("Linked from · {}", page.backlinks.len()), k));
        if page.backlinks.is_empty() { body = body.child(text("No note links here.").font(k.ty.small).color(c.text_faint)) }
        body = page.backlinks.iter().fold(body, |b, r| b.child(link_row(cx, r, "backlink", k)));
    } else {
        body = body.child(section("Properties", k));
        if page.properties.is_empty() { body = body.child(text("None.").font(k.ty.small).color(c.text_faint)) }
        body = page.properties.iter().fold(body, |b, chip| b.child(field(&chip.key, chip.value.clone())));
        body = body.child(el().h(4.0)).child(section("Record", k)).child(field("Revision", page.revision.to_string())).child(field("Updated", when(&page.updated))).child(field("By", page.author.clone())).child(field("Id", page.id.clone()));
    }
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(body))
}
