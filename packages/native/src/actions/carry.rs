//! A tile held by its title: where it would land is shown while it is held, and it lands there when it is let go.
//!
//! The places are the layout's (`layout/drop.rs`, the door's drop zones by contract): this file tells that rule
//! what is on screen (each tile's frame in cells, a tab set's labels, a shut dock's handle), keeps what it answers
//! for the cell the pointer is over (`Moving`), and lets go by running the act the place names (`layout.move`,
//! `layout.swap`) as a request of its own, so a drop is recorded as the move it is. Nothing here knows a zone's
//! shape or its words, and the shell draws only what `Moving` holds.
//!
//! Both actions are the person's: an agent moves a tile by `layout.move` and shows no drag.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, Scalar, Touches};
use super::{About, Action, Actor, App, Notice, Outcome};
use crate::actline::{Args, Request};
use crate::layout::drop::{self, DockHandle, DropPlace, DropTile, Tab, Zone};
use crate::layout::tree::{self, Node};
use crate::layout::{Dir, Id, Rect};

/// A tile held by its title: the cell the pointer has it over, and what the layout's drop rule answers there.
#[derive(Clone, Debug, PartialEq)]
pub struct Moving {
    pub tile: Id,
    /// The cell under the pointer, in the tiles' area. None: it is held and has been taken nowhere yet.
    pub at: Option<(f64, f64)>,
    /// The pointer has left the window: let go there, the tile goes into a window of its own.
    pub out: bool,
    /// The place under the pointer: where letting go lands it, or why policy refuses it there.
    pub drop: Option<Zone>,
    /// The places each tile on screen offers while this one is held, in the order they are drawn.
    pub zones: Vec<(Id, Vec<Zone>)>,
    /// A float follows the hand: where its corner is while it is held (it is put there when it is let go over no
    /// landing; a tile of the layout stays where it stands until then).
    pub lifted: Option<(f64, f64)>,
    /// Where in its title a float was taken hold of, from its corner.
    grip: (f64, f64),
    /// The layout's revision the zones were asked at: asked again once its shape changes under the hand.
    rev: u64,
}

impl Moving {
    /// A zone is the one the pointer is over: the drop's own sort of place, on the drop's own tile.
    pub fn lit(&self, zone: &Zone) -> bool { self.drop.as_ref().is_some_and(|drop| !drop.handle && drop.place.target() == zone.place.target() && drop.place.sort(&zone.place)) }
}

/// A shut dock's strip at its edge, in cells: where a press slides it open and a tile let go joins what it shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Strip { pub side: Dir, pub at: Rect, pub shows: Id }

static CARRY: ActionRow = ActionRow::new("layout.carry", Touches::Nothing, "hold a tile (tile=, else the one with the keys) by its title over a cell of the window: every tile shows the places it would take it (a side to split it, its middle for a tab or to trade places, its title for a place among its tabs, the window's edges for a whole column or row, a shut dock's strip), the one under col= row= is lit, and layout.drop lands it there. Nothing moves until then. out=true says the pointer has left the window: let go there, the tile is torn into a window of its own. The person's own: an agent moves a tile with layout.move and shows no drag")
    .person("a tile held by its title is the person's hand: an agent moves a tile outright (layout.move to=<tile> where=<side>, or layout.swap)")
    .args(&[
        ("col", ArgSpec::number("the column of the cell the pointer is over, from the left of the tiles' area").optional()),
        ("row", ArgSpec::number("the row of that cell, from the top of the tiles' area").optional()),
        ("out", ArgSpec::flag("the pointer has left the window").optional()),
    ])
    .keys(&[KeyRow::via("a drag on a tile's title or on its tab: the tile follows the pointer")])
    .examples(&[Example { act: "layout.carry col=90 row=12 tile=tree", does: "holds the tree over the cell 90, 12: the place it would land in is lit", safe: Some(true) }]);

static DROP: ActionRow = ActionRow::new("layout.drop", Touches::Shape, "let go of the tile held by its title: it lands in the place it is held over, by the act that place is (layout.move or layout.swap, run and recorded as itself), or, let go outside the window, is torn into a window of its own (tile.tear), and from a window that was torn from another goes back into that one (tile.return). Held over no place, or with cancel=true, nothing moves, and the window says so")
    .person("a tile held by its title is the person's to let go: an agent moves a tile outright (layout.move to=<tile> where=<side>, or layout.swap)")
    .args(&[("cancel", ArgSpec::flag("true lets go with nothing moved").optional())])
    .keys(&[KeyRow::with("escape", Some("moving"), "lets go: the tile stays where it was", &[("cancel", Scalar::Flag(true))]), KeyRow::via("the pointer let go of a title it holds")])
    .examples(&[Example { act: "layout.drop", does: "the held tile lands where it is held", safe: None }]);

pub static ACTIONS: &[Action] = &[Action { row: &CARRY, run: carry, about: About::Any }, Action { row: &DROP, run: let_go, about: About::Nothing }];

