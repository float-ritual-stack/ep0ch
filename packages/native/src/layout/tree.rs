//! The layout tree: its nodes, the steps that reshape one, and where each tile sits in an area.
//!
//! This is the door's `desk/layout.ts` and `desk/flow.ts`, rule for rule, so one saved tree means one arrangement in
//! both doors (`outline-core/fixtures/layout-contract.json` holds them to it). A node is found by its path from the
//! root (the index of each kid on the way), where the door holds the object.
use serde_json::{Map, Value, json};

/// A tile's id in its layout. A tile made here is named, and its name is its id until it is renamed.
pub type Id = String;

/// The way from the root to a node: the index of each kid on the way (a dock's one kid is 0).
pub type Path = Vec<usize>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Axis { Row, Col }

impl Axis {
    pub fn word(self) -> &'static str { match self { Axis::Row => "row", Axis::Col => "col" } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir { Left, Right, Up, Down }

impl Dir {
    pub fn word(self) -> &'static str { match self { Dir::Left => "left", Dir::Right => "right", Dir::Up => "up", Dir::Down => "down" } }
    pub fn read(word: &str) -> Option<Dir> { match word { "left" => Some(Dir::Left), "right" => Some(Dir::Right), "up" => Some(Dir::Up), "down" => Some(Dir::Down), _ => None } }
    pub fn axis(self) -> Axis { if matches!(self, Dir::Left | Dir::Right) { Axis::Row } else { Axis::Col } }
    pub fn before(self) -> bool { matches!(self, Dir::Left | Dir::Up) }
}

/// A box in cells (the door's) or points (this window's): the rules only add, halve and compare.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Rect { pub col: f64, pub row: f64, pub cols: f64, pub rows: f64 }

impl Rect {
    pub fn read(v: &Value) -> Option<Rect> { Some(Rect { col: v.get("col")?.as_f64()?, row: v.get("row")?.as_f64()?, cols: v.get("cols")?.as_f64()?, rows: v.get("rows")?.as_f64()? }) }
    pub fn json(&self) -> Value { json!({ "col": num(self.col), "row": num(self.row), "cols": num(self.cols), "rows": num(self.rows) }) }
}

/// A number as JSON writes one: whole numbers without a fraction.
pub fn num(x: f64) -> Value { if x.fract() == 0.0 && x.abs() < 9.0e15 { json!(x as i64) } else { json!(x) } }

/// JavaScript's `Math.round`: a half goes up.
pub fn round(x: f64) -> f64 { (x + 0.5).floor() }

/// A fold's spine, in cells.
pub const SPINE: f64 = 3.0;
/// A flow column that shows a strip of itself, in cells.
pub const PEEK: f64 = 24.0;
pub const MIN_COLS: f64 = 6.0;
pub const MIN_ROWS: f64 = 3.0;
/// The width a reader reads at, when a policy names none.
pub const READABLE: f64 = 48.0;

// ── policy ────────────────────────────────────────────────────────────────────────────────────────────────────

pub const POLICY_KEYS: &[&str] = &["draggable", "droppable", "closable", "accepts", "resizable", "min", "max", "fixed", "collapsible", "overlay", "stays", "locked", "opensInto", "opens", "altOpens", "host", "readable", "shuts", "agents", "spines", "min-width", "gap", "inset"];
const FLAGS: &[&str] = &["draggable", "droppable", "closable", "resizable", "collapsible", "overlay", "stays", "locked", "shuts"];
const CELLS: &[&str] = &["min", "max", "fixed", "readable", "min-width", "gap", "inset"];
pub const OPEN_RULES: &[&str] = &["reader", "next", "beside", "float", "full", "self"];
pub const SPINES: &[&str] = &["book", "start", "end", "centre", "invoker"];
pub const ALT_RULES: &[&str] = &["beside", "tab", "tile", "first-unheld"];
pub const AGENT_LEVELS: &[&str] = &["free", "edit", "off"];

/// A count of cells as a policy holds one: a number that isn't negative, rounded.
pub fn cells(v: Option<&Value>) -> Option<f64> { v.and_then(Value::as_f64).filter(|n| n.is_finite() && *n >= 0.0).map(round) }

/// What a container or the screen lets happen to its tiles (outline-core's `Policy`), kept to the fields it has.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Policy(pub Map<String, Value>);

impl Policy {
    /// A policy as saved or as an agent gave it, kept to the fields and types it has (outline-core's `policyOf`).
    pub fn of(x: Option<&Value>) -> Policy {
        let mut out = Map::new();
        let Some(o) = x.and_then(Value::as_object) else { return Policy(out) };
        for k in FLAGS { if let Some(Value::Bool(b)) = o.get(*k) { out.insert((*k).into(), json!(b)); } }
        for k in CELLS { if let Some(n) = cells(o.get(*k)) { out.insert((*k).into(), num(n)); } }
        if let Some(Value::Array(list)) = o.get("accepts") {
            let mut kinds: Vec<String> = Vec::new();
            for a in list.iter().filter_map(Value::as_str).filter(|a| !a.is_empty() && a.len() <= 40 && a.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '.' | '-'))) {
                let kind = if a == "detail" || a == "pinned" { "reader" } else { a };
                if !kinds.iter().any(|k| k == kind) { kinds.push(kind.to_string()) }
            }
            out.insert("accepts".into(), json!(kinds));
        }
        if let Some(to) = o.get("opensInto").and_then(Value::as_str).filter(|to| !to.is_empty()) { out.insert("opensInto".into(), json!(to)); }
        match o.get("opens").and_then(Value::as_str) {
            Some(rule) if OPEN_RULES.contains(&rule) => { out.insert("opens".into(), json!(rule)); }
            Some("current") => { out.insert("opens".into(), json!("reader")); }
            _ => {}
        }
        for (k, among) in [("spines", SPINES), ("altOpens", ALT_RULES), ("host", &["beside", "over", "none"][..]), ("agents", AGENT_LEVELS)] {
            if let Some(v) = o.get(k).and_then(Value::as_str).filter(|v| among.contains(v)) { out.insert(k.into(), json!(v)); }
        }
        Policy(out)
    }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
    pub fn flag(&self, key: &str) -> Option<bool> { self.0.get(key).and_then(Value::as_bool) }
    pub fn cells(&self, key: &str) -> Option<f64> { cells(self.0.get(key)) }
    pub fn text(&self, key: &str) -> Option<&str> { self.0.get(key).and_then(Value::as_str) }
    pub fn accepts(&self) -> Option<Vec<String>> { self.0.get("accepts").and_then(Value::as_array).map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect()) }
    pub fn json(&self) -> Value { Value::Object(self.0.clone()) }
    /// One spelling of it, for telling a changed shape from the same one.
    pub fn key(&self) -> String { let mut keys: Vec<&String> = self.0.keys().collect(); keys.sort(); keys.iter().map(|k| format!("{k}={}", self.0[*k])).collect::<Vec<_>>().join(",") }
}

/// What the policies over a tile add up to, and which layer said each.
#[derive(Clone, Debug)]
pub struct Effective {
    pub spines: String,
    pub min_width: f64,
    pub locked: bool,
    pub draggable: bool,
    pub droppable: bool,
    pub closable: bool,
    pub resizable: bool,
    pub collapsible: bool,
    pub accepts: Option<Vec<String>>,
    pub opens_into: Option<String>,
    pub agents: String,
    pub opens: String,
    pub alt_opens: String,
    pub readable: f64,
    pub by: std::collections::HashMap<&'static str, String>,
}

impl Effective {
    pub fn by(&self, key: &str) -> Option<&str> { self.by.get(key).map(String::as_str) }
}

/// One layer of policy: who says it (`screen`, a container's id, `reader tiles`), and whether it is a flow.
pub struct Layer<'a> { pub by: String, pub policy: Option<&'a Policy>, pub flow: bool }

pub fn effective(layers: &[Layer]) -> Effective {
    let mut out = Effective { spines: "book".into(), min_width: 40.0, locked: false, draggable: true, droppable: true, closable: true, resizable: true, collapsible: true, accepts: None, opens_into: None, agents: "free".into(), opens: "reader".into(), alt_opens: "beside".into(), readable: READABLE, by: Default::default() };
    for Layer { by, policy, flow } in layers {
        if *flow && policy.and_then(|p| p.text("opens")).is_none() { out.opens = "next".into(); out.by.insert("opens", by.clone()); }
        let Some(p) = policy else { continue };
        if let Some(v) = p.text("spines") { out.spines = v.into(); out.by.insert("spines", by.clone()); }
        if let Some(v) = p.cells("min-width") { out.min_width = v; out.by.insert("min-width", by.clone()); }
        if let Some(v) = p.text("altOpens") { out.alt_opens = v.into(); out.by.insert("altOpens", by.clone()); }
        if let Some(v) = p.text("opens") { out.opens = v.into(); out.by.insert("opens", by.clone()); }
        if p.flag("locked") == Some(true) { out.locked = true; out.by.entry("locked").or_insert_with(|| by.clone()); }
        for (k, slot) in [("draggable", &mut out.draggable), ("droppable", &mut out.droppable), ("closable", &mut out.closable), ("resizable", &mut out.resizable), ("collapsible", &mut out.collapsible)] {
            if let Some(v) = p.flag(k) { *slot = v; out.by.insert(k, by.clone()); }
        }
        if let Some(v) = p.accepts() { out.accepts = Some(v); out.by.insert("accepts", by.clone()); }
        if let Some(v) = p.text("opensInto") { out.opens_into = Some(v.into()); out.by.insert("opensInto", by.clone()); }
        if let Some(v) = p.text("agents") { out.agents = v.into(); out.by.insert("agents", by.clone()); }
        if let Some(v) = p.cells("readable") { out.readable = v; out.by.insert("readable", by.clone()); }
    }
    out
}

// ── the nodes ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A tile as a layout holds one: its id, its kind, and whatever else its spec says (a query, a source, a note),
/// kept as written so a kind this window doesn't draw still saves whole.
#[derive(Clone, Debug, PartialEq)]
pub struct TileSpec {
    pub id: Id,
    pub kind: String,
    /// Every other field of the saved leaf, but the ones the layout itself keeps (name, fold, agents, wires).
    pub fields: Map<String, Value>,
}

impl TileSpec {
    pub fn new(id: impl Into<Id>, kind: impl Into<String>) -> TileSpec { TileSpec { id: id.into(), kind: kind.into(), fields: Map::new() } }
    pub fn text(&self, key: &str) -> Option<&str> { self.fields.get(key).and_then(Value::as_str) }
}

/// A container's own id (`s3`, `g1`, `d2`: stamped by the layout) and its policy.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Meta { pub id: Option<String>, pub policy: Option<Policy> }

