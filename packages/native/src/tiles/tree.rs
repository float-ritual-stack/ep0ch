//! The `tree` drawer: the outline's notes, a folder a level (`blocks.read under=`), only the rows in view built.
//! A press on a row is an act line; where its note opens is the layout's to say.
use std::borrow::Cow;
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use rune::{El, Icon, ScrollSpec, col, el, row, text};
use rune_kit::{Kit, glyphs};
use serde_json::{Value, json};

use super::{Drawer, TileCx};
use crate::actions::{App, TreeLine, word};
use crate::list::{self, Rows};
use crate::store::Ask;

pub static DRAWER: Drawer = Drawer { id: "tree", asks, draw, facts, takes_keys: false, version };

static DOT: Icon = Icon { name: "ep0ch-dot", view: 16.0, body: r#"<circle cx="8" cy="8" r="1.6" fill="currentColor"/>"# };

const ROW: f32 = 28.0;

/// The top level, and every unfolded folder's.
fn asks(cx: &TileCx) -> Vec<(&'static str, Ask)> {
    std::iter::once(None).chain(cx.ui.unfolded.iter().map(|id| Some(id.as_str()))).map(|parent| ("level", cx.app.level_ask(parent))).collect()
}

fn facts(cx: &TileCx) -> Value {
    let lines = cx.app.tree_of(cx.id);
    json!({ "rows": lines.iter().map(|line| json!({ "id": line.row.id, "title": line.row.title, "depth": line.depth })).collect::<Vec<_>>(), "unfolded": cx.ui.unfolded, "selected": cx.app.selected_in(cx.id) })
}

fn version(cx: &TileCx) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    (&cx.ui.unfolded, cx.app.selected_in(cx.id)).hash(&mut h);
    h.finish()
}

fn line_el(line: &TreeLine, open: bool, selected: bool, name: &str, pick: impl Fn(&mut App) + 'static, k: &Kit) -> El {
    let (r, c) = (&line.row, &k.c);
    let icon = if !r.has_children { &DOT } else if open { &glyphs::TRIANGLE_DOWN } else { &glyphs::TRIANGLE_RIGHT };
    k.interactive(
        row().w_full().h(ROW).gap(6.0).center_y().px(8.0).radius(k.radius.sm).fill(if selected { c.surface_hover } else { rune::Color::TRANSPARENT })
            .child(el().w(line.depth.min(12) as f32 * 14.0))
            .child(rune::icon(icon, 14.0).color(c.text_faint))
            .child(text(if r.title.is_empty() { "untitled".to_string() } else { r.title.clone() }).font(k.ty.ui).color(c.text_base).truncate().grow(1.0)),
    )
    .key(format!("tile/{name}/row/{}", r.id))
    .role("treeitem")
    .on_press(pick)
}

fn draw(cx: &TileCx, k: &Kit) -> El {
    let lines = Rc::new(cx.app.tree_of(cx.id));
    if lines.is_empty() {
        let said = if cx.app.online && cx.app.machine.is_empty() { "Calling the outline…" } else { "No notes yet." };
        return col().key(cx.key("empty")).w_full().padding(12.0).child(text(said).font(k.ty.small).color(k.c.text_faint));
    }
    let (keyed, built, kit) = (lines.clone(), lines.clone(), k.clone());
    let (name, named, unfolded, selected) = (cx.name.clone(), cx.name.clone(), cx.ui.unfolded.clone(), cx.app.selected_in(cx.id));
    let tile = word(&cx.name);
    let rows = list::rows(cx.key("rows"), Rows::new(lines.len(), ROW, move |_: &App, i: usize| Cow::Owned(format!("tile/{name}/row/{}", keyed[i].row.id)), move |_: &App, i: usize| {
        let line = &built[i];
        let pick = { let line = format!("tree.pick id={} tile={tile}", word(&line.row.id)); move |s: &mut App| { s.act(&line, crate::actions::Actor::Person); } };
        line_el(line, unfolded.contains(&line.row.id), selected.as_deref() == Some(line.row.id.as_str()), &named, pick, &kit)
    }));
    k.scroll_bar(col().key(cx.key("scroll")).w_full().h_full().min_h(0.0).padding(4.0).scroll(ScrollSpec { stick_bottom: false }).child(rows))
}
