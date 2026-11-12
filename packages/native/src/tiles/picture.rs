//! The pictures a window holds, decoded: Rune's image cache and what it made of each picture, kept behind the
//! renderer seam. The window's state says which pictures its pages show (`Page::pictures`, by `Picture::key`) and
//! hands over the bytes the host read; what a decoded picture *is* (Rune's `Image`) is named only here and by the
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

/// Every picture the window holds, by `Picture::key`.
pub struct Pictures { cache: ImageCache, held: HashMap<String, Shown> }

impl Default for Pictures {
    // Until the window gives its waker, a decoded picture wakes nobody (a test's window is driven by hand).
    fn default() -> Pictures { Pictures { cache: ImageCache::new(Arc::new(|| {})), held: HashMap::new() } }
}

impl Pictures {
    /// A picture that finishes decoding wakes the window to draw it: the cache is made again with the window's
    /// waker, and what was decoded without one is asked again.
    pub fn woken_by(&mut self, waker: Arc<dyn Fn() + Send + Sync>) { *self = Pictures { cache: ImageCache::new(waker), held: HashMap::new() } }
    pub fn get(&self, key: &str) -> Option<&Shown> { self.held.get(key) }
    pub fn holds(&self, key: &str) -> bool { self.held.contains_key(key) }
    /// Only these are kept: what no page shows any more is let go.
    pub fn keep(&mut self, shown: &HashSet<String>) { self.held.retain(|key, _| shown.contains(key)) }
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