impl Meta {
    fn has_policy(&self) -> bool { self.policy.as_ref().is_some_and(|p| !p.is_empty()) }
    /// As a copy keeps it: an empty policy is none.
    fn kept(&self) -> Meta { Meta { id: self.id.clone(), policy: self.policy.clone().filter(|p| !p.is_empty()) } }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Trail { pub tile: Id, pub from: Option<Id>, pub ahead: Option<Id> }

/// What a flow remembers of its columns: the wide one, the one kept open beside it, where spines sat.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct FlowMemory {
    pub anchor: Option<Id>,
    pub keep: Option<Id>,
    pub read: Option<Id>,
    pub held: Vec<Id>,
    pub recent: Vec<Id>,
    /// (tile, on the left).
    pub sides: Vec<(Id, bool)>,
    pub trail: Vec<Trail>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Leaf(TileSpec),
    /// Tiles side by side (`Row`) or stacked (`Col`), each with its share.
    Split { dir: Axis, weights: Vec<f64>, kids: Vec<Node>, key: Option<String>, pair: bool, meta: Meta },
    /// Tiles in one place, one shown.
    Tabs { active: usize, kids: Vec<TileSpec>, meta: Meta },
    /// A row filled from a source, a column a row of it.
    Columns { weights: Vec<f64>, kids: Vec<Node>, source: Option<String>, key: Option<String>, meta: Meta },
    /// A row that sizes its own columns: one wide, the rest squeezed to strips and spines.
    Flow { weights: Vec<f64>, kids: Vec<Node>, memory: FlowMemory, key: Option<String>, meta: Meta },
    /// A part of the layout that slides over the rest from an edge.
    Dock { side: Dir, open: bool, kid: Box<Node>, view: Option<Vec<Id>>, keeps: bool, meta: Meta },
}

pub fn leaf(spec: TileSpec) -> Node { Node::Leaf(spec) }
pub fn split_of(dir: Axis, kids: Vec<Node>, weights: Option<Vec<f64>>) -> Node {
    let weights = weights.unwrap_or_else(|| kids.iter().map(|_| 1.0).collect());
    Node::Split { dir, weights, kids, key: None, pair: false, meta: Meta::default() }
}
fn empty_tabs() -> Node { Node::Tabs { active: 0, kids: Vec::new(), meta: Meta::default() } }

impl Node {
    pub fn is_leaf(&self) -> bool { matches!(self, Node::Leaf(_)) }
    pub fn is_line(&self) -> bool { matches!(self, Node::Split { .. } | Node::Columns { .. } | Node::Flow { .. }) }
    pub fn is_flow(&self) -> bool { matches!(self, Node::Flow { .. }) }
    pub fn is_dock(&self) -> bool { matches!(self, Node::Dock { .. }) }
    pub fn is_tabs(&self) -> bool { matches!(self, Node::Tabs { .. }) }
    /// What the door calls it: `leaf`, `split`, `tabs`, `columns`, `flow`, `dock`.
    pub fn t(&self) -> &'static str { match self { Node::Leaf(_) => "leaf", Node::Split { .. } => "split", Node::Tabs { .. } => "tabs", Node::Columns { .. } => "columns", Node::Flow { .. } => "flow", Node::Dock { .. } => "dock" } }
    pub fn meta(&self) -> Option<&Meta> { match self { Node::Leaf(_) => None, Node::Split { meta, .. } | Node::Tabs { meta, .. } | Node::Columns { meta, .. } | Node::Flow { meta, .. } | Node::Dock { meta, .. } => Some(meta) } }
    pub fn meta_mut(&mut self) -> Option<&mut Meta> { match self { Node::Leaf(_) => None, Node::Split { meta, .. } | Node::Tabs { meta, .. } | Node::Columns { meta, .. } | Node::Flow { meta, .. } | Node::Dock { meta, .. } => Some(meta) } }
    pub fn id(&self) -> Option<&str> { self.meta().and_then(|m| m.id.as_deref()) }
    /// Its id, else what it is: how a refusal names a container.
    pub fn id_or_t(&self) -> String { self.id().map_or_else(|| self.t().to_string(), str::to_string) }
    pub fn policy(&self) -> Option<&Policy> { self.meta().and_then(|m| m.policy.as_ref()) }
    pub fn key(&self) -> Option<&str> { match self { Node::Split { key, .. } | Node::Columns { key, .. } | Node::Flow { key, .. } => key.as_deref(), _ => None } }
    /// The way a line runs: a split's own, a row for columns and a flow.
    pub fn dir(&self) -> Option<Axis> { match self { Node::Split { dir, .. } => Some(*dir), Node::Columns { .. } | Node::Flow { .. } => Some(Axis::Row), _ => None } }
    /// The nodes under it: a line's kids, a dock's one.
    pub fn kids(&self) -> &[Node] { match self { Node::Split { kids, .. } | Node::Columns { kids, .. } | Node::Flow { kids, .. } => kids, Node::Dock { kid, .. } => std::slice::from_ref(kid), _ => &[] } }
    pub fn kids_mut(&mut self) -> &mut [Node] { match self { Node::Split { kids, .. } | Node::Columns { kids, .. } | Node::Flow { kids, .. } => kids, Node::Dock { kid, .. } => std::slice::from_mut(kid), _ => &mut [] } }
    /// A line's kids and their shares, to change together.
    pub fn line_mut(&mut self) -> Option<(&mut Vec<Node>, &mut Vec<f64>)> { match self { Node::Split { kids, weights, .. } | Node::Columns { kids, weights, .. } | Node::Flow { kids, weights, .. } => Some((kids, weights)), _ => None } }
    pub fn weights(&self) -> &[f64] { match self { Node::Split { weights, .. } | Node::Columns { weights, .. } | Node::Flow { weights, .. } => weights, _ => &[] } }
    pub fn at(&self, path: &[usize]) -> Option<&Node> { path.iter().try_fold(self, |n, i| n.kids().get(*i)) }
    pub fn at_mut(&mut self, path: &[usize]) -> Option<&mut Node> { path.iter().try_fold(self, |n, i| n.kids_mut().get_mut(*i)) }

    /// Every tile under it, in order.
    pub fn leaves(&self) -> Vec<Id> { self.specs().into_iter().map(|s| s.id.clone()).collect() }
    pub fn specs(&self) -> Vec<&TileSpec> {
        match self { Node::Leaf(s) => vec![s], Node::Tabs { kids, .. } => kids.iter().collect(), other => other.kids().iter().flat_map(Node::specs).collect() }
    }
    pub fn specs_mut(&mut self) -> Vec<&mut TileSpec> {
        match self { Node::Leaf(s) => vec![s], Node::Tabs { kids, .. } => kids.iter_mut().collect(), other => other.kids_mut().iter_mut().flat_map(Node::specs_mut).collect() }
    }
    pub fn spec(&self, id: &str) -> Option<&TileSpec> { self.specs().into_iter().find(|s| s.id == id) }
    pub fn has(&self, id: &str) -> bool { self.spec(id).is_some() }
    /// The tiles in front: a tab set's active one, whether or not its dock is open.
    pub fn shown(&self) -> Vec<Id> {
        match self { Node::Leaf(s) => vec![s.id.clone()], Node::Tabs { kids, active, .. } => kids.get(*active).map(|s| s.id.clone()).into_iter().collect(), other => other.kids().iter().flat_map(Node::shown).collect() }
    }
    /// The tiles on screen: the ones in front, less what a shut dock holds and what an open dock doesn't show.
    pub fn visible(&self) -> Vec<Id> {
        match self {
            Node::Dock { open, .. } => if *open { self.dock_view() } else { Vec::new() },
            Node::Leaf(_) | Node::Tabs { .. } => self.shown(),
            other => other.kids().iter().flat_map(Node::visible).collect(),
        }
    }
    /// What an open dock shows: the tiles its view names, else what its kid shows.
    fn dock_view(&self) -> Vec<Id> { match self { Node::Dock { view: Some(view), .. } => view.clone(), Node::Dock { kid, .. } => kid.visible(), _ => Vec::new() } }
}

// ── finding ───────────────────────────────────────────────────────────────────────────────────────────────────

