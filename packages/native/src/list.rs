//! The one list: rows built by index, only the ones in view. The bar's rows and every list tile's are it: a tree, a
//! table, rows under their groups and each lane of a board. Whoever lists gives a count, a key and a builder a row,
//! and finds each row's item by that key, never by where it sat.
use std::borrow::Cow;

use rune::{El, GrowthSpec, ScrollSpec, col};
use rune_kit::Kit;

use crate::actions::App;

/// A list's rows, as a function of where they sit: what a row is keyed, and what it draws.
pub struct Rows<K, B> {
    pub count: usize,
    /// The height a row not yet measured is taken to have.
    pub height: f32,
    pub key: K,
    pub build: B,
}

impl<K, B> Rows<K, B>
where K: for<'a> Fn(&'a App, usize) -> Cow<'a, str> + 'static, B: Fn(&App, usize) -> El + 'static {
    pub fn new(count: usize, height: f32, key: K, build: B) -> Rows<K, B> { Rows { count, height, key, build } }
}

/// The rows as one growing column, for a scroll the caller owns.
pub fn rows<K, B>(key: impl Into<String>, list: Rows<K, B>) -> El
where K: for<'a> Fn(&'a App, usize) -> Cow<'a, str> + 'static, B: Fn(&App, usize) -> El + 'static {
    col().key(key.into()).w_full().growth(GrowthSpec::default()).virtual_rows(list.count, list.height, list.key, list.build)
}

/// The rows in their own scroll, as tall as `shown` of them at most: a list inside something that doesn't bound it
/// (the bar's dialog).
pub fn bounded<K, B>(key: &str, shown: usize, k: &Kit, list: Rows<K, B>) -> El
where K: for<'a> Fn(&'a App, usize) -> Cow<'a, str> + 'static, B: Fn(&App, usize) -> El + 'static {
    let height = (list.count.max(1) as f32 * list.height).min(list.height * shown as f32);
    k.scroll_bar(col().key(format!("{key}-scroll")).w_full().h(height).scroll(ScrollSpec { stick_bottom: false }).child(rows(key, list)))
}

/// The first `most` rows built outright, in a plain column, then how many more there are: for a list drawn under a
/// row of another list, where rows built only in view have no scroll of their own to be in view of. The same key and
/// builder a row.
pub fn whole<K, B>(key: impl Into<String>, s: &App, most: usize, k: &Kit, list: Rows<K, B>) -> El
where K: for<'a> Fn(&'a App, usize) -> Cow<'a, str> + 'static, B: Fn(&App, usize) -> El + 'static {
    let shown = (0..list.count.min(most)).fold(col().key(key.into()).w_full(), |out, i| out.child((list.build)(s, i)));
    if list.count <= most { return shown }
    shown.child(rune::text(format!("and {} more", list.count - most)).font(k.ty.small).color(k.c.text_faint).px(8.0).py(4.0))
}
