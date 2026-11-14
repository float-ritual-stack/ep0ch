//! Where a tile held by its title lands: the door's drop zones (`desk/drop.ts`), rule for rule, in cells.
//!
//! The hit rectangles and the boxes drawn share this one owner, so a zone on screen is exactly where its drop lands.
//! `zones_of` lists the places a tile offers while another is held over it (the four bands that split it, and its
//! middle: a tab above, a swap below); `drop_at` says which place a cell is in, with the layout's outer strips and a
//! tab set's header first; `handle_drop` is a shut dock's handle. A drop names the act letting go there runs
//! (`drop_action`, `drop_args`) and the operation that is (`drop_op`).
//!
//! The door's own answers are written down in `outline-core/fixtures/drop-contract.json`: the drop under every
//! cell of its layouts, and every zone. `tests/contract.rs` asks each of this file. Nothing else in the window
//! knows a zone's shape, its words or which act it runs: the shell draws what this answers and reports the pointer.
use serde_json::{Map, Value, json};

use super::Op;
use super::tree::{Dir, Id, Place, Rect, round};

/// The outer strips: two cells in from the left and right, the last row at the bottom.
pub const EDGE_COLS: f64 = 2.0;
/// The middle share of a tile, between the four bands that split it.
pub const CENTRE: f64 = 0.56;
/// What a drop into a dock says while it is held there.
pub const DOCK_DROP: &str = "docked here: stays on this screen";

/// What a tile does with a tile dropped on its content, when its kind takes one: the words in its zone and the
/// act that runs (never a move).
#[derive(Clone, Debug, PartialEq)]
pub struct Receive { pub label: String, pub action: String, pub args: Map<String, Value> }

/// One tab's label on its set's header row: the cells it takes.
#[derive(Clone, Debug, PartialEq)]
pub struct Tab { pub id: Id, pub from: f64, pub to: f64 }

/// A tile as the drag sees it: its frame, and when it is the front of a tab set, each tab's label.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct DropTile { pub id: Id, pub rect: Rect, pub tabs: Option<Vec<Tab>>, pub receive: Option<Receive>, pub floating: bool }

impl DropTile {
    fn holds(&self, src: &str) -> bool { self.id == src || self.tabs.as_ref().is_some_and(|tabs| tabs.iter().any(|tab| tab.id == src)) }
    fn set_of_one(&self, src: &str) -> bool { self.id == src && self.tabs.as_ref().is_none_or(|tabs| tabs.len() < 2) }
}

/// Where a dropped tile goes: beside a tile, into its tabs, along an outer edge, or in its place.
#[derive(Clone, Debug, PartialEq)]
pub enum DropPlace {
    Split { target: Id, dir: Dir },
    Tabs { target: Id, index: Option<usize> },
    Edge { dir: Dir },
    Swap { target: Id },
}

impl DropPlace {
    /// The tile it is by, when it is by one.
    pub fn target(&self) -> Option<&str> { match self { DropPlace::Split { target, .. } | DropPlace::Tabs { target, .. } | DropPlace::Swap { target } => Some(target), DropPlace::Edge { .. } => None } }
    /// Its kind in a word, with the side for a band: what tells one zone of a tile from another.
    pub fn word(&self) -> String { match self { DropPlace::Split { dir, .. } => format!("split/{}", dir.word()), DropPlace::Tabs { .. } => "tabs".into(), DropPlace::Edge { dir } => format!("edge/{}", dir.word()), DropPlace::Swap { .. } => "swap".into() } }
    /// The same sort of place: a zone is the lit one when it is the drop's sort (a band, by its side).
    pub fn sort(&self, other: &DropPlace) -> bool { match (self, other) { (DropPlace::Split { dir: a, .. }, DropPlace::Split { dir: b, .. }) => a == b, (a, b) => std::mem::discriminant(a) == std::mem::discriminant(b) } }
}

/// A drop, and a zone that offers one: where the tile goes, the box drawn while it is held there, the words in it,
/// and why policy refuses it.
#[derive(Clone, Debug, PartialEq)]
pub struct Zone { pub place: DropPlace, pub ghost: Rect, pub label: String, pub refused: Option<String>, pub handle: bool, pub receive: Option<Receive> }

impl Zone {
    fn at(place: DropPlace, ghost: Rect, label: &str) -> Zone { Zone { place, ghost, label: label.to_string(), refused: None, handle: false, receive: None } }
}

/// Why the layout's policy refuses the held tile at a place, or None.
pub type Refuse<'a> = &'a dyn Fn(&DropPlace) -> Option<String>;

/// With the reason policy gives, when it gives one (a content receiver is no move: policy isn't asked).
fn judged(drop: Zone, refuse: Option<Refuse>) -> Zone {
    if drop.receive.is_some() { return drop }
    match refuse.and_then(|refuse| refuse(&drop.place)) { Some(why) => Zone { refused: Some(why), ..drop }, None => drop }
}