/// What a step names in the tree: a tile, or a line by its key.
#[derive(Clone, Copy)]
pub enum Target<'a> { Tile(&'a str), Key(&'a str) }

fn is_target(n: &Node, target: Target) -> bool {
    match (target, n) {
        (Target::Key(key), n) => n.is_line() && n.key() == Some(key),
        (Target::Tile(id), Node::Leaf(s)) => s.id == id,
        (Target::Tile(id), Node::Tabs { kids, .. }) => kids.iter().any(|s| s.id == id),
        _ => false,
    }
}

/// The line that holds a tile's slot (or a keyed line), and where in it. A dock is passed through: it is no line.
pub fn parent_of(root: &Node, target: Target) -> Option<(Path, usize)> {
    fn go(n: &Node, target: Target, path: &mut Path) -> Option<(Path, usize)> {
        if let Node::Dock { kid, .. } = n { path.push(0); let found = go(kid, target, path); path.pop(); return found }
        if !n.is_line() { return None }
        if let Some(i) = n.kids().iter().position(|k| is_target(k, target)) { return Some((path.clone(), i)) }
        for (i, k) in n.kids().iter().enumerate() { path.push(i); let found = go(k, target, path); path.pop(); if found.is_some() { return found } }
        None
    }
    go(root, target, &mut Vec::new())
}

/// The line keyed `key` (a screen's named container).
pub fn node_by_key(root: &Node, key: &str) -> Option<Path> {
    fn go(n: &Node, key: &str, path: &mut Path) -> Option<Path> {
        if let Node::Dock { kid, .. } = n { path.push(0); let found = go(kid, key, path); path.pop(); return found }
        if !n.is_line() { return None }
        if n.key() == Some(key) { return Some(path.clone()) }
        for (i, k) in n.kids().iter().enumerate() { path.push(i); let found = go(k, key, path); path.pop(); if found.is_some() { return found } }
        None
    }
    go(root, key, &mut Vec::new())
}

/// The container with this id (`s2`, `d4`).
pub fn node_by_id(root: &Node, id: &str) -> Option<Path> {
    fn go(n: &Node, id: &str, path: &mut Path) -> Option<Path> {
        if n.is_leaf() { return None }
        if n.id() == Some(id) { return Some(path.clone()) }
        for (i, k) in n.kids().iter().enumerate() { path.push(i); let found = go(k, id, path); path.pop(); if found.is_some() { return found } }
        None
    }
    go(root, id, &mut Vec::new())
}

/// The containers a tile sits in, outermost first, each by its path.
pub fn chain_of(root: &Node, id: &str) -> Vec<Path> {
    let mut out = Vec::new();
    let mut path = Vec::new();
    let mut n = root;
    loop {
        match n {
            Node::Leaf(_) => return out,
            Node::Tabs { kids, .. } => { if kids.iter().any(|s| s.id == id) { out.push(path.clone()) } return out }
            other => {
                let Some(i) = other.kids().iter().position(|k| k.has(id)) else { return out };
                out.push(path.clone());
                path.push(i);
                n = &other.kids()[i];
            }
        }
    }
}

/// The containers over the node at `path`, outermost first, and itself when it is one.
pub fn node_chain(root: &Node, path: &[usize]) -> Vec<Path> {
    (0..=path.len()).map(|n| path[..n].to_vec()).filter(|p| root.at(p).is_some_and(|n| !n.is_leaf())).collect()
}

pub fn tabs_of(root: &Node, id: &str) -> Option<Path> { chain_of(root, id).pop().filter(|p| root.at(p).is_some_and(Node::is_tabs)) }
/// The innermost dock that holds a tile.
pub fn dock_of(root: &Node, id: &str) -> Option<Path> { chain_of(root, id).into_iter().rev().find(|p| root.at(p).is_some_and(Node::is_dock)) }
pub fn docks(root: &Node) -> Vec<Path> {
    fn go(n: &Node, path: &mut Path, out: &mut Vec<Path>) {
        if n.is_dock() { out.push(path.clone()) }
        for (i, k) in n.kids().iter().enumerate() { path.push(i); go(k, path, out); path.pop(); }
    }
    let mut out = Vec::new();
    go(root, &mut Vec::new(), &mut out);
    out
}
/// The tiles not in a dock.
pub fn pinned_tiles(n: &Node) -> Vec<Id> { match n { Node::Dock { .. } => Vec::new(), Node::Leaf(_) | Node::Tabs { .. } => n.leaves(), other => other.kids().iter().flat_map(pinned_tiles).collect() } }
/// The line over the node at `path`, when the node is a kid of one.
pub fn parent_node(root: &Node, path: &[usize]) -> Option<(Path, usize)> {
    let (i, up) = path.split_last()?;
    root.at(up).filter(|n| n.is_line()).map(|_| (up.to_vec(), *i))
}
/// The flow a tile is a column of (the innermost), and which column.
pub fn flow_holding(root: &Node, id: &str) -> Option<(Path, usize)> {
    let path = chain_of(root, id).into_iter().rev().find(|p| root.at(p).is_some_and(Node::is_flow))?;
    let ci = column_of(root.at(&path)?, Some(id))?;
    Some((path, ci))
}
/// The flow column a tile is in.
pub fn column_of(flow: &Node, id: Option<&str>) -> Option<usize> { let id = id?; flow.kids().iter().position(|k| k.has(id)) }
pub fn tile_of_column(flow: &Node, i: usize) -> Option<Id> { flow.kids().get(i).and_then(|k| k.leaves().into_iter().next()) }

// ── reshaping ─────────────────────────────────────────────────────────────────────────────────────────────────

/// A flow's memory, less what names a tile it no longer holds; a flow with columns always has a wide one.
pub fn tidy_flow(mut flow: Node) -> Node {
    let here = flow.leaves();
    let first = tile_of_column(&flow, 0);
    if let Node::Flow { memory: m, kids, .. } = &mut flow {
        let has = |id: &Id| here.contains(id);
        for slot in [&mut m.anchor, &mut m.keep, &mut m.read] { if slot.as_ref().is_some_and(|id| !has(id)) { *slot = None } }
        if m.anchor.is_none() && !kids.is_empty() { m.anchor = first }
        m.sides.retain(|(tile, _)| has(tile));
        m.recent.retain(has);
        m.held.retain(has);
        m.trail.retain(|t| has(&t.tile));
        for t in &mut m.trail { if t.from.as_ref().is_some_and(|id| !has(id)) { t.from = None } if t.ahead.as_ref().is_some_and(|id| !has(id)) { t.ahead = None } }
        m.trail.retain(|t| t.from.is_some() || t.ahead.is_some());
    }
    flow
}

/// The tree without a tile: a tab set of one is the tile, a split of one is its kid. None: nothing is left.
pub fn remove(n: Node, id: &str) -> Option<Node> {
    match n {
        Node::Leaf(s) => (s.id != id).then_some(Node::Leaf(s)),
        Node::Dock { side, open, kid, view, keeps, meta } => {
            let kid = remove(*kid, id)?;
            let view = view.map(|v| v.into_iter().filter(|t| t != id).collect::<Vec<_>>()).filter(|v| !v.is_empty());
            Some(Node::Dock { side, open, kid: Box::new(kid), view, keeps, meta })
        }
        Node::Tabs { active, mut kids, meta } => {
            let Some(at) = kids.iter().position(|s| s.id == id) else { return Some(Node::Tabs { active, kids, meta }) };
            kids.remove(at);
            if kids.is_empty() { return None }
            if kids.len() == 1 && meta.policy.is_none() { return Some(Node::Leaf(kids.remove(0))) }
            let active = if at < active { active - 1 } else if at == active { at.min(kids.len() - 1) } else { active };
            Some(Node::Tabs { active, kids, meta: meta.kept() })
        }
        mut line => {
            let (was, weights) = { let (kids, weights) = line.line_mut()?; (std::mem::take(kids), std::mem::take(weights)) };
            let (mut kids, mut kept) = (Vec::new(), Vec::new());
            for (k, w) in was.into_iter().zip(weights) { if let Some(k) = remove(k, id) { kids.push(k); kept.push(w) } }
            lessened(line, kids, kept, true)
        }
    }
}

/// A line after some of its kids went: columns stay as they are, a flow is tidied, a split of one is its kid.
fn lessened(mut line: Node, mut kids: Vec<Node>, weights: Vec<f64>, pair_folds: bool) -> Option<Node> {
    let alone = kids.len() == 1 && match &line { Node::Split { pair, key, meta, .. } => (pair_folds && *pair) || (key.is_none() && !meta.has_policy()), _ => false };
    match &line {
        Node::Columns { .. } => {}
        Node::Flow { key, .. } => { if kids.is_empty() && key.is_none() { return None } }
        _ => { if kids.is_empty() { return None } if alone { return kids.pop() } }
    }
    if let Some((k, w)) = line.line_mut() { *k = kids; *w = weights }
    Some(if line.is_flow() { tidy_flow(line) } else { line })
}

/// The tree without the node at `path`.
pub fn without(n: Node, path: &[usize]) -> Option<Node> {
    let Some((i, rest)) = path.split_first() else { return None };
    match n {
        Node::Dock { side, open, kid, view, keeps, meta } => without(*kid, rest).map(|kid| Node::Dock { side, open, kid: Box::new(kid), view, keeps, meta }),
        mut line if line.is_line() => {
            let (was, weights) = { let (kids, weights) = line.line_mut()?; (std::mem::take(kids), std::mem::take(weights)) };
            let (mut kids, mut kept) = (Vec::new(), Vec::new());
            for (j, (k, w)) in was.into_iter().zip(weights).enumerate() {
                let k = if j == *i { without(k, rest) } else { Some(k) };
                if let Some(k) = k { kids.push(k); kept.push(w) }
            }
            lessened(line, kids, kept, false)
        }
        other => Some(other),
    }
}

/// Puts `by` where the node at `path` is.
pub fn replace_at(root: &mut Node, path: &[usize], by: Node) { if let Some(slot) = root.at_mut(path) { *slot = by } }

/// The tile `from` becomes `to`, wherever it sits and wherever a flow remembers it.
pub fn swap_leaf(n: &mut Node, from: &str, to: &TileSpec) -> bool {
    match n {
        Node::Leaf(s) => { if s.id != from { return false } *s = to.clone(); true }
        Node::Tabs { kids, .. } => match kids.iter_mut().find(|s| s.id == from) { Some(s) => { *s = to.clone(); true } None => false },
        other => {
            if let Node::Flow { memory: m, .. } = other {
                let was = |x: &mut Id| if x == from { *x = to.id.clone() };
                for slot in [&mut m.anchor, &mut m.keep, &mut m.read] { if let Some(x) = slot { was(x) } }
                m.held.iter_mut().for_each(was);
                m.recent.iter_mut().for_each(was);
                m.sides.iter_mut().for_each(|(tile, _)| was(tile));
                for t in &mut m.trail { was(&mut t.tile); if let Some(x) = &mut t.from { was(x) } if let Some(x) = &mut t.ahead { was(x) } }
            }
            other.kids_mut().iter_mut().any(|k| swap_leaf(k, from, to))
        }
    }
}

/// The slot a tile is (its leaf, or its tab set), changed by `f`.
fn map_slot(n: Node, id: &str, f: &mut dyn FnMut(Node) -> Node) -> Node {
    match n {
        Node::Leaf(ref s) => if s.id == id { f(n) } else { n },
        Node::Tabs { ref kids, .. } => if kids.iter().any(|s| s.id == id) { f(n) } else { n },
        Node::Dock { side, open, kid, view, keeps, meta } => Node::Dock { side, open, kid: Box::new(map_slot(*kid, id, f)), view, keeps, meta },
        mut line => {
            if let Some((kids, _)) = line.line_mut() { *kids = std::mem::take(kids).into_iter().map(|k| map_slot(k, id, f)).collect() }
            line
        }
    }
}

/// `add` beside a tile's slot: a new kid of the line that runs that way, else a new split round the slot.
pub fn beside_slot(mut root: Node, target: &str, add: Node, dir: Dir, weight: f64, pair: bool) -> Node {
    let axis = dir.axis();
    let wrap = |slot: Node, add: Node, pair: bool| {
        let (kids, weights) = if dir.before() { (vec![add, slot], vec![weight, 1.0 - weight]) } else { (vec![slot, add], vec![1.0 - weight, weight]) };
        Node::Split { dir: axis, weights, kids, key: None, pair, meta: Meta::default() }
    };
    let mut add = Some(add);
    if !pair && let Some((path, i)) = parent_of(&root, Target::Tile(target)) && let Some(parent) = root.at_mut(&path) {
        let joins = parent.dir() == Some(axis) && !matches!(parent, Node::Split { pair: true, .. }) && (parent.key().is_none() || matches!(parent, Node::Columns { .. } | Node::Flow { .. }));
        if joins && let Some((kids, weights)) = parent.line_mut() {
            let w = weights[i];
            let at = if dir.before() { i } else { i + 1 };
            kids.insert(at, add.take().expect("added once"));
            weights[i] = w * (1.0 - weight);
            weights.insert(at, w * weight);
            return root;
        }
    }
    map_slot(root, target, &mut |slot| match add.take() { Some(add) => wrap(slot, add, pair), None => slot })
}

/// `add` into a tile's tab set (made of the tile when it has none), in front unless `behind`.
pub fn tab_into(root: Node, target: &str, add: TileSpec, index: Option<usize>, behind: bool) -> Node {
    let mut add = Some(add);
    map_slot(root, target, &mut |slot| {
        let Some(add) = add.take() else { return slot };
        let (mut kids, shown, meta, was_tabs, was_active) = match slot {
            Node::Tabs { kids, active, meta } => { let shown = kids.get(active).map(|s| s.id.clone()); let len = kids.len(); let kids: Vec<TileSpec> = kids.into_iter().filter(|s| s.id != add.id).collect(); let _ = len; (kids, shown, meta.kept(), true, active) }
            Node::Leaf(s) => { let shown = Some(s.id.clone()); (vec![s], shown, Meta::default(), false, 0) }
            other => return other,
        };
        let default = if was_tabs { was_active.min(kids.len().saturating_sub(1)) + 1 } else { 1 };
        let at = index.unwrap_or(default).min(kids.len());
        let added = add.id.clone();
        kids.insert(at, add);
        let active = match &shown { Some(shown) if behind && *shown != added => kids.iter().position(|s| s.id == *shown).unwrap_or(at), _ => at };
        Node::Tabs { active, kids, meta }
    })
}

/// A tile along an edge of everything else.
pub fn edge(rest: Node, src: Node, dir: Dir, weight: f64) -> Node {
    if dir.before() { split_of(dir.axis(), vec![src, rest], Some(vec![weight, 1.0 - weight])) } else { split_of(dir.axis(), vec![rest, src], Some(vec![1.0 - weight, weight])) }
}

/// Where a tile is put: beside another, into its tabs, or along an edge of the layout.
#[derive(Clone, Debug, PartialEq)]
pub enum Place {
    Split { target: Id, dir: Dir, pair: bool, weight: Option<f64> },
    Tabs { target: Id, index: Option<usize>, behind: bool },
    Edge { dir: Dir },
}

/// The tree with `src` moved. None: there is nowhere to move it (it is alone, or already there).
pub fn move_tile(root: &Node, src: &str, to: &Place) -> Option<Node> {
    let spec = root.spec(src)?.clone();
    if let Place::Tabs { target, index, .. } = to {
        if target == src { return None }
        if let Some(path) = tabs_of(root, target) && let Some(Node::Tabs { kids, .. }) = root.at(&path) && kids.iter().any(|s| s.id == src) { return reorder(root, src, index.unwrap_or(kids.len() - 1)) }
    }
    let mut target: Option<Id> = match to { Place::Edge { .. } => None, Place::Split { target, .. } | Place::Tabs { target, .. } => Some(target.clone()) };
    if target.as_deref() == Some(src) {
        let path = tabs_of(root, src)?;
        let Some(Node::Tabs { kids, .. }) = root.at(&path) else { return None };
        if kids.len() < 2 { return None }
        target = kids.iter().find(|s| s.id != src).map(|s| s.id.clone());
    }
    let rest = remove(root.clone(), src)?;
    if let Place::Edge { dir } = to { return Some(normalise(edge(rest, Node::Leaf(spec), *dir, 0.3), true)) }
    let target = target.filter(|t| rest.has(t))?;
    Some(normalise(match to {
        Place::Tabs { index, .. } => tab_into(rest, &target, spec, *index, false),
        Place::Split { dir, pair, weight, .. } => beside_slot(rest, &target, Node::Leaf(spec), *dir, weight.unwrap_or(0.5), *pair),
        Place::Edge { .. } => rest,
    }, true))
}

/// The dock's view takes the tile, as a press on its tab would.
pub fn choose_dock(dock: &mut Node, id: &str, open: bool, beside: bool, toggle: bool) {
    let shown = dock.dock_view();
    let Node::Dock { open: is_open, view, .. } = dock else { return };
    if open || !*is_open {
        *view = Some(if beside && *is_open { let mut v = shown; if !v.iter().any(|x| x == id) { v.push(id.to_string()) } v } else { vec![id.to_string()] });
    } else if toggle && view.as_ref().is_some_and(|v| v.len() > 1) {
        if let Some(v) = view { v.retain(|x| x != id) }
        return;
    }
    *is_open = open;
}

/// The tile comes to the front of its tab set, and of a dock that shows only some of its tiles.
pub fn activate(root: &mut Node, id: &str) -> bool {
    for path in chain_of(root, id) {
        if let Some(dock) = root.at_mut(&path) && let Node::Dock { view: Some(view), open, .. } = dock && !view.iter().any(|x| x == id) { let open = *open; choose_dock(dock, id, open, false, false) }
    }
    let Some(path) = tabs_of(root, id) else { return false };
    if let Some(Node::Tabs { kids, active, .. }) = root.at_mut(&path) && let Some(at) = kids.iter().position(|s| s.id == id) { *active = at }
    true
}

/// The next tab of a tile's set, brought to the front.
pub fn cycle(root: &mut Node, id: &str, dir: i64) -> Option<Id> {
    let path = tabs_of(root, id)?;
    let Some(Node::Tabs { kids, active, .. }) = root.at(&path) else { return None };
    let next = kids[((*active as i64 + dir).rem_euclid(kids.len() as i64)) as usize].id.clone();
    activate(root, &next);
    Some(next)
}

/// The tree with a tab moved to `index` in its set, in front.
pub fn reorder(root: &Node, id: &str, index: usize) -> Option<Node> {
    let path = tabs_of(root, id)?;
    let mut out = root.clone();
    if let Some(Node::Tabs { kids, active, .. }) = out.at_mut(&path) {
        let at = kids.iter().position(|s| s.id == id)?;
        let spec = kids.remove(at);
        let at = index.min(kids.len());
        kids.insert(at, spec);
        *active = at;
    }
    Some(out)
}

fn tabs_node(mut kids: Vec<TileSpec>, front: usize) -> Node { if kids.len() > 1 { Node::Tabs { active: front, kids, meta: Meta::default() } } else { Node::Leaf(kids.remove(0)) } }

/// The dock that keeps work takes these tiles (made, shut, on the right when there is none).
pub fn kept_in_dock(mut root: Node, kept: Vec<TileSpec>) -> Node {
    let Some(path) = docks(&root).into_iter().find(|p| matches!(root.at(p), Some(Node::Dock { keeps: true, .. }))) else {
        let dock = Node::Dock { side: Dir::Right, open: false, kid: Box::new(tabs_node(kept, 0)), view: None, keeps: true, meta: Meta::default() };
        return split_of(Axis::Row, vec![root, dock], Some(vec![0.7, 0.3]));
    };
    if let Some(Node::Dock { kid, .. }) = root.at_mut(&path) {
        let was = std::mem::replace(kid.as_mut(), empty_tabs());
        **kid = if matches!(was, Node::Leaf(_) | Node::Tabs { .. }) {
            let mut all: Vec<TileSpec> = was.specs().into_iter().cloned().collect();
            all.extend(kept);
            let front = all.len() - 1;
            tabs_node(all, front)
        } else { split_of(Axis::Col, vec![was, tabs_node(kept, 0)], Some(vec![0.5, 0.5])) };
    }
    root
}

fn edge_at(dir: Axis, i: usize, n: usize) -> Dir {
    let first = i == 0 || i < n - 1;
    match dir { Axis::Row => if first { Dir::Left } else { Dir::Right }, Axis::Col => if first { Dir::Up } else { Dir::Down } }
}

fn keeps_pinned(n: Option<Node>) -> Option<Node> { n.filter(|n| !pinned_tiles(n).is_empty()) }

/// A dock at an edge of everything else: a kid of the root when the root runs that way, else a split round it.
fn to_edge(rest: Node, dock: Node, weight: f64) -> Node {
    let Node::Dock { side, .. } = &dock else { return rest };
    let (side, ax) = (*side, side.axis());
    match rest {
        Node::Split { dir, mut weights, mut kids, key: None, pair, meta } if dir == ax => {
            let sum = weights.iter().sum::<f64>();
            let w = (weight / (1.0 - weight)) * if sum == 0.0 { 1.0 } else { sum };
            if side.before() { kids.insert(0, dock); weights.insert(0, w) } else { kids.push(dock); weights.push(w) }
            Node::Split { dir, weights, kids, key: None, pair, meta }
        }
        rest => if side.before() { split_of(ax, vec![dock, rest], Some(vec![weight, 1.0 - weight])) } else { split_of(ax, vec![rest, dock], Some(vec![1.0 - weight, weight])) },
    }
}

/// A tile (with its tab set) goes into a dock: where it is, or at the edge named.
pub fn wrap_dock(root: &Node, id: &str, to: Option<Dir>, open: bool, weight: f64) -> Option<Node> {
    if !root.has(id) || dock_of(root, id).is_some() || root.leaves().len() < 2 { return None }
    let set = tabs_of(root, id).and_then(|p| root.at(&p).cloned());
    if let Some(Node::Tabs { kids, .. }) = &set && root.leaves().iter().all(|x| kids.iter().any(|s| s.id == *x)) { return None }
    if let Some(to) = to {
        let mut rest = remove(root.clone(), id);
        let kid = match &set { Some(Node::Tabs { kids, active, meta }) => Node::Tabs { active: *active, kids: kids.clone(), meta: meta.kept() }, _ => Node::Leaf(root.spec(id)?.clone()) };
        if let Some(Node::Tabs { kids, .. }) = &set { for x in kids.iter().filter(|s| s.id != id) { rest = rest.and_then(|r| remove(r, &x.id)) } }
        let dock = Node::Dock { side: to, open, kid: Box::new(kid), view: None, keeps: false, meta: Meta::default() };
        return keeps_pinned(Some(to_edge(rest?, dock, weight)));
    }
    let side = parent_of(root, Target::Tile(id)).and_then(|(path, i)| root.at(&path).map(|p| edge_at(p.dir().unwrap_or(Axis::Row), i, p.kids().len()))).unwrap_or(Dir::Left);
    keeps_pinned(Some(map_slot(root.clone(), id, &mut |slot| Node::Dock { side, open, kid: Box::new(slot), view: None, keeps: false, meta: Meta::default() })))
}

/// The dock at `path` moves to another edge.
pub fn dock_to_edge(root: &Node, path: &[usize], to: Dir, weight: Option<f64>) -> Option<Node> {
    let dock = root.at(path)?.clone();
    let Node::Dock { side, .. } = &dock else { return None };
    let rest = without(root.clone(), path)?;
    let outer = parent_node(root, path).filter(|(up, i)| up.is_empty() && (*i == 0 || *i == root.kids().len() - 1) && root.dir() == Some(side.axis())).map(|(_, i)| { let sum = root.weights().iter().sum::<f64>(); root.weights()[i] / if sum == 0.0 { 1.0 } else { sum } });
    let mut moved = dock.clone();
    if let Node::Dock { side, .. } = &mut moved { *side = to }
    Some(to_edge(rest, moved, weight.unwrap_or_else(|| outer.filter(|o| *o > 0.0 && *o < 1.0).unwrap_or(0.26))))
}

/// The container at `path` goes into a dock: where it is, or at the edge named.
pub fn wrap_node_dock(root: &Node, path: &[usize], to: Option<Dir>, open: bool, weight: f64) -> Option<Node> {
    if path.is_empty() || (0..path.len()).any(|n| root.at(&path[..n]).is_some_and(Node::is_dock)) { return None }
    let c = root.at(path)?.clone();
    if let Some(to) = to {
        let rest = without(root.clone(), path)?;
        return keeps_pinned(Some(to_edge(rest, Node::Dock { side: to, open, kid: Box::new(c), view: None, keeps: false, meta: Meta::default() }, weight)));
    }
    let (up, i) = parent_node(root, path)?;
    let inside = c.leaves();
    if !pinned_tiles(root).iter().any(|id| !inside.contains(id)) { return None }
    let parent = root.at(&up)?;
    let side = edge_at(parent.dir()?, i, parent.kids().len());
    let mut out = root.clone();
    replace_at(&mut out, path, Node::Dock { side, open, kid: Box::new(c), view: None, keeps: false, meta: Meta::default() });
    Some(out)
}

/// The dock at `path` is no dock: its kid stands where it stood.
pub fn unwrap_dock(mut root: Node, path: &[usize]) -> Node {
    if let Some(Node::Dock { kid, .. }) = root.at(path).cloned() { if path.is_empty() { return *kid } replace_at(&mut root, path, *kid) }
    root
}

/// A share moves between a tile and its neighbour along `dir`.
pub fn resize(n: &mut Node, id: &str, dir: Axis, delta: f64, bounds: (f64, f64)) -> bool {
    if let Node::Dock { kid, .. } = n { return resize(kid, id, dir, delta, bounds) }
    if !n.is_line() { return false }
    let Some(i) = n.kids().iter().position(|k| k.has(id)) else { return false };
    if resize(&mut n.kids_mut()[i], id, dir, delta, bounds) { return true }
    if n.dir() != Some(dir) || n.kids().len() < 2 { return false }
    let Some((kids, weights)) = n.line_mut() else { return false };
    let j = if i < kids.len() - 1 { i + 1 } else { i - 1 };
    let sum = weights[i] + weights[j];
    let total = { let t = weights.iter().sum::<f64>(); if t == 0.0 { 1.0 } else { t } };
    let want = (weights[i] / total + delta).min(bounds.1).max(bounds.0) * total;
    weights[i] = want.min(sum).max(0.0);
    weights[j] = sum - weights[i];
    true
}

/// Every line's kids get even shares; a dock keeps its own. `skip`: a line that keeps its sizes.
pub fn even(n: &mut Node, path: &mut Path, skip: &dyn Fn(&[usize]) -> bool) {
    if let Node::Dock { kid, .. } = n { path.push(0); even(kid, path, skip); path.pop(); return }
    if !n.is_line() { return }
    for (i, k) in n.kids_mut().iter_mut().enumerate() { path.push(i); even(k, path, skip); path.pop(); }
    if skip(path) || n.is_flow() { return }
    let Some((kids, weights)) = n.line_mut() else { return };
    let total = { let t = weights.iter().sum::<f64>(); if t == 0.0 { 1.0 } else { t } };
    let kept: f64 = kids.iter().zip(weights.iter()).filter(|(k, _)| k.is_dock()).map(|(_, w)| w / total).sum();
    let pinned = kids.iter().filter(|k| !k.is_dock()).count() as f64;
    *weights = kids.iter().zip(weights.iter()).map(|(k, w)| if k.is_dock() { w / total } else { (1.0 - kept) / pinned }).collect();
}

fn good(w: f64) -> bool { w.is_finite() && w > 0.0 }

fn empty(k: &Node) -> bool {
    match k { Node::Tabs { kids, .. } => kids.is_empty(), Node::Split { kids, key, .. } | Node::Flow { kids, key, .. } => kids.is_empty() && key.is_none(), Node::Dock { kid, .. } => empty(kid), _ => false }
}

/// The tree in its plain shape: a split in a split the same way is one split, a tab set of one is its tile, shares
/// add up to one. Idempotent.
pub fn normalise(n: Node, top: bool) -> Node {
    const MIN: f64 = 0.05;
    match n {
        Node::Leaf(_) => n,
        Node::Dock { side, open, kid, view, keeps, meta } => {
            let k = normalise(*kid, false);
            if top { return if keeps { split_of(Axis::Row, vec![Node::Dock { side, open, kid: Box::new(k), view, keeps, meta }], None) } else { k } }
            match k {
                Node::Dock { kid: inner, meta: inner_meta, .. } => { let policy = meta.policy.clone().or(inner_meta.policy); Node::Dock { side, open, kid: inner, view, keeps, meta: Meta { id: meta.id, policy } } }
                k => Node::Dock { side, open, kid: Box::new(k), view, keeps, meta },
            }
        }
        Node::Tabs { active, kids, meta } => {
            let mut ids: Vec<TileSpec> = Vec::new();
            for s in kids { if !ids.iter().any(|x| x.id == s.id) { ids.push(s) } }
            if ids.is_empty() { return Node::Tabs { active: 0, kids: ids, meta: meta.kept() } }
            if ids.len() == 1 && meta.policy.is_none() { return Node::Leaf(ids.remove(0)) }
            Node::Tabs { active: active.min(ids.len() - 1), kids: ids, meta: meta.kept() }
        }
        Node::Flow { kids, memory, key, meta, .. } => {
            let mut out: Vec<Node> = Vec::new();
            for k in kids {
                let k = normalise(k, false);
                if empty(&k) { continue }
                match k { Node::Split { dir: Axis::Row, kids, key: None, meta: Meta { policy: None, .. }, .. } => out.extend(kids), k => out.push(k) }
            }
            let weights = out.iter().map(|_| 1.0).collect();
            tidy_flow(Node::Flow { weights, kids: out, memory, key, meta })
        }
        Node::Columns { weights, kids, source, key, meta } => {
            let (mut out, mut ws) = (Vec::new(), Vec::new());
            for (k, w) in kids.into_iter().zip(weights) { let k = normalise(k, false); if !empty(&k) { out.push(k); ws.push(if good(w) { w } else { 1.0 }) } }
            Node::Columns { weights: ws, kids: out, source, key, meta }
        }
        Node::Split { dir, weights, kids, key, pair, meta } => {
            let (mut out, mut ws): (Vec<Node>, Vec<f64>) = (Vec::new(), Vec::new());
            for (i, k) in kids.into_iter().enumerate() {
                let k = normalise(k, false);
                if empty(&k) { continue }
                let w = weights.get(i).copied().filter(|w| good(*w)).unwrap_or(1.0);
                match k {
                    Node::Split { dir: kd, weights: kw, kids: kk, key: None, pair: false, meta: Meta { policy: None, .. } } if kd == dir && key.is_none() && !pair => {
                        let sum = { let s = kw.iter().sum::<f64>(); if s == 0.0 { 1.0 } else { s } };
                        for (kid, x) in kk.into_iter().zip(kw) { out.push(kid); ws.push(w * x / sum) }
                    }
                    k => { out.push(k); ws.push(w) }
                }
            }
            if out.len() == 1 && (pair || (key.is_none() && !meta.has_policy())) {
                match out.pop().expect("one kid") {
                    Node::Dock { side, open, kid, view, keeps, meta: dock_meta } if top => {
                        if keeps { return Node::Split { dir, weights: vec![1.0], kids: vec![Node::Dock { side, open, kid, view, keeps, meta: dock_meta }], key, pair, meta } }
                        return *kid;
                    }
                    only => return only,
                }
            }
            if out.is_empty() { return Node::Split { dir, weights: ws, kids: out, key, pair, meta } }
            let sum = { let s = ws.iter().sum::<f64>(); if s == 0.0 { 1.0 } else { s } };
            let ws: Vec<f64> = ws.iter().map(|w| (w / sum).max(MIN)).collect();
            let again: f64 = ws.iter().sum();
            Node::Split { dir, weights: ws.iter().map(|w| w / again).collect(), kids: out, key, pair, meta }
        }
    }
}

/// Container ids a layout brought from elsewhere are forgotten where `gone` says so, to be stamped again.
pub fn forget_ids(n: &mut Node, gone: &dyn Fn(u64) -> bool) {
    if n.is_leaf() { return }
    if let Some(meta) = n.meta_mut() && let Some(id) = &meta.id && stamped(id).is_none_or(|(_, num)| gone(num)) { meta.id = None }
    for k in n.kids_mut() { forget_ids(k, gone) }
}

/// A stamped id's letter and number: `s12` is ('s', 12).
pub fn stamped(id: &str) -> Option<(char, u64)> {
    let mut chars = id.chars();
    let letter = chars.next().filter(|c| "sgdcf".contains(*c))?;
    let digits = chars.as_str();
    (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())).then(|| digits.parse().ok()).flatten().map(|n| (letter, n))
}

