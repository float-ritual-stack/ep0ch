//! The `view` drawer: a tile whose kind an extension's script renders (`tiles.view`). The service runs the script
//! and answers one view primitive with every press said as its act line; this drawer builds it through the one
//! registry (`prim.rs`), so a list in it is the list drawer's, a table the table's, and nothing here knows which
//! extension drew it or what it lists. A tile's own fields are the script's props; what the view calls itself is
//! said over it.
use std::hash::{Hash, Hasher};

use rune::{El, ScrollSpec, col, text};
use rune_kit::Kit;
use serde::Deserialize;
use serde_json::{Value, json};

use super::prim::{self, PrimCx};
use super::{Drawer, TileCx};
use crate::parts;
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "view", about: "what an extension's script draws for a tile, as the primitives the service answers: each built by the one registry", notes: false, lists: false, asks, draw, facts, takes_keys: false, version, over: None };

/// `tiles.view`'s answer: the kind that drew it, what the view calls itself, and the view.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct TileView {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub extension: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub view: Value,
}

fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> { cx.app.view_ask(cx.id).map(|ask| ("view", ask)).into_iter().collect() }

/// The view to draw: the one for what the tile asks now, else the last it showed while that is on its way.
fn answered<'a>(cx: &'a TileCx) -> Option<&'a TileView> { cx.app.view_ask(cx.id).and_then(|ask| cx.store().read::<TileView>(&ask)).or_else(|| cx.store().last::<TileView>(cx.id, "view")) }

fn facts(cx: &TileCx) -> Value {
    let Some(shown) = answered(cx) else { return json!({ "asking": true }) };
    // Every press the view carries, as the line it runs: what an agent picks from.
    let mut acts: Vec<Value> = Vec::new();
    parts::walk(&shown.view, &mut |prim| {
        for row in parts::list(prim, "rows").iter().filter(|row| row.is_object()) { if let Some(act) = parts::act(row) { acts.push(json!({ "id": row["id"], "label": row["label"], "act": act })) } }
    });
    json!({ "kind": shown.kind, "extension": shown.extension, "title": shown.title, "type": parts::ty(&shown.view), "rows": acts })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    // The note the reader beside shows is what a list in the view marks as open.
    cx.app.subject().hash(&mut h);
    h.finish()
}

fn said(cx: &TileCx, words: &str, k: &Kit) -> El { col().key(cx.key("empty")).w_full().padding(12.0).child(text(words.to_string()).font(k.ty.small).color(k.c.text_faint).wrap()) }

fn draw(cx: &TileCx, k: &Kit) -> El {
    let refused = cx.app.view_ask(cx.id).and_then(|ask| cx.store().refusal(&ask).map(|refusal| refusal.error.clone()));
    let Some(shown) = answered(cx) else { return said(cx, refused.as_deref().unwrap_or("Asking…"), k) };
    let mut body = col().key(cx.key("view")).w_full().padding(12.0).gap(8.0);
    // The service's no to the newest read is said over what it answered before.
    if let Some(why) = &refused { body = body.child(text(why.clone()).key(cx.key("refused")).font(k.ty.small).color(k.c.danger.fg).wrap()) }
    // (A list says its own title as its first line: said once.)
    if !shown.title.is_empty() && parts::text(&shown.view, "title") != Some(shown.title.as_str()) { body = body.child(text(shown.title.clone()).key(cx.key("title")).font(k.ty.ui_medium).color(k.c.text_base).wrap()) }
    body = body.child(prim::build(&shown.view, &PrimCx::of(cx).at("part"), k));
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(body))
}