fn inside(r: Rect, x: f64, y: f64) -> bool { x >= r.col && x < r.col + r.cols && y >= r.row && y < r.row + r.rows }

/// The drop under the cell (x, y) while `src` is held, or None (nowhere, or onto itself where that means nothing).
/// `tiles`: the tiles on screen, what is on top first. `area`: the whole layout. `many`: there is more than one
/// tile, so an outer edge means something.
pub fn drop_at(tiles: &[DropTile], area: Rect, x: f64, y: f64, src: &str, many: bool, refuse: Option<Refuse>) -> Option<Zone> {
    zone_at(tiles, area, x, y, src, many).map(|drop| judged(drop, refuse))
}

fn zone_at(tiles: &[DropTile], area: Rect, x: f64, y: f64, src: &str, many: bool) -> Option<Zone> {
    if !inside(area, x, y) { return None }
    let (w, h) = (round(area.cols * 0.3).max(3.0), round(area.rows * 0.3).max(3.0));
    if many {
        if x < area.col + EDGE_COLS { return Some(Zone::at(DropPlace::Edge { dir: Dir::Left }, Rect { cols: w, ..area }, "\u{21d0} full-height column")) }
        if x >= area.col + area.cols - EDGE_COLS { return Some(Zone::at(DropPlace::Edge { dir: Dir::Right }, Rect { col: area.col + area.cols - w, cols: w, ..area }, "\u{21d2} full-height column")) }
        if y == area.row + area.rows - 1.0 { return Some(Zone::at(DropPlace::Edge { dir: Dir::Down }, Rect { row: area.row + area.rows - h, rows: h, ..area }, "\u{21d3} full-width row")) }
    }
    let t = tiles.iter().find(|t| inside(t.rect, x, y))?;
    // Onto itself: only a tab leaving its own tab set means something (it lands beside the tabs left).
    let own = t.holds(src);
    let set_of_one = t.set_of_one(src);
    if y == t.rect.row {
        if t.floating || set_of_one { return None }
        // Over a tab's label: before it; past the last one: at the end.
        let labels: &[Tab] = t.tabs.as_deref().unwrap_or(&[]);
        let index = labels.iter().position(|label| x < label.to).unwrap_or(labels.len().max(1));
        return Some(Zone::at(DropPlace::Tabs { target: t.id.clone(), index: Some(index) }, t.rect, if own { "\u{2194} reorder tab" } else { "\u{25ad} tabs" }));
    }
    if set_of_one { return None }
    zones_of(t, on_layout(tiles, src), None).into_iter().find(|zone| inside(zone.ghost, x, y))
}

/// The held tile as the zones are asked with it: itself when this layout holds it, else none (a tile arriving from
/// outside has no place here to trade, and joins tabs).
pub fn on_layout<'a>(tiles: &[DropTile], src: &'a str) -> Option<&'a str> { tiles.iter().any(|t| t.holds(src)).then_some(src) }

/// A shut dock's handle as the drag reads it: its cells on one row, the tile it shows (what a tile dropped on it
/// joins as a tab), and its edge.
#[derive(Clone, Debug, PartialEq)]
pub struct DockHandle { pub from: f64, pub to: f64, pub row: f64, pub shows: Id, pub edge: Dir }

/// The arrow of an edge, as a dock's drop says it (the door's `EDGE_GLYPH`).
fn edge_glyph(edge: Dir) -> char { match edge { Dir::Left => '\u{2190}', Dir::Right => '\u{2192}', Dir::Up => '\u{2191}', Dir::Down => '\u{2193}' } }

/// A drop on a shut dock's handle: the tile goes into that dock, into the tabs of what it shows. The box is drawn
/// over the handle, within `area`, wide enough for its words.
pub fn handle_drop(handles: &[DockHandle], area: Rect, x: f64, y: f64, src: &str, refuse: Option<Refuse>) -> Option<Zone> {
    let h = handles.iter().find(|h| y == h.row && x >= h.from && x < h.to).filter(|h| h.shows != src)?;
    let label = format!("{} {DOCK_DROP}", edge_glyph(h.edge));
    let cols = area.cols.min((h.to - h.from).max(label.encode_utf16().count() as f64 + 6.0));
    let ghost = Rect { col: area.col.max(h.from.min(area.col + area.cols - cols)), row: area.row.max(h.row - 3.0), cols, rows: 3.0 };
    Some(judged(Zone { handle: true, ..Zone::at(DropPlace::Tabs { target: h.shows.clone(), index: None }, ghost, &label) }, refuse))
}