/// The cells a tile's title keeps clear on its right for what stands beside its tabs (its kind, its controls), and
/// for its close alone.
const TITLE_REST: f64 = 16.0;
const TITLE_CLOSE: f64 = 4.0;

/// The tile in front of a container: a tab set's shown one, a dock's or a split's first.
fn front(node: &Node) -> Option<Id> {
    match node { Node::Leaf(spec) => Some(spec.id.clone()), Node::Tabs { active, kids, .. } => kids.get(*active).or(kids.first()).map(|spec| spec.id.clone()), Node::Dock { kid, .. } => front(kid), other => other.kids().iter().find_map(front) }
}

impl App {
    /// The cells each tab's label takes on the title of the tile in front of its set (`rect`: that tile's frame).
    /// One answer for the title drawn and for the drag: a tile let go over a label lands before that tab. Each
    /// label is as wide as its name where the title has the room beside what else it holds; where it hasn't, the
    /// labels share the title but for its close.
    pub fn tab_cells(&self, shown: &str, rect: Rect) -> Vec<Tab> {
        let set: Vec<Id> = match tree::tabs_of(self.layout.tree(), shown).and_then(|path| self.layout.tree().at(&path)) { Some(Node::Tabs { kids, .. }) => kids.iter().map(|spec| spec.id.clone()).collect(), _ => vec![shown.to_string()] };
        let wide = |id: &Id| self.layout.name(id).chars().count() as f64 + 3.0;
        let most = if set.iter().map(wide).sum::<f64>() <= rect.cols - 2.0 - TITLE_REST { f64::MAX } else { ((rect.cols - 2.0 - TITLE_CLOSE) / set.len() as f64).floor().max(4.0) };
        let mut from = rect.col + 1.0;
        set.into_iter().map(|id| {
            let to = from + wide(&id).min(most);
            let tab = Tab { id, from, to };
            from = to;
            tab
        }).collect()
    }

    /// A title has the room for what stands beside its tabs (its kind, its controls): the labels end short of it.
    pub fn title_has_room(&self, tabs: &[Tab], rect: Rect) -> bool { tabs.last().is_none_or(|last| last.to <= rect.col + rect.cols - TITLE_REST) }

    /// The shut docks' strips, each at its edge of the tiles' area.
    pub fn dock_strips(&self) -> Vec<Strip> {
        if self.layout.zoom.is_some() { return Vec::new() }
        let (base, _) = self.layout.placed(self.area, &|_| false);
        base.docks.iter().filter_map(|(path, at)| {
            let Some(dock @ Node::Dock { side, open: false, .. }) = self.layout.tree().at(path) else { return None };
            let at = match side {
                Dir::Left | Dir::Right => Rect { col: at.col.min(self.area.cols - drop::EDGE_COLS).max(0.0), cols: drop::EDGE_COLS, ..*at },
                Dir::Up | Dir::Down => Rect { row: at.row.min(self.area.rows - 1.0).max(0.0), rows: 1.0, ..*at },
            };
            Some(Strip { side: *side, at, shows: front(dock)? })
        }).collect()
    }

    /// The tiles as a drag sees them, what is on top first: each shown tile's frame, and a tab set's labels. A
    /// float takes no tile (no kind here receives one's content), so the tile under it is the one found.
    fn drop_tiles(&self) -> Vec<DropTile> {
        let slid: Vec<Id> = self.layout.placed(self.area, &|_| false).1.iter().flat_map(|dock| dock.placed.rects.iter().map(|(id, _)| id.clone())).collect();
        let mut tiles: Vec<(bool, DropTile)> = self.layout.rects(self.area, &|_| false).into_iter().filter(|(id, r)| r.cols > 0.0 && r.rows > 0.0 && !self.layout.is_float(id)).map(|(id, rect)| {
            let tabs = Some(self.tab_cells(&id, rect)).filter(|tabs| tabs.len() > 1);
            (slid.contains(&id), DropTile { id, rect, tabs, receive: None, floating: false })
        }).collect();
        // A dock that slides over the layout is over the tiles under it.
        tiles.sort_by_key(|(over, _)| !*over);
        tiles.into_iter().map(|(_, tile)| tile).collect()
    }

    /// The shut docks' strips as the drop rule reads a handle: its cells, a row each.
    fn dock_handles(&self) -> Vec<DockHandle> {
        self.dock_strips().into_iter().flat_map(|strip| (0..strip.at.rows as usize).map(move |row| DockHandle { from: strip.at.col, to: strip.at.col + strip.at.cols, row: strip.at.row + row as f64, shows: strip.shows.clone(), edge: strip.side })).collect()
    }