// ── where a spine goes ────────────────────────────────────────────────────────────────────────────────────────

/// Which side of a row's open tiles a tile's spine gathers on, and the tile it sits against.
pub fn spine_edge(row: &Node, collapsed: &dyn Fn(&str) -> bool, id: &str, policy: &str, before: bool, unfold: bool) -> Option<(Id, bool)> {
    if policy == "invoker" { return None }
    let kids = row.kids();
    let i = kids.iter().position(|k| k.has(id))? as f64;
    let open: Vec<f64> = kids.iter().enumerate().filter(|(_, k)| k.leaves().iter().any(|t| !collapsed(t))).map(|(n, _)| n as f64).collect();
    let others: Vec<f64> = open.iter().copied().filter(|n| *n != i).collect();
    let spread = if unfold { &others } else { &open };
    let middle = |s: &[f64]| (s[0] + s[s.len() - 1]) / 2.0;
    let remembered = match row { Node::Flow { memory, .. } => { let here = kids[i as usize].leaves(); memory.sides.iter().find(|(tile, _)| here.contains(tile)).map(|(_, left)| *left) } _ => None };
    let mut left = policy == "start" || (policy == "book" && match remembered { Some(left) => left, None => if spread.is_empty() { before } else { i <= middle(spread) } });
    if policy == "centre" {
        let folded: Vec<f64> = kids.iter().enumerate().filter(|(_, k)| k.leaves().iter().all(|t| collapsed(t))).map(|(n, _)| n as f64).collect();
        left = if collapsed(id) { folded.iter().position(|n| *n == i).is_some_and(|at| (at as f64) < (folded.len() as f64 / 2.0).floor()) } else if spread.is_empty() { before } else { i <= middle(spread) };
    }
    if unfold && policy == "book" && !others.is_empty() && i > others[0] && i < others[others.len() - 1] { return None }
    let edge = if left { others.first() } else { others.last() }.copied();
    if unfold && edge.is_none() { return None }
    let n = match edge { Some(edge) if unfold => edge, None => i, Some(edge) => if (left && i < edge) || (!left && i > edge) { i } else { edge } };
    Some((kids[n as usize].leaves().into_iter().next()?, left))
}

