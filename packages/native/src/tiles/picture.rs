//! The pictures a window holds, decoded: Rune's image cache and what it made of each picture, kept behind the
//! renderer seam. The window's state says which pictures its pages show (`Page::pictures`, by `Picture::key`) and
//! hands over the bytes the host read, and the last few pictures no page shows any more stay decoded behind the
//! ones shown; what a decoded picture *is* (Rune's `Image`) is named only here and by the
//! builder that draws one, so the model holds no renderer's type.
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use rune::{Image, ImageCache};

/// A picture as the window holds it: asked for, decoded (or decoding, on Rune's worker), or why there is none.
pub enum Shown {
    Asked,
    /// `points`: how many of its pixels make a point (a vector picture is drawn at twice its size, for a dense screen).
    Ready { image: Image, points: f32 },
    Failed(String),
}

/// The widest a picture is drawn, in points: what a vector picture is drawn to fit.
const PICTURE_POINTS: f32 = 760.0;

/// The most pictures kept decoded behind the pages shown, and the most of their pixels (as RGBA bytes): a note come
/// back to, or a reader's tab brought forward again, draws its pictures at once, and a long walk through notes with
/// photos holds no more than this.
const BEHIND: usize = 8;
const BEHIND_BYTES: u64 = 128 << 20;

/// Every picture the window holds, by `Picture::key`: the ones its pages show, and the last few they showed
/// (`behind`, the one let go last at the end), still decoded.
pub struct Pictures { cache: ImageCache, held: HashMap<String, Shown>, behind: Vec<String> }

impl Default for Pictures {
    // Until the window gives its waker, a decoded picture wakes nobody (a test's window is driven by hand).
    fn default() -> Pictures { Pictures { cache: ImageCache::new(Arc::new(|| {})), held: HashMap::new(), behind: Vec::new() } }
}

impl Pictures {
    /// A picture that finishes decoding wakes the window to draw it: the cache is made again with the window's
    /// waker. What is held already stays held: a headless render reads its pictures before the window, and its
    /// waker, exist, and the one frame it draws shows them.
    pub fn woken_by(&mut self, waker: Arc<dyn Fn() + Send + Sync>) { self.cache = ImageCache::new(waker) }
    pub fn get(&self, key: &str) -> Option<&Shown> { self.held.get(key) }
    pub fn holds(&self, key: &str) -> bool { self.held.contains_key(key) }
    /// These are the pictures the pages show now. One no page shows any more goes behind them when it is decoded
    /// (it would be read from the host and decoded again the next time its note is shown: a large photo said
    /// "decoding…" each time), the last few of those are kept, and the rest is let go. A picture that never came, or
    /// failed, is let go at once: its page asks for it again.
    pub fn keep(&mut self, shown: &HashSet<String>) {
        self.behind.retain(|key| !shown.contains(key));
        let mut gone: Vec<String> = self.held.keys().filter(|key| !shown.contains(*key) && !self.behind.contains(key)).cloned().collect();
        gone.sort();
        for key in gone { if matches!(self.held.get(&key), Some(Shown::Ready { .. })) { self.behind.push(key) } else { self.held.remove(&key); } }
        let bytes = |shown: Option<&Shown>| match shown { Some(Shown::Ready { image, .. }) => image.size().map_or(0, |[w, h]| w as u64 * h as u64 * 4), _ => 0 };
        let (mut kept, mut held) = (Vec::new(), 0u64);
        for key in std::mem::take(&mut self.behind).into_iter().rev() {
            let size = bytes(self.held.get(&key));
            if kept.len() < BEHIND && held + size <= BEHIND_BYTES { held += size; kept.push(key) } else { self.held.remove(&key); }
        }
        kept.reverse();
        self.behind = kept;
    }
    /// Its bytes are asked of the host.
    pub fn asked(&mut self, key: String) { self.held.insert(key, Shown::Asked); }
    pub fn failed(&mut self, key: String, why: String) { self.held.insert(key, Shown::Failed(why)); }
    /// Bytes handed to Rune's image cache, which decodes them on its worker and wakes the window when they're ready.
    /// `wait`: a headless render has one frame, so the picture is waited for and that frame shows it.
    pub fn decode(&mut self, key: String, bytes: Vec<u8>, mime: &str, wait: bool) {
        let points = if mime.contains("svg") { 2.0 } else { 1.0 };
        let image = self.cache.load_mime(bytes, mime, PICTURE_POINTS, points);
        let shown = match wait.then(|| image.wait()) { Some(Err(e)) => Shown::Failed(format!("{e:?}")), _ => Shown::Ready { image, points } };
        self.held.insert(key, shown);
    }
}
