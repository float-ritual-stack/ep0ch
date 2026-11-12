//! The one list: rows built by index, only the ones in view. The bar's rows and a tree tile's are it today; lanes
//! and the tiles that follow a note are it next. Whoever lists gives a count, a key and a builder a row, and
//! finds each row's item by that key, never by where it sat.
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