/// The order a flow's shown columns are drawn in: spines gathered to the sides its policy says.
fn spine_order(flow: &Node, shown: &[usize], spines: &[usize], policy: &str) -> Vec<usize> {
    let kids = flow.kids();
    let folded: Vec<Id> = kids.iter().enumerate().filter(|(i, _)| !shown.contains(i) || spines.contains(i)).flat_map(|(_, k)| k.leaves()).collect();
    let collapsed = |t: &str| folded.iter().any(|x| x == t);
    let edges: Vec<(usize, Option<(Id, bool)>)> = shown.iter().filter(|i| spines.contains(i)).map(|i| (*i, kids[*i].leaves().first().and_then(|t| spine_edge(flow, &collapsed, t, policy, false, false)))).collect();
    if edges.iter().all(|(_, edge)| edge.is_none()) { return shown.to_vec() }
    let Node::Flow { memory, .. } = flow else { return shown.to_vec() };
    let position = |i: usize| { let here = kids[i].leaves(); memory.sides.iter().position(|(tile, _)| here.contains(tile)) };
    let mut stacks: Vec<usize> = shown.iter().copied().filter(|i| spines.contains(i)).collect();
    stacks.sort_by(|a, b| match (position(*a), position(*b)) { (Some(x), Some(y)) => x.cmp(&y), _ => a.cmp(b) });
    let side = |i: &usize, left: bool| edges.iter().any(|(n, edge)| n == i && edge.as_ref().is_some_and(|(_, l)| *l == left));
    stacks.iter().copied().filter(|i| side(i, true)).chain(shown.iter().copied().filter(|i| !spines.contains(i))).chain(stacks.iter().copied().filter(|i| side(i, false))).collect()
}