    /// What the drop rule answers with `tile` held over a cell: the place there, and the places every tile offers.
    /// The zones are asked once a hold and again when the layout's shape changes; the place under the pointer each time.
    fn held_over(&self, tile: &Id, at: Option<(f64, f64)>, out: bool, before: Option<&Moving>) -> Moving {
        let tiles = self.drop_tiles();
        let floating = self.layout.is_float(tile);
        // Why policy refuses the held tile at a place: the layout's own answer to the operation a drop there is.
        let refuse = |to: &DropPlace| self.refusal(&drop::drop_op(tile, to), &Actor::Person);
        let zones = match before.filter(|before| before.tile == *tile && before.rev == self.layout.rev) {
            Some(before) => before.zones.clone(),
            // (A float's title moves it freely over a tile's body: it is offered no zone there.)
            None if floating => Vec::new(),
            None => tiles.iter().map(|t| (t.id.clone(), drop::zones_of(t, drop::on_layout(&tiles, tile), Some(&refuse)))).collect(),
        };
        let many = self.layout.tree().leaves().len() > 1;
        let drop = at.filter(|_| !out).and_then(|(x, y)| {
            let found = drop::handle_drop(&self.dock_handles(), self.area, x, y, tile, Some(&refuse)).or_else(|| drop::drop_at(&tiles, self.area, x, y, tile, many, Some(&refuse)))?;
            // A float lands only where a drop can't be meant as a move: a title, an outer edge, a dock's handle.
            (!floating || found.handle || drop::float_landing(&found, &tiles, y)).then_some(found)
        }).map(|found| self.says_docked(found));
        // A float is taken hold of where the pointer first has it, and its corner follows from there.
        let corner = self.layout.floats.iter().find(|float| float.spec.id == *tile).map(|float| (float.rect.col, float.rect.row));
        let grip = before.filter(|before| before.tile == *tile && before.at.is_some()).map(|before| before.grip).or_else(|| at.zip(corner).map(|((x, y), (col, row))| (x - col, y - row))).unwrap_or_default();
        let lifted = at.filter(|_| floating && !out).map(|(x, y)| (x - grip.0, y - grip.1));
        Moving { tile: tile.clone(), at, out, drop, zones, lifted, grip, rev: self.layout.rev }
    }

    /// A drop beside or into a tile in a dock says it docks there (a dock's tiles stay on this screen).
    fn says_docked(&self, zone: Zone) -> Zone {
        let docked = zone.place.target().is_some_and(|target| tree::dock_of(self.layout.tree(), target).is_some());
        if docked && !zone.label.contains(drop::DOCK_DROP) { Zone { label: format!("{} · {}", zone.label, drop::DOCK_DROP), ..zone } } else { zone }
    }

    /// The tile that was held is gone from the arrangement: nothing is held.
    pub(super) fn held_gone(&mut self) { if self.st.moving.as_ref().is_some_and(|moving| self.st.layout.spec(&moving.tile).is_none()) { self.st.moving = None } }
}

fn carry(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = app.about().unwrap_or_else(|| app.layout.focus.clone());
    if app.spec(&tile).is_none() { return Outcome::refused("no tile is here to hold") }
    let at = args.number("col").zip(args.number("row")).map(|(col, row)| (col.floor(), row.floor()));
    let held = app.held_over(&tile, at, args.flag("out") == Some(true), app.moving.as_ref());
    let answer = json!({ "tile": app.layout.name(&tile), "place": held.drop.as_ref().map(|zone| zone.label.clone()), "refused": held.drop.as_ref().and_then(|zone| zone.refused.clone()), "out": held.out });
    app.st.moving = Some(held);
    Outcome::answer(answer)
}

fn let_go(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(held) = app.st.moving.take() else { return Outcome::refused("no tile is held by its title") };
    let name = app.layout.name(&held.tile);
    let stays = |app: &mut App, why: String| { app.st.notice = Some(Notice::info(why)); Outcome::answer(json!({ "tile": name, "moved": false })) };
    if args.flag("cancel") == Some(true) { return stays(app, format!("{name} stays where it was: let go with nothing moved.")) }
    // Let go outside the window: a window of its own, by the action that tears a tile out; from a window that was
    // torn from another, back into that one.
    if held.out { return app.act_request(Request { action: app.leaves_by().id.to_string(), tile: Some(name), by: None, args: Default::default() }, by.clone()) }
    // Where it is held now, asked of the arrangement as it is now (it may have changed under the hand).
    match app.held_over(&held.tile, held.at, false, None).drop {
        // A float let go over no landing is put where it was carried to.
        None if held.lifted.is_some() => {
            let (col, row) = held.lifted.unwrap_or_default();
            app.act_request(Request { action: super::tile::PLACE.id.to_string(), tile: Some(name), by: None, args: [("col".to_string(), json!(col)), ("row".to_string(), json!(row))].into_iter().collect() }, by.clone())
        }
        None => stays(app, format!("{name} stays where it was: it was let go over no place.")),
        Some(Zone { refused: Some(why), .. }) => { app.st.notice = Some(Notice::problem(format!("{name} is not moved: {why}"))); Outcome::refused(why) }
        // The place's own act, as a request already read: the drop is the move (or the swap) it is, by the dispatcher.
        Some(zone) => {
            let args = drop::drop_args(&zone, &|id| app.layout.name(id)).into_iter().collect();
            app.act_request(Request { action: drop::drop_action(&zone).to_string(), tile: Some(name), by: None, args }, by.clone())
        }
    }
}
