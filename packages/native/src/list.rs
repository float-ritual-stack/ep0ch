//! The one list: rows built by index, only the ones in view. The bar's rows and every list tile's are it: a tree, a
//! table, rows under their groups and each lane of a board. Whoever lists gives a count, a key and a builder a row,
//! and finds each row's item by that key, never by where it sat.
use std::borrow::Cow;

use rune::{El, GrowthSpec, ScrollSpec, Span, col, el, rich, row, text};
use rune_kit::{Keybind, Kit};

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

/// What a row of a list shows on its line, whoever lists it (the bar, the list that completes a word): what sort of
/// thing it is, its name with the letters that were typed set apart, how what it writes looks, one quiet word at
/// the right, and the key that runs it. Every word of it is the row's own: whoever lists hands them over as served.
#[derive(Default)]
pub struct Line {
    /// A short quiet tag at the row's start (the row's own word for what it is), and that word whole, for a reader
    /// that can't see the tag.
    pub tag: Option<(String, String)>,
    pub label: String,
    /// The characters of `label` (UTF-16 indexes) that what was typed matched, as the service found them.
    pub marks: Vec<usize>,
    /// How what it writes looks, built by whoever lists it: drawn after the label, in a slot of its own.
    pub sample: Option<El>,
    pub detail: Option<String>,
    pub keycap: Option<String>,
    /// Two lines, the detail under the label (a row of the bar); else one, the detail at the right edge.
    pub tall: bool,
}

/// A one-line row's height, the slot a tag and a sample each take, and the room between a row's parts, in points.
pub const LINE: f32 = 28.0;
const TAG: f32 = 16.0;
pub const SAMPLE: f32 = 84.0;
const GAP: f32 = 8.0;
const PAD: f32 = 10.0;

/// A label with the letters that were typed set apart: the matched characters in the theme's strong ink and
/// weight, the rest as it is. One line, cut at its width.
pub fn marked(label: &str, marks: &[usize], font: rune::TextStyle, k: &Kit) -> El {
    // UTF-16 indexes to the bytes of each matched character, runs joined.
    let mut spans: Vec<Span> = Vec::new();
    let (mut unit, mut byte) = (0, 0);
    for ch in label.chars() {
        if marks.contains(&unit) {
            match spans.last_mut() { Some(last) if last.end as usize == byte => last.end = (byte + ch.len_utf8()) as u32, _ => spans.push(Span { color: Some(k.c.text_strong), ..Span::new(byte, byte + ch.len_utf8()).bold() }) }
        }
        unit += ch.len_utf16();
        byte += ch.len_utf8();
    }
    let ink = if marks.is_empty() { k.c.text_base } else { k.c.text_weak };
    if spans.is_empty() { text(label.to_string()).font(font).color(k.c.text_base).truncate() } else { rich(label.to_string(), spans).font(font).color(ink).truncate() }
}

/// The row: its parts in their places, lit when it is the one the keys are on. Whoever lists gives it its key and
/// what a press runs.
pub fn line(line: Line, lit: bool, k: &Kit) -> El {
    let c = &k.c;
    let tag = line.tag.map(|(tag, whole)| el().w(TAG).min_w(TAG).center().child(text(tag).font(k.ty.small).color(c.text_faint)).help(whole));
    let label = marked(&line.label, &line.marks, if line.tall { k.ty.ui_medium } else { k.ty.ui_compact }, k);
    let detail = line.detail.filter(|detail| !detail.is_empty()).map(|detail| text(detail).font(k.ty.small).color(c.text_faint).truncate());
    let sample = line.sample.map(|sample| row().w(SAMPLE).min_w(SAMPLE).center_y().clip_soft(0.0).child(sample));
    let cap = line.keycap.map(|cap| Keybind::new(&[cap.as_str()]).build(k));
    let fill = if lit { c.surface_hover } else { rune::Color::TRANSPARENT };
    if line.tall {
        let words = col().gap(1.0).grow(1.0).min_w(0.0).child(label).children(detail);
        return row().w_full().gap(PAD).center_y().px(PAD).py(6.0).radius(k.radius.sm).fill(fill).children(tag).child(words).children(sample).children(cap);
    }
    row().w_full().h(LINE).gap(GAP).center_y().px(PAD).radius(k.radius.sm).fill(fill)
        .children(tag)
        .child(label.shrink())
        .children(sample)
        .child(el().grow(1.0).min_w(GAP))
        .children(detail.map(|detail| detail.shrink()))
        .children(cap)
}

/// How wide a one-line row wants to be to show its parts whole, in points: what a list sized to its rows asks of each.
pub fn line_width(tag: bool, label: &str, sample: bool, detail: Option<&str>, k: &Kit) -> f32 {
    let wide = |said: &str, font: rune::TextStyle| rune::text::measure(said, &[], font, None).0;
    2.0 * PAD + if tag { TAG + GAP } else { 0.0 } + wide(label, k.ty.ui_compact) + if sample { SAMPLE + GAP } else { 0.0 } + GAP + detail.filter(|detail| !detail.is_empty()).map_or(0.0, |detail| wide(detail, k.ty.small) + GAP)
}

/// A section's header among a list's rows: its name and how many rows it has, quiet, as tall as a row.
pub fn header(name: &str, count: usize, k: &Kit) -> El {
    row().w_full().h(LINE).px(PAD).center_y().gap(GAP).child(text(name.to_string()).font(k.ty.small).color(k.c.text_faint)).child(text(count.to_string()).font(k.ty.small).color(k.c.text_faint))
}

/// The rows in a scroll of their own that is as tall as its rows up to `shown` of them, and shrinks with a surface
/// that has less room (the kit's `popover::fit_scroll`): a list in something hung over the window.
pub fn fitted<K, B>(key: &str, shown: usize, k: &Kit, list: Rows<K, B>) -> El
where K: for<'a> Fn(&'a App, usize) -> Cow<'a, str> + 'static, B: Fn(&App, usize) -> El + 'static {
    let (height, least) = ((list.count.max(1) as f32 * list.height).min(list.height * shown as f32), list.height);
    let viewport = rune_kit::popover::fit_scroll(rows(key, list)).key(format!("{key}-scroll")).role("listbox").h(height).min_h(least);
    k.scroll_bar(viewport)
}