// ── where each tile sits ──────────────────────────────────────────────────────────────────────────────────────

/// How much of itself a flow column shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cover { Full, Peek, Spine }

impl Cover {
    pub fn word(self) -> &'static str { match self { Cover::Full => "full", Cover::Peek => "peek", Cover::Spine => "spine" } }
}

#[derive(Clone, Debug)]
pub struct Squeezed { pub i: usize, pub cover: Cover, pub width: f64, pub natural: f64 }

/// A flow's columns in a width: one wide, the nearest and newest as wide as there is room for, the rest spines.
pub fn squeeze(flow: &Node, mut width: f64, holds: &dyn Fn(&str) -> bool, policy: &Effective, folded: Option<&dyn Fn(&str) -> bool>, gap: f64) -> Vec<Squeezed> {
    let Node::Flow { memory, kids, .. } = flow else { return Vec::new() };
    let n = kids.len();
    if n == 0 { return Vec::new() }
    if policy.min_width == 0.0 {
        let room = (width - gap * (n as f64 - 1.0)).max(0.0);
        return (0..n).map(|i| { let size = (room / n as f64).floor() + if (i as f64) < room % n as f64 { 1.0 } else { 0.0 }; Squeezed { i, cover: Cover::Full, width: size, natural: size } }).collect();
    }
    let full = width.min(SPINE.max(if policy.by("readable").is_some() { policy.readable.max(policy.min_width) } else { policy.min_width }));
    let anchor = column_of(flow, memory.anchor.as_deref()).unwrap_or(0);
    let keep = column_of(flow, memory.keep.as_deref()).filter(|k| *k != anchor);
    let held: Vec<usize> = memory.held.iter().filter_map(|id| column_of(flow, Some(id))).collect();
    let busy = |i: usize| kids[i].leaves().iter().any(|id| holds(id));
    let far = |i: usize| (i as f64 - anchor as f64).abs();
    let mut shown: Vec<usize> = (0..n).collect();
    shown.sort_by(|a, b| far(*a).partial_cmp(&far(*b)).unwrap().then(b.cmp(a)));
    shown.truncate((1.0 + ((width - full.min(PEEK)) / (SPINE + gap)).floor()).max(1.0) as usize);
    shown.sort();
    width -= gap * (shown.len() as f64 - 1.0).max(0.0);
    let mut cover: Vec<(usize, Cover)> = shown.iter().map(|i| (*i, Cover::Spine)).collect();
    let set = |cover: &mut Vec<(usize, Cover)>, i: usize, c: Cover| if let Some(slot) = cover.iter_mut().find(|(n, _)| *n == i) { slot.1 = c };
    let mut spare = width - shown.len() as f64 * SPINE;
    let recent = |i: usize| kids[i].leaves().iter().filter_map(|id| memory.recent.iter().position(|x| x == id)).max().map_or(-1.0, |at| at as f64);
    let rank = |i: usize| if busy(i) { -3.0 } else if recent(i) >= 0.0 { -2.0 + 1.0 / (recent(i) + 2.0) } else if Some(i) == keep { 0.25 } else if held.contains(&i) { 0.5 } else { far(i) };
    if shown.contains(&anchor) { set(&mut cover, anchor, Cover::Full); spare -= spare.min(full - SPINE) }
    let mut by_rank = shown.clone();
    by_rank.sort_by(|a, b| rank(*a).partial_cmp(&rank(*b)).unwrap().then(b.cmp(a)));
    for i in by_rank {
        if i == anchor || folded.is_some_and(|folded| kids[i].leaves().iter().all(|t| folded(t))) { continue }
        if spare >= full - SPINE { set(&mut cover, i, Cover::Full); spare -= full - SPINE } else if spare >= PEEK - SPINE { set(&mut cover, i, Cover::Peek); spare -= PEEK - SPINE }
    }
    let cover_of = |cover: &Vec<(usize, Cover)>, i: usize| cover.iter().find(|(n, _)| *n == i).map_or(Cover::Spine, |(_, c)| *c);
    let mut w: Vec<(usize, f64)> = shown.iter().map(|i| (*i, if *i == anchor { full.min(width - (shown.len() as f64 - 1.0) * SPINE) } else { match cover_of(&cover, *i) { Cover::Full => full, Cover::Peek => PEEK, Cover::Spine => SPINE } })).collect();
    let add = |w: &mut Vec<(usize, f64)>, i: usize, by: f64| if let Some(slot) = w.iter_mut().find(|(n, _)| *n == i) { slot.1 += by };
    let peeks: Vec<usize> = shown.iter().copied().filter(|i| cover_of(&cover, *i) == Cover::Peek).collect();
    let mut left = peeks.len();
    while left > 0 && spare > 0.0 {
        let i = peeks[peeks.len() - left];
        let more = (full - PEEK).min((spare / left as f64).floor());
        add(&mut w, i, more);
        spare -= more;
        left -= 1;
    }
    if shown.contains(&anchor) { add(&mut w, anchor, spare.max(0.0)) }
    let over = w.iter().map(|(_, x)| *x).sum::<f64>() - width;
    if over > 0.0 && shown.contains(&anchor) && let Some(slot) = w.iter_mut().find(|(n, _)| *n == anchor) { slot.1 = (slot.1 - over).max(1.0) }
    let fulls: Vec<usize> = shown.iter().copied().filter(|i| cover_of(&cover, *i) == Cover::Full).collect();
    if fulls.len() > 1 {
        let room: f64 = fulls.iter().map(|i| w.iter().find(|(n, _)| n == i).map_or(0.0, |(_, x)| *x)).sum();
        for (n, i) in fulls.iter().enumerate() { if let Some(slot) = w.iter_mut().find(|(k, _)| k == i) { slot.1 = (room / fulls.len() as f64).floor() + if (n as f64) < room % fulls.len() as f64 { 1.0 } else { 0.0 } } }
    }
    let spines: Vec<usize> = shown.iter().copied().filter(|i| cover_of(&cover, *i) == Cover::Spine).collect();
    spine_order(flow, &shown, &spines, &policy.spines).into_iter().map(|i| {
        let (c, width) = (cover_of(&cover, i), w.iter().find(|(n, _)| *n == i).map_or(0.0, |(_, x)| *x));
        Squeezed { i, cover: c, width, natural: if c == Cover::Peek { width.max(full) } else { width } }
    }).collect()
}

#[derive(Clone, Debug)]
pub struct PlacedFlow { pub path: Path, pub rect: Rect, pub cols: Vec<(usize, Cover, Rect)> }

/// Where everything sits: each tile's box, each dock's, each flow's columns, each keyed container's.
#[derive(Clone, Debug, Default)]
pub struct Placed {
    pub rects: Vec<(Id, Rect)>,
    pub nodes: Vec<(String, Rect)>,
    pub docks: Vec<(Path, Rect)>,
    pub flows: Vec<PlacedFlow>,
    pub covers: Vec<(Id, Cover)>,
    /// Each line's kids' boxes, by the line's path: where a divider can be drawn between two of them.
    pub lines: Vec<(Path, Vec<Rect>)>,
}

impl Placed {
    pub fn rect(&self, id: &str) -> Option<Rect> { self.rects.iter().find(|(x, _)| x == id).map(|(_, r)| *r) }
    fn set(&mut self, id: &str, r: Rect) { match self.rects.iter_mut().find(|(x, _)| x == id) { Some(slot) => slot.1 = r, None => self.rects.push((id.to_string(), r)) } }
}

/// What placing reads beside the tree: the gap between tiles, which tiles are folded and how, which hold work.
pub struct Geometry<'a> {
    pub root: &'a Node,
    pub screen: &'a Policy,
    pub gap: f64,
    /// A folded tile's fixed size along an axis: a spine.
    pub fixed: &'a dyn Fn(&str, Axis) -> Option<f64>,
    pub folded: &'a dyn Fn(&str) -> bool,
    pub holds: &'a dyn Fn(&str) -> bool,
}

fn fit(xs: &mut [Option<f64>], room: f64, which: &[usize]) {
    let at: Vec<usize> = which.iter().copied().filter(|i| xs[*i].is_some_and(|x| x > 0.0)).collect();
    let sum: f64 = at.iter().map(|i| xs[*i].unwrap()).sum();
    if sum <= room { return }
    let floor: f64 = if room >= at.len() as f64 { 1.0 } else { 0.0 };
    for i in &at { xs[*i] = Some(floor.max((xs[*i].unwrap() * room / sum).floor())) }
    let mut over = at.iter().map(|i| xs[*i].unwrap()).sum::<f64>() - room;
    let mut by_size = at.clone();
    by_size.sort_by(|a, b| xs[*b].unwrap().partial_cmp(&xs[*a].unwrap()).unwrap());
    for i in by_size { if over <= 0.0 { break } let give = over.min(xs[i].unwrap() - floor); xs[i] = Some(xs[i].unwrap() - give); over -= give }
}