/// The places a tile offers while `src` is held, in the order they are drawn. `src` none: the tile comes from
/// outside this layout, so the middle is one place (a tab).
pub fn zones_of(tile: &DropTile, src: Option<&str>, refuse: Option<Refuse>) -> Vec<Zone> {
    let (id, r) = (&tile.id, tile.rect);
    let own = src.is_some_and(|src| tile.holds(src));
    if src.is_some_and(|src| tile.set_of_one(src)) { return Vec::new() }
    let body = Rect { col: r.col + 1.0, row: r.row + 1.0, cols: r.cols - 2.0, rows: r.rows - 2.0 };
    let side = (body.cols * (1.0 - CENTRE) / 2.0).floor().max(1.0);
    let end = (body.rows * (1.0 - CENTRE) / 2.0).floor().max(1.0);
    let middle = Rect { row: body.row + end, rows: body.rows - 2.0 * end, ..body };
    let centre = Rect { col: body.col + side, cols: body.cols - 2.0 * side, ..middle };
    let top = (centre.rows / 2.0).ceil();
    let receive: Option<Zone> = tile.receive.as_ref().filter(|_| !own).map(|receive| Zone { receive: Some(receive.clone()), ..Zone::at(DropPlace::Tabs { target: id.clone(), index: None }, if tile.floating { body } else { centre }, &receive.label) });
    // A float has no place in the tree to split or trade: it takes content, or nothing.
    if tile.floating { return receive.into_iter().collect() }
    let split = |dir: Dir, ghost: Rect, label: &str| Zone::at(DropPlace::Split { target: id.clone(), dir }, ghost, label);
    let tab = |ghost: Rect| Zone::at(DropPlace::Tabs { target: id.clone(), index: None }, ghost, "drop here: a tab");
    let mut zones = vec![split(Dir::Up, Rect { rows: end, ..body }, "^ drop here to split above"), split(Dir::Left, Rect { cols: side, ..middle }, "< split left")];
    match (receive, own, src) {
        (Some(receive), _, _) => zones.push(receive),
        (None, true, _) => {}
        (None, false, None) => zones.push(tab(centre)),
        (None, false, Some(_)) => {
            zones.push(tab(Rect { rows: top, ..centre }));
            zones.push(Zone::at(DropPlace::Swap { target: id.clone() }, Rect { row: centre.row + top, rows: centre.rows - top, ..centre }, "drop here: swap"));
        }
    }
    zones.push(split(Dir::Right, Rect { col: body.col + body.cols - side, cols: side, ..middle }, "split >"));
    zones.push(split(Dir::Down, Rect { row: body.row + body.rows - end, rows: end, ..body }, "v drop here to split below"));
    zones.into_iter().filter(|zone| zone.ghost.cols > 0.0 && zone.ghost.rows > 0.0).map(|zone| judged(zone, refuse)).collect()
}

/// The operation a drop at a place is: the layout's own swap or move, which own policy and what follows.
pub fn drop_op(tile: &str, to: &DropPlace) -> Op {
    let place = match to.clone() {
        DropPlace::Swap { target } => return Op::Swap { tile: tile.to_string(), with: target },
        DropPlace::Split { target, dir } => Place::Split { target, dir, pair: false, weight: None },
        DropPlace::Tabs { target, index } => Place::Tabs { target, index, behind: false },
        DropPlace::Edge { dir } => Place::Edge { dir },
    };
    Op::Move { tile: tile.to_string(), to: place }
}

/// The action letting go at a drop runs: what its content receiver says, else the swap or the move its place is.
pub fn drop_action(drop: &Zone) -> &str {
    match (&drop.receive, &drop.place) { (Some(receive), _) => &receive.action, (None, DropPlace::Swap { .. }) => "layout.swap", (None, _) => "layout.move" }
}

/// That action's arguments: the same for a title let go and a float landing. `name`: how a tile is named in an act.
pub fn drop_args(drop: &Zone, name: &dyn Fn(&str) -> String) -> Vec<(String, Value)> {
    if let Some(receive) = &drop.receive { return receive.args.iter().map(|(k, v)| (k.clone(), v.clone())).collect() }
    match &drop.place {
        DropPlace::Swap { target } => vec![("to".into(), json!(name(target)))],
        DropPlace::Edge { dir } => vec![("where".into(), json!(format!("edge-{}", dir.word())))],
        DropPlace::Tabs { target, index } => [("to".to_string(), json!(name(target))), ("where".to_string(), json!("tabs"))].into_iter().chain(index.map(|index| ("index".to_string(), json!(index)))).collect(),
        DropPlace::Split { target, dir } => vec![("to".into(), json!(name(target))), ("where".into(), json!(dir.word()))],
    }
}

/// A float's title still moves it freely over a tile's body: only a header, an outer edge and a content receiver
/// are landings for one.
pub fn float_landing(drop: &Zone, tiles: &[DropTile], y: f64) -> bool {
    drop.receive.is_some() || match &drop.place { DropPlace::Edge { .. } => true, DropPlace::Tabs { target, .. } => tiles.iter().any(|t| t.id == *target && t.rect.row == y), _ => false }
}