impl Geometry<'_> {
    /// The policy a flow sizes its columns by.
    fn flow_policy(&self, path: &[usize]) -> Effective {
        let chain = node_chain(self.root, path);
        let mut layers = vec![Layer { by: "screen".into(), policy: Some(self.screen), flow: false }];
        layers.extend(chain.iter().filter_map(|p| self.root.at(p)).map(|n| Layer { by: n.id_or_t(), policy: n.policy(), flow: n.is_flow() }));
        effective(&layers)
    }

    /// Places `n` (the node at `path`, or a dock's shown tiles standing in for its kid) in `r`.
    pub fn place(&self, n: &Node, path: &mut Path, r: Rect, as_pinned: Option<&[usize]>, out: &mut Placed) {
        match n {
            Node::Leaf(s) => out.set(&s.id, r),
            Node::Dock { .. } => {
                out.docks.push((path.clone(), r));
                if r.cols > 0.0 && r.rows > 0.0 { self.place_body(n, path, r, as_pinned, out) }
            }
            Node::Tabs { kids, active, .. } => { if let Some(s) = kids.get(*active) { out.set(&s.id, r) } }
            Node::Flow { .. } => self.place_flow(n, path, r, as_pinned, out),
            _ => self.place_line(n, path, r, as_pinned, out),
        }
    }

    /// A dock's body: the tiles its view names in a stack of their own, else its kid.
    fn place_body(&self, dock: &Node, path: &mut Path, r: Rect, as_pinned: Option<&[usize]>, out: &mut Placed) {
        let Node::Dock { side, kid, view, .. } = dock else { return };
        match view {
            Some(view) => {
                let specs: Vec<Node> = view.iter().filter_map(|id| kid.spec(id)).cloned().map(Node::Leaf).collect();
                let body = split_of(if side.axis() == Axis::Row { Axis::Col } else { Axis::Row }, specs, None);
                // Its tiles are leaves: no path under it names a node of the tree.
                self.place(&body, &mut vec![usize::MAX], r, as_pinned, out);
            }
            None => { path.push(0); self.place(kid, path, r, as_pinned, out); path.pop(); }
        }
    }

    fn place_line(&self, n: &Node, path: &mut Path, r: Rect, as_pinned: Option<&[usize]>, out: &mut Placed) {
        let (kids, weights, dir) = (n.kids(), n.weights(), n.dir().unwrap_or(Axis::Row));
        if let Some(key) = n.key() { out.nodes.push((key.to_string(), r)) }
        let row = dir == Axis::Row;
        let span = if row { r.cols } else { r.rows };
        let own = |k: &Node| k.policy().and_then(|p| p.cells("fixed"));
        let by_tile = |k: &Node| match k { Node::Tabs { kids, active, .. } => kids.get(*active).and_then(|s| (self.fixed)(&s.id, dir)), _ => None };
        let mut fixed: Vec<Option<f64>> = kids.iter().enumerate().map(|(i, k)| match k {
            Node::Leaf(s) => (self.fixed)(&s.id, dir),
            Node::Tabs { kids, active, .. } if kids.get(*active).is_some() => by_tile(k).or_else(|| own(k)),
            Node::Dock { open, meta, .. } if !as_pinned.is_some_and(|p| p.len() == path.len() + 1 && p[..path.len()] == path[..] && p[path.len()] == i) && (!*open || meta.policy.as_ref().and_then(|p| p.flag("overlay")) != Some(false)) => Some(0.0),
            k => own(k),
        }).collect();
        let participating = fixed.iter().filter(|f| **f != Some(0.0)).count() as f64;
        let gap = self.gap.min(((span - participating) / (participating - 1.0).max(1.0)).floor().max(0.0));
        let s = span - gap * (participating - 1.0).max(0.0);
        if fixed.iter().all(Option::is_some) && fixed.iter().map(|f| f.unwrap()).sum::<f64>() != s {
            let free = (0..kids.len()).rev().find(|j| { let k = &kids[*j]; !k.is_leaf() && !k.is_dock() && by_tile(k).is_none() && own(k).is_some() && fixed[*j] == own(k) });
            if let Some(i) = free { fixed[i] = None }
        }
        let mut mins: Vec<Option<f64>> = kids.iter().map(|k| Some(k.policy().and_then(|p| p.cells("min")).unwrap_or(if row { MIN_COLS } else { MIN_ROWS }))).collect();
        let maxs: Vec<Option<f64>> = kids.iter().map(|k| k.policy().and_then(|p| p.cells("max"))).collect();
        let open: Vec<usize> = (0..kids.len()).filter(|i| fixed[*i].is_none()).collect();
        let all: Vec<usize> = (0..kids.len()).collect();
        let sum_fixed = |fixed: &[Option<f64>]| fixed.iter().map(|f| f.unwrap_or(0.0)).sum::<f64>();
        fit(&mut fixed, (s - (open.len() as f64).min(s)).max(0.0), &all);
        fit(&mut mins, (s - sum_fixed(&fixed)).max(0.0), &open);
        let mins: Vec<f64> = mins.into_iter().map(|m| m.unwrap_or(0.0)).collect();
        let mut room = s - sum_fixed(&fixed);
        let mut capped: Vec<usize> = Vec::new();
        loop {
            let free: Vec<usize> = open.iter().copied().filter(|i| !capped.contains(i)).collect();
            let w = { let w: f64 = free.iter().map(|i| weights[*i]).sum(); if w == 0.0 { 1.0 } else { w } };
            let Some(i) = free.iter().copied().find(|i| free.len() > 1 && maxs[*i].is_some_and(|max| room * weights[*i] / w > max)) else { break };
            capped.push(i);
            room -= maxs[i].unwrap();
        }
        let flexible: Vec<usize> = open.iter().copied().filter(|i| !capped.contains(i)).collect();
        let flex = flexible.last().or(open.last()).copied();
        let wsum = { let w: f64 = flexible.iter().map(|i| weights[*i]).sum(); if w == 0.0 { 1.0 } else { w } };
        let need = |i: usize| fixed[i].unwrap_or(mins[i]);
        let mut sizes: Vec<Option<f64>> = fixed.clone();
        let mut used = sum_fixed(&fixed);
        for i in open.iter().copied() {
            if Some(i) == flex { continue }
            let later: f64 = open.iter().copied().filter(|j| *j != i && sizes[*j].is_none()).map(need).sum();
            let hi = s - used - later;
            let want = if capped.contains(&i) { maxs[i].unwrap() } else { round(room * weights[i] / wsum) };
            let size = mins[i].max(hi.min(maxs[i].unwrap_or(f64::INFINITY)).min(want));
            sizes[i] = Some(size);
            used += size;
        }
        if let Some(flex) = flex { sizes[flex] = Some((s - used).max(0.0)) }
        let mut cursor = if row { r.col } else { r.row };
        let mut boxes = Vec::new();
        for (i, k) in kids.iter().enumerate() {
            let size = sizes[i].unwrap_or(0.0);
            let at = cursor;
            cursor += size + if fixed[i] == Some(0.0) { 0.0 } else { gap };
            let slot = if row { Rect { col: at, cols: size, ..r } } else { Rect { row: at, rows: size, ..r } };
            boxes.push(slot);
            path.push(i);
            self.place(k, path, slot, as_pinned, out);
            path.pop();
        }
        out.lines.push((path.clone(), boxes));
    }

    fn place_flow(&self, flow: &Node, path: &mut Path, r: Rect, as_pinned: Option<&[usize]>, out: &mut Placed) {
        if let Some(key) = flow.key() { out.nodes.push((key.to_string(), r)) }
        let policy = self.flow_policy(path);
        let mut cols = Vec::new();
        let mut x = r.col;
        for c in squeeze(flow, r.cols, self.holds, &policy, Some(self.folded), self.gap) {
            let rect = Rect { col: x, cols: c.width, ..r };
            let boxed = Rect { cols: c.natural, ..rect };
            let mut inner = Placed::default();
            path.push(c.i);
            self.place(&flow.kids()[c.i], path, boxed, as_pinned, &mut inner);
            path.pop();
            for (id, t) in &inner.rects {
                let cut = ((t.col + t.cols).min(rect.col + rect.cols) - t.col).max(0.0);
                out.set(id, if c.cover == Cover::Peek { Rect { cols: cut, ..*t } } else { *t });
                match out.covers.iter_mut().find(|(x, _)| x == id) { Some(slot) => slot.1 = c.cover, None => out.covers.push((id.clone(), c.cover)) }
            }
            out.nodes.extend(inner.nodes);
            out.docks.extend(inner.docks);
            out.flows.extend(inner.flows);
            if c.cover == Cover::Full { out.lines.extend(inner.lines) }
            cols.push((c.i, c.cover, rect));
            x += c.width + self.gap;
        }
        out.flows.push(PlacedFlow { path: path.clone(), rect: r, cols });
    }

    /// The whole screen: the tree in `r`, then each open dock that slides, over it from its edge.
    pub fn place_screen(&self, r: Rect) -> (Placed, Vec<SlidDock>) {
        let mut base = Placed::default();
        self.place(self.root, &mut Vec::new(), r, None, &mut base);
        let mut slid = Vec::new();
        self.slide(self.root, &mut Vec::new(), r, &mut slid);
        for (path, rect) in base.docks.clone() {
            if rect.cols > 0.0 && rect.rows > 0.0 && let Some(Node::Dock { kid, .. }) = self.root.at(&path) { let mut inner = path.clone(); inner.push(0); self.slide(kid, &mut inner, rect, &mut slid) }
        }
        (base, slid)
    }

    /// The docks directly in a layer (not those inside another dock): the ones that slide over it.
    fn docks_in(n: &Node, path: &mut Path, out: &mut Vec<Path>) {
        if n.is_dock() { out.push(path.clone()); return }
        if n.is_line() { for (i, k) in n.kids().iter().enumerate() { path.push(i); Self::docks_in(k, path, out); path.pop(); } }
    }

    fn slide(&self, layer: &Node, layer_path: &mut Path, area: Rect, out: &mut Vec<SlidDock>) {
        let mut found = Vec::new();
        Self::docks_in(layer, layer_path, &mut found);
        let slides = |p: &Path| matches!(self.root.at(p), Some(Node::Dock { open: true, meta, .. }) if meta.policy.as_ref().and_then(|p| p.flag("overlay")) != Some(false));
        let open: Vec<Path> = found.into_iter().filter(slides).collect();
        for d in &open {
            let Some(dock @ Node::Dock { side, .. }) = self.root.at(d) else { continue };
            let mut full = Placed::default();
            self.place(layer, &mut layer_path.clone(), area, Some(d), &mut full);
            let own = full.docks.iter().find(|(p, _)| p == d).map_or(area, |(_, r)| *r);
            let peers: Vec<&Path> = open.iter().filter(|p| matches!(self.root.at(p), Some(Node::Dock { side: s, .. }) if s == side)).collect();
            let vertical = side.axis() == Axis::Row;
            let span = if vertical { area.rows } else { area.cols };
            let (i, n) = (peers.iter().position(|p| *p == d).unwrap_or(0) as f64, peers.len() as f64);
            let (start, end) = ((span * i / n).floor(), (span * (i + 1.0) / n).floor());
            let rect = if vertical { Rect { row: area.row + start, rows: end - start, ..own } } else { Rect { col: area.col + start, cols: end - start, ..own } };
            let mut placed = Placed::default();
            self.place_body(dock, &mut d.clone(), rect, None, &mut placed);
            out.push(SlidDock { path: d.clone(), rect, placed });
            if let Node::Dock { kid, view: None, .. } = dock { let mut inner = d.clone(); inner.push(0); self.slide(kid, &mut inner, rect, out) }
        }
    }
}

/// An open dock that slides over the layout: its box and the tiles in it.
#[derive(Clone, Debug)]
pub struct SlidDock { pub path: Path, pub rect: Rect, pub placed: Placed }

// ── the saved forms ───────────────────────────────────────────────────────────────────────────────────────────

fn saved_meta(x: &Value) -> Meta {
    let policy = Policy::of(x.get("policy"));
    Meta { id: x.get("id").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_string), policy: (!policy.is_empty()).then_some(policy) }
}

fn weights_of(x: &Value, n: usize) -> Option<Vec<f64>> {
    let list = x.get("weights")?.as_array()?;
    let ws: Vec<f64> = list.iter().filter_map(Value::as_f64).filter(|w| good(*w)).collect();
    (list.len() == n && ws.len() == n).then_some(ws)
}

/// A saved tree as a node. Both of the door's saved forms read: a split of two written `ratio, a, b`, and any
/// split written `weights, kids`. `leaf_of` makes each tile's spec from its saved leaf.
pub fn revive(s: &Value, leaf_of: &mut dyn FnMut(&Value) -> TileSpec) -> Node {
    let Some(t) = s.get("t").and_then(Value::as_str) else { return empty_tabs() };
    let kids_of = |leaf_of: &mut dyn FnMut(&Value) -> TileSpec| -> Vec<Node> { s.get("kids").and_then(Value::as_array).map(|kids| kids.iter().map(|k| revive(k, leaf_of)).collect()).unwrap_or_default() };
    let key = s.get("key").and_then(Value::as_str).map(str::to_string);
    match t {
        "leaf" => Node::Leaf(leaf_of(s)),
        "dock" => {
            let kid = s.get("kid").map_or_else(empty_tabs, |k| revive(k, leaf_of));
            let ids = kid.leaves();
            let view = s.get("view").and_then(Value::as_array).map(|v| v.iter().filter_map(Value::as_u64).filter_map(|i| ids.get(i as usize).cloned()).collect());
            Node::Dock { side: s.get("edge").and_then(Value::as_str).and_then(Dir::read).unwrap_or(Dir::Left), open: s.get("open") == Some(&json!(true)), kid: Box::new(kid), view, keeps: s.get("keeps") == Some(&json!(true)), meta: saved_meta(s) }
        }
        "flow" => {
            let kids = kids_of(leaf_of);
            let col = |v: Option<&Value>| -> Option<Id> { kids.get(v?.as_u64()? as usize).and_then(|k| k.leaves().into_iter().next()) };
            let list = |name: &str| -> Vec<Id> { s.get(name).and_then(Value::as_array).map(|v| v.iter().filter_map(|i| col(Some(i))).collect()).unwrap_or_default() };
            let memory = FlowMemory {
                anchor: col(s.get("anchor")), keep: col(s.get("keep")), read: col(s.get("read")), held: list("held"), recent: list("recent"),
                sides: s.get("sides").and_then(Value::as_array).map(|v| v.iter().filter_map(|x| Some((col(x.get("col"))?, match x.get("side")?.as_str()? { "left" => true, "right" => false, _ => return None }))).collect()).unwrap_or_default(),
                trail: s.get("trail").and_then(Value::as_array).map(|v| v.iter().filter_map(|x| Some(Trail { tile: col(x.get("col"))?, from: col(x.get("from")), ahead: col(x.get("ahead")) })).collect()).unwrap_or_default(),
            };
            let weights = kids.iter().map(|_| 1.0).collect();
            let mut flow = tidy_flow(Node::Flow { weights, kids, memory, key, meta: Meta::default() });
            if let Some(meta) = flow.meta_mut() { *meta = saved_meta(s) }
            flow
        }
        "columns" => {
            let kids = kids_of(leaf_of);
            let weights = weights_of(s, kids.len()).unwrap_or_else(|| kids.iter().map(|_| 1.0).collect());
            Node::Columns { weights, kids, source: s.get("source").and_then(Value::as_str).filter(|x| !x.is_empty()).map(str::to_string), key, meta: saved_meta(s) }
        }
        "tabs" => {
            let mut kids: Vec<TileSpec> = s.get("tabs").and_then(Value::as_array).map(|tabs| tabs.iter().filter(|l| l.get("t") == Some(&json!("leaf"))).map(|l| leaf_of(l)).collect()).unwrap_or_default();
            let meta = saved_meta(s);
            if kids.len() == 1 && meta.policy.is_none() { return Node::Leaf(kids.remove(0)) }
            let active = s.get("active").and_then(Value::as_u64).map(|a| a as usize).filter(|a| *a < kids.len()).unwrap_or(0);
            Node::Tabs { active, kids, meta }
        }
        _ => {
            let dir = if s.get("dir") == Some(&json!("col")) { Axis::Col } else { Axis::Row };
            if s.get("kids").is_some_and(Value::is_array) {
                let kids = kids_of(leaf_of);
                let weights = weights_of(s, kids.len()).unwrap_or_else(|| kids.iter().map(|_| 1.0).collect());
                return Node::Split { dir, weights, kids, key, pair: s.get("pair") == Some(&json!(true)), meta: saved_meta(s) };
            }
            // The older form: two kids and the first one's share.
            let ratio = s.get("ratio").and_then(Value::as_f64).filter(|r| good(*r) && *r < 1.0).unwrap_or(0.5);
            let (a, b) = (s.get("a").map_or_else(empty_tabs, |a| revive(a, leaf_of)), s.get("b").map_or_else(empty_tabs, |b| revive(b, leaf_of)));
            Node::Split { dir, weights: vec![ratio, 1.0 - ratio], kids: vec![a, b], key: None, pair: false, meta: saved_meta(s) }
        }
    }
}

fn put_meta(out: &mut Map<String, Value>, meta: &Meta) {
    if let Some(id) = &meta.id { out.insert("id".into(), json!(id)); }
    if let Some(policy) = meta.policy.as_ref().filter(|p| !p.is_empty()) { out.insert("policy".into(), policy.json()); }
}

/// A node in the door's saved form, the one written with `kids`. `leaf_of` writes each tile.
pub fn serialize(n: &Node, leaf_of: &dyn Fn(&TileSpec) -> Value) -> Value {
    let mut out = Map::new();
    out.insert("t".into(), json!(n.t()));
    let kids_json = |kids: &[Node]| json!(kids.iter().map(|k| serialize(k, leaf_of)).collect::<Vec<_>>());
    let ws = |weights: &[f64]| json!(weights);
    match n {
        Node::Leaf(s) => return leaf_of(s),
        Node::Tabs { active, kids, .. } => { out.insert("tabs".into(), json!(kids.iter().map(leaf_of).collect::<Vec<_>>())); out.insert("active".into(), json!(active)); }
        Node::Dock { side, open, kid, view, keeps, .. } => {
            out.insert("edge".into(), json!(side.word()));
            out.insert("open".into(), json!(open));
            if let Some(view) = view { let ids = kid.leaves(); out.insert("view".into(), json!(view.iter().map(|id| ids.iter().position(|x| x == id).map_or(-1, |i| i as i64)).collect::<Vec<_>>())); }
            out.insert("kid".into(), serialize(kid, leaf_of));
            if *keeps { out.insert("keeps".into(), json!(true)); }
        }
        Node::Columns { weights, kids, source, key, .. } => {
            out.insert("kids".into(), kids_json(kids));
            out.insert("weights".into(), ws(weights));
            if let Some(source) = source { out.insert("source".into(), json!(source)); }
            if let Some(key) = key { out.insert("key".into(), json!(key)); }
        }
        Node::Flow { kids, memory: m, key, .. } => {
            let col = |id: Option<&Id>| column_of(n, id.map(String::as_str));
            out.insert("kids".into(), kids_json(kids));
            let sides: Vec<Value> = m.sides.iter().filter_map(|(tile, left)| col(Some(tile)).map(|i| json!({ "col": i, "side": if *left { "left" } else { "right" } }))).collect();
            if !sides.is_empty() { out.insert("sides".into(), json!(sides)); }
            let recent: Vec<usize> = m.recent.iter().filter_map(|id| col(Some(id))).collect();
            if !recent.is_empty() { out.insert("recent".into(), json!(recent)); }
            for (name, slot) in [("anchor", &m.anchor), ("keep", &m.keep), ("read", &m.read)] { if let Some(i) = col(slot.as_ref()) { out.insert(name.into(), json!(i)); } }
            let held: Vec<usize> = m.held.iter().filter_map(|id| col(Some(id))).collect();
            if !held.is_empty() { out.insert("held".into(), json!(held)); }
            let trail: Vec<Value> = m.trail.iter().filter_map(|t| {
                let (at, from, ahead) = (col(Some(&t.tile))?, col(t.from.as_ref()), col(t.ahead.as_ref()));
                if from.is_none() && ahead.is_none() { return None }
                let mut row = Map::new();
                row.insert("col".into(), json!(at));
                if let Some(from) = from { row.insert("from".into(), json!(from)); }
                if let Some(ahead) = ahead { row.insert("ahead".into(), json!(ahead)); }
                Some(Value::Object(row))
            }).collect();
            if !trail.is_empty() { out.insert("trail".into(), json!(trail)); }
            if let Some(key) = key { out.insert("key".into(), json!(key)); }
        }
        Node::Split { dir, weights, kids, key, pair, .. } => {
            out.insert("dir".into(), json!(dir.word()));
            out.insert("kids".into(), kids_json(kids));
            out.insert("weights".into(), ws(weights));
            if let Some(key) = key { out.insert("key".into(), json!(key)); }
            if *pair { out.insert("pair".into(), json!(true)); }
        }
    }
    if let Some(meta) = n.meta() { put_meta(&mut out, meta) }
    Value::Object(out)
}

/// The tile next to `from` in a direction, by where they sit.
pub fn neighbour(rects: &[(Id, Rect)], from: &str, dir: Dir) -> Option<Id> {
    let a = rects.iter().find(|(id, _)| id == from)?.1;
    let (cx, cy) = (a.col + a.cols / 2.0, a.row + a.rows / 2.0);
    let mut best: Option<(f64, &Id)> = None;
    for (id, b) in rects.iter().filter(|(id, _)| id != from) {
        let (bx, by) = (b.col + b.cols / 2.0, b.row + b.rows / 2.0);
        let gap = match dir { Dir::Left => a.col - (b.col + b.cols), Dir::Right => b.col - (a.col + a.cols), Dir::Up => a.row - (b.row + b.rows), Dir::Down => b.row - (a.row + a.rows) };
        if gap < -1.0 { continue }
        let off = if dir.axis() == Axis::Row { (by - cy).abs() } else { (bx - cx).abs() };
        let score = gap * 10.0 + off;
        if best.is_none_or(|(s, _)| score < s) { best = Some((score, id)) }
    }
    best.map(|(_, id)| id.clone())
}
