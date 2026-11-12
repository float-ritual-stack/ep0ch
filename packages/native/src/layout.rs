//! The layout: which tiles a window shows, how they are arranged, which has the person's keys, and the two
//! functions that decide about it. Pure: no Rune, no socket.
//!
//! - **`apply(layout, op, ctx)`** answers the layout after an operation, or the refusal in words. Nothing else
//!   changes an arrangement, and only an action issues an `Op`.
//! - **`place(layout, request, ctx)`** answers where an open lands and why. Only the `open` action asks it.
//!
//! Both are the door's (`desk/screen-layout.ts`, `desk/landing.ts`), rule for rule and word for word: the door's
//! own answers are written down in `outline-core/fixtures/layout-contract.json` and `place-contract.json`, and
//! `tests/contract.rs` runs every row of both against this file. A layout reads from and saves to the door's saved
//! form (`Layout::read`, `Layout::save`), so a screen saved in one door opens in the other.
mod placement;
mod step;
pub mod tree;

use serde_json::{Map, Value, json};

pub use placement::{Request, place};
pub use tree::{Axis, Dir, Id, Node, Place, Policy, Rect, TileSpec};
use tree::{Effective, Geometry, Layer, Placed, SPINE, SlidDock, chain_of, effective, node_chain, normalise};

/// A map that keeps the order its keys were first set in, as the door's do.
#[derive(Clone, Debug, PartialEq)]
pub struct Seq<T>(pub Vec<(Id, T)>);

impl<T> Default for Seq<T> { fn default() -> Self { Seq(Vec::new()) } }

impl<T> Seq<T> {
    pub fn get(&self, key: &str) -> Option<&T> { self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v) }
    pub fn has(&self, key: &str) -> bool { self.get(key).is_some() }
    pub fn set(&mut self, key: &str, value: T) { match self.0.iter_mut().find(|(k, _)| k == key) { Some(slot) => slot.1 = value, None => self.0.push((key.to_string(), value)) } }
    pub fn remove(&mut self, key: &str) -> Option<T> { let at = self.0.iter().position(|(k, _)| k == key)?; Some(self.0.remove(at).1) }
    pub fn keys(&self) -> Vec<Id> { self.0.iter().map(|(k, _)| k.clone()).collect() }
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
}

/// A tile folded to a spine: who folded it (an agent's id), and whether the spine lies flat.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Fold { pub by: Option<String>, pub flat: bool }

impl Fold {
    /// A vertical spine folds in a row, a flat one in a column.
    pub fn fits(&self, axis: Option<Axis>) -> bool { axis == Some(if self.flat { Axis::Col } else { Axis::Row }) }
}

/// What a tile sends where: a list's `select` to the reader that follows it, an `open` to the tile it lands in.
#[derive(Clone, Debug, PartialEq)]
pub struct Wire { pub from: Id, pub verb: String, pub to: Id, pub rule: Option<String> }

/// A tile over the layout, where the person put it.
#[derive(Clone, Debug, PartialEq)]
pub struct Float { pub spec: TileSpec, pub rect: Rect, pub peek_of: Option<Id> }

/// A tile lifted over its column or the whole window, by whom.
#[derive(Clone, Debug, PartialEq)]
pub struct Lift { pub tile: Id, pub reach: String, pub by: Value }

#[derive(Clone, Debug, PartialEq)]
pub struct OpenedFrom { pub from: Id, pub typing: bool }

/// An arrangement, whole: the tree, the floats over it, and everything the door's layout holds beside them.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Layout {
    pub root: Option<Node>,
    pub floats: Vec<Float>,
    /// The tile with the person's keys. Changed only by `apply`.
    pub focus: Id,
    pub policy: Policy,
    /// Each tile's name, by its id: how an address, a wire and a refusal say it.
    pub names: Seq<String>,
    pub collapsed: Seq<Fold>,
    /// A tile's own limit on agents: `edit` or `off`.
    pub agents: Seq<String>,
    pub wires: Vec<Wire>,
    /// Wires to a tile this layout doesn't hold (another screen's), by its name.
    pub across: Vec<Wire>,
    pub alt_readers: Vec<Id>,
    /// The order tiles were last given the keys in, oldest first.
    pub touched: Vec<Id>,
    pub opened_from: Seq<OpenedFrom>,
    pub zoom: Option<Id>,
    pub lift: Option<Lift>,
    /// What an agent locked: an agent undoes only these.
    pub locks: Vec<String>,
    pub remembered: Seq<Option<Policy>>,
    /// Counts changes of shape: what an agent's `expected` is checked against.
    pub rev: u64,
    next_node: u64,
    shape_key: String,
}

/// The tree a layout with no tiles has.
fn nothing() -> Node { Node::Tabs { active: 0, kids: Vec::new(), meta: Default::default() } }

/// Who acts, as the door's layout reads them.
#[derive(Clone, Debug, PartialEq)]
pub enum By { Person, Agent(String) }

impl By {
    pub fn json(&self) -> Value { match self { By::Person => json!({ "kind": "user" }), By::Agent(id) => json!({ "kind": "agent", "id": id }) } }
    fn fold(&self) -> Fold { Fold { by: match self { By::Agent(id) => Some(id.clone()), By::Person => None }, flat: false } }
}

/// What a tile is, as the layout's rules read it: its kind's facts, then what its own state says.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Facts {
    pub kind: String,
    /// The note it shows.
    pub showing: Option<String>,
    pub lists: bool,
    pub pinned: bool,
    pub available: Option<bool>,
    pub policy: Option<Policy>,
    /// The kinds it takes as tabs.
    pub tabs: Option<Vec<String>>,
    /// It reads notes: an open can land in it.
    pub notes: bool,
    pub history: bool,
    pub held: bool,
    pub deliberate: bool,
    pub clears_on_close: bool,
    /// Why it stays, when something keeps it.
    pub keeps: Option<String>,
    pub stays: Option<String>,
    /// What it holds unsaved, in words.
    pub editing: Option<String>,
    pub holds: bool,
    pub running: Option<String>,
    pub placeholder: bool,
    pub follower: bool,
    pub opens_out: bool,
    pub home: Option<String>,
}

impl Facts {
    pub fn read(v: &Value) -> Facts {
        let flag = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        Facts {
            kind: text("kind").unwrap_or_else(|| "tile".into()), showing: text("showing"), lists: flag("lists"), pinned: flag("pinned"), available: v.get("available").and_then(Value::as_bool),
            policy: v.get("policy").map(|p| Policy::of(Some(p))), tabs: v.get("tabs").and_then(Value::as_array).map(|l| l.iter().filter_map(Value::as_str).map(str::to_string).collect()),
            notes: flag("notes"), history: flag("history"), held: flag("held"), deliberate: flag("deliberate"), clears_on_close: flag("clearsOnClose"), keeps: text("keeps"), stays: text("stays"),
            editing: text("editing"), holds: flag("holds"), running: text("running"), placeholder: flag("placeholder"), follower: flag("follower"), opens_out: flag("opensOut"), home: text("home"),
        }
    }
}

/// The tile kinds there are, for a refusal that lists them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Kinds { pub all: Vec<String>, pub notes: Vec<String> }

/// What `apply` and `place` are told beside the layout: who acts and how they stand, where the person is, what
/// each tile is, and the area the layout fills.
pub struct Ctx<'a> {
    pub by: By,
    /// They act as the person: at the keys, or an agent the person invited for this.
    pub standing: bool,
    /// Their opens take the person's keys.
    pub keys: bool,
    /// The tile the person types in keeps its size and their keys stay put.
    pub protect_typing: bool,
    pub typing_in: Option<Id>,
    pub busy: bool,
    pub yolo: bool,
    /// False: the person is away from this layout (its drawer is shut).
    pub here: Option<bool>,
    pub facts: &'a dyn Fn(&str) -> Facts,
    pub area: Rect,
    pub kinds: Option<Kinds>,
    /// The revision an agent read the layout at.
    pub expected: Option<Value>,
    pub screen_host: Option<String>,
    pub other_names: Vec<String>,
    pub empties: bool,
    /// A reader each tile opened beside itself before.
    pub beside: Vec<(Id, Id)>,
    /// What was opened into each keyed container: its tiles and the one in front.
    pub opened: Vec<(String, Vec<Id>, Option<Id>)>,
    /// How this layout says its own name, with its lock chip and what covers it.
    pub own: Option<(String, Option<String>, Option<String>)>,
    pub home: Option<Id>,
    /// Another screen takes opens this one has no reader for: its name, or none there.
    pub screen: Option<Option<String>>,
    pub outward: Option<String>,
    pub fresh_action: Option<String>,
}

impl<'a> Ctx<'a> {
    /// The person at the keys, in an area.
    pub fn person(facts: &'a dyn Fn(&str) -> Facts, area: Rect) -> Ctx<'a> {
        Ctx { by: By::Person, standing: true, keys: true, protect_typing: false, typing_in: None, busy: false, yolo: false, here: None, facts, area, kinds: None, expected: None, screen_host: None, other_names: Vec::new(), empties: false, beside: Vec::new(), opened: Vec::new(), own: None, home: None, screen: None, outward: None, fresh_action: None }
    }
    /// An agent: its opens land beside the person, and the tile they type in is left as it is.
    pub fn agent(id: &str, facts: &'a dyn Fn(&str) -> Facts, area: Rect) -> Ctx<'a> { Ctx { by: By::Agent(id.to_string()), standing: false, keys: false, protect_typing: true, ..Ctx::person(facts, area) } }
}

/// Why an operation wasn't done, in the words the person or the agent reads.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal(pub String);

/// An operation done: the layout after, whether anything changed, and what it answers.
#[derive(Clone, Debug, PartialEq)]
pub struct Applied { pub layout: Layout, pub changed: bool, pub answer: Map<String, Value> }

/// Where a new tile goes.
#[derive(Clone, Debug, PartialEq)]
pub enum At {
    Split { target: Id, dir: Dir, pair: bool, weight: Option<f64> },
    Tabs { target: Id, index: Option<usize>, behind: bool },
    Edge { dir: Dir },
    /// Into a keyed container (`node`: by its id, when the key isn't enough).
    In { key: String, node: Option<String>, index: Option<usize>, weight: Option<f64> },
    /// A flow's next column after a tile.
    Next { from: Id },
    Float { rect: Option<Rect>, near: Option<Id> },
    /// The dock that keeps work.
    Kept,
    /// Beside a tile, wherever it reads: tried in the order `prefers` says.
    Beside(Beside),
}

/// "Beside this tile, wherever it reads": the door's `Beside` (desk/landing.ts).
#[derive(Clone, Debug, PartialEq)]
pub struct Beside { pub target: Id, pub prefers: String, pub dir: Option<Dir>, pub needs: (Option<f64>, Option<f64>), pub strict: bool, pub pair: bool, pub weight: Option<f64>, pub keeps: (Option<f64>, Option<f64>), pub tab: bool }

impl At {
    fn of_place(place: &Place) -> At {
        match place.clone() { Place::Split { target, dir, pair, weight } => At::Split { target, dir, pair, weight }, Place::Tabs { target, index, behind } => At::Tabs { target, index, behind }, Place::Edge { dir } => At::Edge { dir } }
    }
    pub fn read(v: &Value) -> Option<At> {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        let dir = || v.get("dir").and_then(Value::as_str).and_then(Dir::read);
        let pair_of = |k: &str| { let o = v.get(k); (o.and_then(|o| o.get("cols")).and_then(Value::as_f64), o.and_then(|o| o.get("rows")).and_then(Value::as_f64)) };
        Some(match v.get("kind")?.as_str()? {
            "split" => At::Split { target: text("target")?, dir: dir()?, pair: v.get("pair") == Some(&json!(true)), weight: v.get("weight").and_then(Value::as_f64) },
            "tabs" => At::Tabs { target: text("target")?, index: v.get("index").and_then(Value::as_u64).map(|i| i as usize), behind: v.get("behind") == Some(&json!(true)) },
            "edge" => At::Edge { dir: dir()? },
            "in" => At::In { key: text("key")?, node: text("node"), index: v.get("index").and_then(Value::as_u64).map(|i| i as usize), weight: v.get("weight").and_then(Value::as_f64) },
            "next" => At::Next { from: text("from")? },
            "float" => At::Float { rect: v.get("rect").and_then(Rect::read), near: text("near") },
            "kept" => At::Kept,
            "beside" => At::Beside(Beside { target: text("target")?, prefers: text("prefers")?, dir: dir(), needs: pair_of("needs"), strict: v.get("strict") == Some(&json!(true)), pair: v.get("pair") == Some(&json!(true)), weight: v.get("weight").and_then(Value::as_f64), keeps: pair_of("keeps"), tab: v.get("tab") == Some(&json!(true)) }),
            _ => return None,
        })
    }
    pub fn json(&self) -> Value {
        let mut out = Map::new();
        let mut put = |k: &str, v: Value| { out.insert(k.into(), v); };
        match self {
            At::Split { target, dir, pair, weight } => { put("kind", json!("split")); put("target", json!(target)); put("dir", json!(dir.word())); if *pair { put("pair", json!(true)) } if let Some(w) = weight { put("weight", json!(w)) } }
            At::Tabs { target, index, behind } => { put("kind", json!("tabs")); put("target", json!(target)); if let Some(i) = index { put("index", json!(i)) } if *behind { put("behind", json!(true)) } }
            At::Edge { dir } => { put("kind", json!("edge")); put("dir", json!(dir.word())) }
            At::In { key, node, index, weight } => { put("kind", json!("in")); put("key", json!(key)); if let Some(n) = node { put("node", json!(n)) } if let Some(i) = index { put("index", json!(i)) } if let Some(w) = weight { put("weight", json!(w)) } }
            At::Next { from } => { put("kind", json!("next")); put("from", json!(from)) }
            At::Float { rect, near } => { put("kind", json!("float")); if let Some(r) = rect { put("rect", r.json()) } if let Some(n) = near { put("near", json!(n)) } }
            At::Kept => put("kind", json!("kept")),
            At::Beside(b) => { put("kind", json!("beside")); put("target", json!(b.target)); put("prefers", json!(b.prefers)) }
        }
        Value::Object(out)
    }
}

/// One change to a layout. Each is the door's `Op` of the same name; `apply` is the one thing that takes one.
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    /// A note opens: `place` says where, and the layout makes the room (a new tile, a spine for the old note).
    OpenNote { request: Request, tile: TileSpec, name: Option<String> },
    /// A new tile at a place.
    Open { tile: TileSpec, name: Option<String>, loose: bool, alt: bool, deliberate: Option<bool>, at: At, keys: bool, link: Option<Id>, verb: Option<String>, select_from: Vec<Id> },
    Close { tile: Id, gone: bool },
    Release { tile: Id },
    PeekRelease { tile: Id },
    Replace { tile: Id, with: TileSpec, name: Option<String>, link: Option<Id>, verb: Option<String>, select_from: Vec<Id> },
    Take { tile: Id, heir: Option<(TileSpec, Option<String>)> },
    Group { tile: Option<Id>, node: Option<String>, take: Vec<Id>, with: TileSpec, name: Option<String> },
    Ungroup { tile: Id, tree: Node, names: Vec<(Id, String)>, folds: Vec<(Id, Fold)>, agents: Vec<(Id, String)>, wires: Vec<Wire> },
    Move { tile: Id, to: Place },
    Swap { tile: Id, with: Id },
    Float { tile: Id, at: Option<At> },
    /// A float moved or sized.
    Nudge { tile: Option<Id>, dx: Option<f64>, dy: Option<f64>, col: Option<f64>, row: Option<f64>, cols: Option<f64>, rows: Option<f64> },
    /// Into a dock (`on: false`) or out of one (`on: true`: pinned in the layout).
    Pin { tile: Id, on: Option<bool>, edge: Option<Dir>, container: Option<String> },
    Slide { tile: Id, open: Option<bool>, container: Option<String>, beside: bool },
    Collapse { tile: Id, on: Option<bool>, dir: Option<String> },
    Room { tile: Id },
    AltHold { tile: Id },
    Resize { split: Option<String>, path: Option<String>, border: f64, share: f64 },
    Shares { split: String, shares: Vec<f64> },
    Grow { tile: Id, axis: Axis, by: f64 },
    Even,
    Gather { tile: Id, node: Option<String>, side: String },
    Lock { on: Option<bool> },
    Agents { tile: Id, level: Option<String> },
    Opened { tile: Id, from: Id, typing: bool },
    Policy { tile: Option<Id>, node: Option<String>, set: Map<String, Value>, clear: Vec<String> },
    Link { tile: Id, to: Option<Id>, verb: Option<String>, remove: bool, rule: Option<String>, across: Option<String> },
    Focus { tile: Id, quiet: bool },
    Reveal { tile: Id },
    Tab { tile: Id, by: Option<i64> },
    Zoom { tile: Id, on: Option<bool>, reach: Option<String> },
    /// Another arrangement takes this one's place (a screen opened, a step undone). `to`: the arrangement that
    /// would, so the rules are asked of what would go; none asks only whether one may. `keys`: the person's keys go
    /// where the arrangement arriving says (a screen opened), else stay on the tile that has them when it is still
    /// there (a step undone). An agent's load never moves them.
    Load { name: String, to: Option<Box<Layout>>, keys: bool },
    Fill { container: String, order: Vec<Id>, fresh: Vec<(TileSpec, Option<String>)>, drop: Vec<Id>, weights: Vec<(Id, f64)>, names: Vec<(Id, String)>, select: Vec<Id> },
    Source { container: String, source: String },
    FlowWiden { tile: Id },
    FlowTravel { tile: Id, dir: i64 },
    FlowHold { tile: Id, on: Option<bool> },
    Rename { tile: Id, name: String },
    Names,
    Remember { key: String, policy: Policy },
}

impl Op {
    /// The door's name for it (`open`, `flow.widen`).
    pub fn name(&self) -> &'static str {
        match self {
            Op::OpenNote { .. } | Op::Open { .. } => "open", Op::Close { .. } => "close", Op::Release { .. } => "release", Op::PeekRelease { .. } => "peek.release", Op::Replace { .. } => "replace", Op::Take { .. } => "take",
            Op::Group { .. } => "group", Op::Ungroup { .. } => "ungroup", Op::Move { .. } => "move", Op::Swap { .. } => "swap", Op::Float { .. } => "float", Op::Nudge { .. } => "place", Op::Pin { .. } => "pin", Op::Slide { .. } => "slide",
            Op::Collapse { .. } => "collapse", Op::Room { .. } => "room", Op::AltHold { .. } => "alt.hold", Op::Resize { .. } => "resize", Op::Shares { .. } => "shares", Op::Grow { .. } => "grow", Op::Even => "even", Op::Gather { .. } => "gather",
            Op::Lock { .. } => "lock", Op::Agents { .. } => "agents", Op::Opened { .. } => "opened", Op::Policy { .. } => "policy", Op::Link { .. } => "link", Op::Focus { .. } => "focus", Op::Reveal { .. } => "reveal", Op::Tab { .. } => "tab",
            Op::Zoom { .. } => "zoom", Op::Load { .. } => "load", Op::Fill { .. } => "fill", Op::Source { .. } => "source", Op::FlowWiden { .. } => "flow.widen", Op::FlowTravel { .. } => "flow.travel", Op::FlowHold { .. } => "flow.hold",
            Op::Rename { .. } => "rename", Op::Names => "names", Op::Remember { .. } => "remember",
        }
    }
}

// ── reading and saving ────────────────────────────────────────────────────────────────────────────────────────

/// The fields of a saved leaf the layout itself keeps: every other one is the tile's own.
const LEAF_OWN: &[&str] = &["t", "kind", "name", "id", "collapsed", "agents", "altReader", "wires", "link", "linkRole"];

impl Layout {
    /// A layout from the door's saved form (`{root, focus?, policy?, floats?, rule?}`), either tree form. A tile's
    /// name is its id unless its leaf says both; one with no name is named after its kind.
    pub fn read(saved: &Value) -> Layout {
        let mut l = Layout::default();
        let mut wants: Vec<(Id, String, String, Option<String>)> = Vec::new();
        let mut sources: Vec<(Id, String)> = Vec::new();
        let mut leaf_of = |l: &mut Layout, leaf: &Value| -> TileSpec {
            let kind = leaf.get("kind").and_then(Value::as_str).unwrap_or("tile").to_string();
            let name = leaf.get("name").and_then(Value::as_str).filter(|n| !n.is_empty() && !l.names.0.iter().any(|(_, x)| x == n)).map_or_else(|| l.auto_name(&kind, &[]), str::to_string);
            let id = leaf.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && !l.names.has(id)).map_or_else(|| name.clone(), str::to_string);
            l.names.set(&id, name);
            let mut fields: Map<String, Value> = leaf.as_object().map(|o| o.iter().filter(|(k, _)| !LEAF_OWN.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
            let wires = leaf.get("wires").and_then(Value::as_array).cloned().unwrap_or_default();
            for w in &wires { if let (Some(verb), Some(to)) = (w.get("verb").and_then(Value::as_str), w.get("to").and_then(Value::as_str)) { wants.push((id.clone(), verb.to_string(), to.to_string(), w.get("rule").and_then(Value::as_str).map(str::to_string))) } }
            // A tile saved with the tile it is linked to (the form before wires): its opens land there.
            if let Some(link) = leaf.get("link").and_then(Value::as_str) {
                let has = |verb: &str| wires.iter().any(|w| w.get("verb").and_then(Value::as_str) == Some(verb));
                if !has("open") { wants.push((id.clone(), "open".into(), link.to_string(), None)) }
                let role = leaf.get("linkRole").and_then(Value::as_str).unwrap_or(if kind == "backlinks" { "target" } else { "preview" });
                if !has("select") && role == "preview" { wants.push((id.clone(), "select".into(), link.to_string(), None)) }
            }
            // A preview follows the tile its source names: that tile's selection is wired to it.
            if kind == "preview" && let Some(source) = fields.get("source").and_then(Value::as_str).and_then(|s| s.strip_prefix("tile:")).map(str::to_string) { fields.remove("source"); sources.push((id.clone(), source)) }
            if leaf.get("altReader") == Some(&json!(true)) { l.alt_readers.push(id.clone()) }
            match leaf.get("collapsed") { Some(Value::String(h)) if h == "h" => l.collapsed.set(&id, Fold { by: None, flat: true }), Some(Value::Bool(true)) => l.collapsed.set(&id, Fold::default()), _ => {} }
            if let Some(level) = leaf.get("agents").and_then(Value::as_str).filter(|a| tree::AGENT_LEVELS.contains(a)) { l.agents.set(&id, level.to_string()) }
            TileSpec { id, kind, fields }
        };
        let root = saved.get("root").map(|root| tree::revive(root, &mut |leaf| leaf_of(&mut l, leaf)));
        for f in saved.get("floats").and_then(Value::as_array).into_iter().flatten() {
            let (Some(tile), Some(rect)) = (f.get("tile"), f.get("rect").and_then(Rect::read)) else { continue };
            let spec = leaf_of(&mut l, tile);
            l.floats.push(Float { spec, rect, peek_of: f.get("peekOf").and_then(Value::as_str).map(str::to_string) });
        }
        let root = root.unwrap_or_else(nothing);
        // A source's selection feeds the tile that follows it; then each tile's own wires, the last said a verb.
        let mut all: Vec<(Id, String, String, Option<String>)> = Vec::new();
        for (to, source) in sources {
            let froms = if l.named(&source).is_some() { l.named(&source).into_iter().collect() } else { tree::node_by_key(&root, &source).and_then(|p| root.at(&p)).map(Node::leaves).unwrap_or_default() };
            let to_name = l.names.get(&to).cloned().unwrap_or(to);
            for from in froms { all.push((from, "select".into(), to_name.clone(), None)) }
        }
        all.extend(wants);
        for (from, verb, to, rule) in all {
            if verb != "select" { l.wires.retain(|w| w.from != from || w.verb != verb); l.across.retain(|w| w.from != from || w.verb != verb) }
            let Some(to_id) = l.named(&to) else { l.across.push(Wire { from, verb, to, rule }); continue };
            if to_id == from && rule.is_none() && verb != "open" { continue }
            if !l.wires.iter().any(|w| w.from == from && w.verb == verb && w.to == to_id) { l.wires.push(Wire { from, verb, to: to_id, rule }) }
        }
        l.policy = Policy::of(saved.get("policy"));
        if saved.get("rule") == Some(&json!("next")) { l.policy.0.insert("opens".into(), json!("next")); }
        l.root = Some(normalise(root, true));
        l.never_blank();
        l.stamp();
        l.focus = saved.get("focus").and_then(Value::as_str).and_then(|name| l.named(name)).or_else(|| l.tree().leaves().into_iter().next()).or_else(|| l.floats.first().map(|f| f.spec.id.clone())).unwrap_or_default();
        l
    }

    /// The layout in the door's saved form, written with `kids`: what a state file and a screen note hold.
    pub fn save(&self) -> Value {
        let leaf_of = |s: &TileSpec| self.leaf_json(s);
        let mut out = Map::new();
        if !self.focus.is_empty() { out.insert("focus".into(), json!(self.name(&self.focus))); }
        out.insert("root".into(), tree::serialize(self.tree(), &leaf_of));
        if !self.policy.is_empty() { out.insert("policy".into(), self.policy.json()); }
        if !self.floats.is_empty() {
            out.insert("floats".into(), json!(self.floats.iter().map(|f| {
                let mut row = Map::new();
                row.insert("rect".into(), f.rect.json());
                if let Some(of) = &f.peek_of { row.insert("peekOf".into(), json!(self.name(of))); }
                row.insert("tile".into(), leaf_of(&f.spec));
                Value::Object(row)
            }).collect::<Vec<_>>()));
        }
        Value::Object(out)
    }

    /// A tile as a saved leaf: its kind and name, its own fields, then its fold, its agent level and its wires.
    fn leaf_json(&self, s: &TileSpec) -> Value {
        let mut out = Map::new();
        let name = self.name(&s.id);
        out.insert("t".into(), json!("leaf"));
        out.insert("kind".into(), json!(s.kind));
        out.insert("name".into(), json!(name));
        if name != s.id { out.insert("id".into(), json!(s.id)); }
        for (k, v) in &s.fields { out.insert(k.clone(), v.clone()); }
        if let Some(fold) = self.collapsed.get(&s.id) { out.insert("collapsed".into(), if fold.flat { json!("h") } else { json!(true) }); }
        if let Some(level) = self.agents.get(&s.id) { out.insert("agents".into(), json!(level)); }
        if self.alt_readers.contains(&s.id) { out.insert("altReader".into(), json!(true)); }
        let wire = |w: &Wire, to: String| { let mut row = Map::new(); row.insert("verb".into(), json!(w.verb)); row.insert("to".into(), json!(to)); if let Some(rule) = &w.rule { row.insert("rule".into(), json!(rule)); } Value::Object(row) };
        let wires: Vec<Value> = self.wires.iter().filter(|w| w.from == s.id).map(|w| wire(w, self.name(&w.to))).chain(self.across.iter().filter(|w| w.from == s.id).map(|w| wire(w, w.to.clone()))).collect();
        if !wires.is_empty() { out.insert("wires".into(), json!(wires)); }
        Value::Object(out)
    }

    /// What no saved layout holds, as the contract tables write it: the zoom, a lift, agents' locks, the order tiles
    /// were touched in, who folded what, where a tile was opened from, the revision.
    pub fn also(&self) -> Value {
        let mut out = Map::new();
        if let Some(zoom) = &self.zoom { out.insert("zoom".into(), json!(self.name(zoom))); }
        if let Some(lift) = &self.lift { out.insert("lift".into(), json!({ "tile": self.name(&lift.tile), "reach": lift.reach, "by": lift.by })); }
        if !self.locks.is_empty() { out.insert("locks".into(), json!(self.locks)); }
        if !self.touched.is_empty() { out.insert("touched".into(), json!(self.touched.iter().map(|id| self.name(id)).collect::<Vec<_>>())); }
        let folds: Map<String, Value> = self.collapsed.0.iter().filter_map(|(id, f)| f.by.as_ref().map(|by| (self.name(id), json!(by)))).collect();
        if !folds.is_empty() { out.insert("foldedBy".into(), Value::Object(folds)); }
        let opened: Map<String, Value> = self.opened_from.0.iter().map(|(id, o)| (self.name(id), if o.typing { json!({ "from": self.name(&o.from), "typing": true }) } else { json!({ "from": self.name(&o.from) }) })).collect();
        if !opened.is_empty() { out.insert("openedFrom".into(), Value::Object(opened)); }
        if !self.remembered.is_empty() { out.insert("remembered".into(), Value::Object(self.remembered.0.iter().filter_map(|(k, p)| p.as_ref().map(|p| (k.clone(), p.json()))).collect())); }
        out.insert("rev".into(), json!(self.rev));
        Value::Object(out)
    }

    // ── reading it ──────────────────────────────────────────────────────────────────────────────────────────

    pub fn tree(&self) -> &Node { self.root.as_ref().unwrap_or(&NOTHING) }
    pub(crate) fn tree_mut(&mut self) -> &mut Node { self.root.get_or_insert_with(nothing) }
    pub fn name(&self, id: &str) -> String { self.names.get(id).cloned().unwrap_or_else(|| id.to_string()) }
    /// The tile named `name`.
    pub fn named(&self, name: &str) -> Option<Id> { self.names.0.iter().find(|(_, n)| n == name).map(|(id, _)| id.clone()) }
    pub fn is_float(&self, id: &str) -> bool { self.floats.iter().any(|f| f.spec.id == id) }
    /// Every tile: the tree's, then the floats.
    pub fn all(&self) -> Vec<Id> { self.tree().leaves().into_iter().chain(self.floats.iter().map(|f| f.spec.id.clone())).collect() }
    pub fn spec(&self, id: &str) -> Option<&TileSpec> { self.tree().spec(id).or_else(|| self.floats.iter().find(|f| f.spec.id == id).map(|f| &f.spec)) }
    /// A name no tile here has: the kind, then the kind with a number.
    pub fn auto_name(&self, kind: &str, other: &[String]) -> String {
        let taken = |name: &str| self.names.0.iter().any(|(_, n)| n == name) || other.iter().any(|n| n == name);
        if !taken(kind) { return kind.to_string() }
        (2..).map(|n| format!("{kind}{n}")).find(|name| !taken(name)).unwrap_or_default()
    }
    /// The tiles a tile's `select` feeds.
    pub fn select_targets(&self, from: &str) -> Vec<Id> { self.wires.iter().filter(|w| w.from == from && w.verb == "select").map(|w| w.to.clone()).collect() }

    /// The layers of policy over a tile: the screen's, each container's on the way down, its kind's.
    fn layers<'a>(&'a self, id: &str, facts: Option<&'a Facts>) -> Vec<Layer<'a>> {
        let mut out = vec![Layer { by: "screen".into(), policy: Some(&self.policy), flow: false }];
        out.extend(chain_of(self.tree(), id).iter().filter_map(|p| self.tree().at(p)).map(|c| Layer { by: c.id_or_t(), policy: c.policy(), flow: c.is_flow() }));
        out.push(Layer { by: format!("{} tiles", facts.map_or("tile", |f| f.kind.as_str())), policy: facts.and_then(|f| f.policy.as_ref()), flow: false });
        out
    }
    pub fn policy_at(&self, id: &str, facts: Option<&Facts>) -> Effective { effective(&self.layers(id, facts)) }
    /// The policy over the container at `path`, itself included.
    pub fn policy_of_node(&self, path: &[usize]) -> Effective {
        let mut layers = vec![Layer { by: "screen".into(), policy: Some(&self.policy), flow: false }];
        layers.extend(node_chain(self.tree(), path).iter().filter_map(|p| self.tree().at(p)).map(|c| Layer { by: c.id_or_t(), policy: c.policy(), flow: c.is_flow() }));
        effective(&layers)
    }
    /// What agents may do to a tile, and who says so: the tile itself, else its policy.
    pub fn agent_level(&self, id: &str, facts: Option<&Facts>) -> (String, String) {
        if let Some(own) = self.agents.get(id) { return (own.clone(), "tile".into()) }
        let e = self.policy_at(id, facts);
        let by = e.by("agents").unwrap_or("screen").to_string();
        (e.agents, by)
    }

    // ── where things sit ────────────────────────────────────────────────────────────────────────────────────

    /// The area the tree fills: the given one, less the screen's inset.
    pub fn screen_area(&self, area: Rect) -> Rect {
        let inset = self.policy.cells("inset").unwrap_or(0.0);
        let (x, y) = (inset.min(((area.cols - 1.0) / 2.0).floor().max(0.0)), inset.min(((area.rows - 1.0) / 2.0).floor().max(0.0)));
        Rect { col: area.col + x, row: area.row + y, cols: area.cols - 2.0 * x, rows: area.rows - 2.0 * y }
    }

    /// Everything placed: the tree in the area, and each open dock that slides over it.
    pub fn placed(&self, area: Rect, holds: &dyn Fn(&str) -> bool) -> (Placed, Vec<SlidDock>) {
        let fixed = |id: &str, dir: Axis| self.collapsed.get(id).filter(|f| f.fits(Some(dir))).map(|f| if f.flat { 1.0 } else { SPINE });
        let folded = |id: &str| self.collapsed.has(id);
        Geometry { root: self.tree(), screen: &self.policy, gap: self.policy.cells("gap").unwrap_or(0.0), fixed: &fixed, folded: &folded, holds }.place_screen(self.screen_area(area))
    }

    /// Each tile's box: the zoomed tile alone when one is, else the tree's, the sliding docks' and the floats'.
    pub fn rects(&self, area: Rect, holds: &dyn Fn(&str) -> bool) -> Vec<(Id, Rect)> {
        if let Some(zoom) = self.zoom.as_ref().filter(|z| self.all().contains(z)) { return vec![(zoom.clone(), self.screen_area(area))] }
        let (base, slid) = self.placed(area, holds);
        let mut out = base.rects;
        let mut set = |id: &Id, r: Rect| match out.iter_mut().find(|(x, _)| x == id) { Some(slot) => slot.1 = r, None => out.push((id.clone(), r)) };
        for dock in &slid { for (id, r) in &dock.placed.rects { set(id, *r) } }
        for f in &self.floats { set(&f.spec.id, f.rect) }
        out
    }

    /// Its shape: itself, but for where the keys are and the order tiles were given them in. The keys moving is no
    /// change to go back through.
    pub fn shape(&self) -> Layout { Layout { focus: String::new(), touched: Vec::new(), ..self.clone() } }

    /// A copy with no zoom: where things sit under one.
    fn unzoomed(&self) -> Layout { Layout { zoom: None, ..self.clone() } }

    // ── keeping itself whole ────────────────────────────────────────────────────────────────────────────────

    /// A layout whose every tile is in a shut dock shows one of them: the screen is never blank.
    fn never_blank(&mut self) {
        if !self.tree().visible().is_empty() || self.tree().leaves().is_empty() { return }
        let Some(dock) = tree::dock_of(self.tree(), &self.focus).or_else(|| tree::docks(self.tree()).into_iter().find(|p| self.tree().at(p).is_some_and(|d| !d.leaves().is_empty()))) else { return };
        let Some(first) = self.tree().at(&dock).and_then(|d| d.leaves().into_iter().next()) else { return };
        for path in chain_of(self.tree(), &first) { if let Some(Node::Dock { open, .. }) = self.tree_mut().at_mut(&path) { *open = true } }
        if !self.tree().visible().contains(&self.focus) && !self.is_float(&self.focus) && let Some(shown) = self.tree().visible().into_iter().next() { self.focus = shown }
    }

    /// Every container gets its id (`s3`, `g1`, `d2`, `c4`, `f5`), kept while it lives; a changed shape is a new revision.
    fn stamp(&mut self) {
        let mut next = self.next_node.max(1);
        let mut seen: Vec<String> = Vec::new();
        let want = |n: &Node| match n { Node::Split { .. } => 's', Node::Tabs { .. } => 'g', Node::Columns { .. } => 'c', Node::Flow { .. } => 'f', _ => 'd' };
        fn walk(n: &mut Node, f: &mut dyn FnMut(&mut Node)) { if !n.is_leaf() { f(n); for k in n.kids_mut() { walk(k, f) } } }
        let root = self.tree_mut();
        walk(root, &mut |n| {
            let letter = want(n);
            let Some(meta) = n.meta_mut() else { return };
            match meta.id.as_deref().and_then(tree::stamped).filter(|(l, _)| *l == letter) {
                Some((_, num)) if !seen.contains(meta.id.as_ref().expect("an id")) => { seen.push(meta.id.clone().expect("an id")); next = next.max(num + 1) }
                _ => meta.id = None,
            }
        });
        walk(root, &mut |n| { let letter = want(n); if let Some(meta) = n.meta_mut() && meta.id.is_none() { meta.id = Some(format!("{letter}{next}")); next += 1 } });
        fn shape(n: &Node) -> String {
            let pol = n.policy().map(Policy::key).unwrap_or_default();
            match n {
                Node::Leaf(s) => format!("t{}", s.id),
                Node::Tabs { kids, .. } => format!("{}{pol}[{}]", n.id().unwrap_or(""), kids.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(",")),
                Node::Dock { side, kid, .. } => format!("{}<{}>{pol}({})", n.id().unwrap_or(""), side.word(), shape(kid)),
                other => format!("{}{}{pol}({})", other.id().unwrap_or(""), match other { Node::Columns { source, .. } => format!("columns:{}", source.as_deref().unwrap_or("")), Node::Flow { .. } => "flow".into(), _ => other.dir().map_or("", Axis::word).to_string() }, other.kids().iter().map(shape).collect::<Vec<_>>().join(",")),
            }
        }
        let key = format!("{}|{}|{}", shape(self.tree()), self.policy.key(), self.floats.iter().map(|f| format!("f{}", f.spec.id)).collect::<Vec<_>>().join(","));
        if key != self.shape_key { self.rev += 1 }
        self.next_node = next;
        self.shape_key = key;
    }
}

static NOTHING: Node = Node::Tabs { active: 0, kids: Vec::new(), meta: tree::Meta { id: None, policy: None } };

// ── the refusals every guard words alike (the door's whereabouts.ts) ──────────────────────────────────────────

pub(crate) const MARK_THEM: &str = "block.mark gets their attention";
pub(crate) fn held_back(why: &str, what: &str, way: Option<&str>) -> String { format!("{why}; an agent doesn't {what}{}", way.map_or(String::new(), |way| format!(" · {way}"))) }
pub(crate) fn typing_in(label: &str, what: &str, way: Option<&str>) -> String { held_back(&format!("the person is typing in {label}"), what, way) }
pub(crate) fn keys_in(label: &str, what: &str, typing: bool) -> String { if typing { typing_in(label, what, Some(MARK_THEM)) } else { held_back(&format!("{label} has the person's keys"), what, Some(MARK_THEM)) } }
pub fn holds_edit(label: &str) -> String { format!("{label} holds an edit or a comment; it stays on its note until that's saved or closed") }

/// Why an agent is refused by a tile's limit on agents (the door's `agentRefusal`).
pub(crate) fn agent_refusal(level: &str, tile: &str, what: &str, by: &str, command: Option<&str>) -> Option<String> {
    if level == "free" { return None }
    let set = if by != "tile" { format!(" ({})", if by == "screen" { "the screen's default".to_string() } else { format!("{by}'s default") }) } else { String::new() };
    let says = if level == "edit" { "edit only for agents" } else { "hands off for agents" };
    let way = if level == "edit" { "patching, commenting and setting properties on its note are allowed; its own new tiles go elsewhere" } else { "peek reads it" };
    let command = command.map_or_else(|| format!("^W g, its ⋯ menu or a click on its chip, or tile.agent policy=free tile={tile}"), str::to_string);
    Some(format!("{tile} is {says}{set}: {what} is refused · {way} · the person's command: {command}"))
}

// ── apply ─────────────────────────────────────────────────────────────────────────────────────────────────────

/// The layout after `op`, or why not. The one function that changes an arrangement.
pub fn apply(layout: &Layout, op: &Op, ctx: &Ctx) -> Result<Applied, Refusal> {
    let mut d = attempt(layout, op, ctx)?;
    // A name another layer holds gives way here.
    let mut taken: Vec<String> = ctx.other_names.clone();
    let mut renamed: Vec<Value> = Vec::new();
    for id in d.layout.names.keys() {
        let name = d.layout.names.get(&id).cloned().unwrap_or_default();
        if taken.contains(&name) {
            let rest = Layout { names: Seq(d.layout.names.0.iter().filter(|(k, _)| *k != id).cloned().collect()), ..Layout::default() };
            let to = rest.auto_name(name.trim_end_matches(|c: char| c.is_ascii_digit()), &taken);
            d.layout.names.set(&id, to.clone());
            let rewire = |policy: &mut Policy| if policy.text("opensInto") == Some(name.as_str()) { policy.0.insert("opensInto".into(), json!(to)); };
            rewire(&mut d.layout.policy);
            fn walk(n: &mut Node, f: &dyn Fn(&mut Policy)) { if let Some(meta) = n.meta_mut() && let Some(p) = &mut meta.policy { f(p) } for k in n.kids_mut() { walk(k, f) } }
            walk(d.layout.tree_mut(), &rewire);
            if d.answer.get("tile").and_then(Value::as_str) == Some(name.as_str()) { d.answer.insert("tile".into(), json!(to)); }
            renamed.push(json!({ "from": name, "to": to }));
        }
        taken.push(d.layout.names.get(&id).cloned().unwrap_or_default());
    }
    if !renamed.is_empty() { d.answer.insert("renamed".into(), json!(renamed)); d.changed = true }
    if ctx.standing && d.layout.focus != layout.focus && d.layout.lift.as_ref().is_some_and(|lift| lift.tile != d.layout.focus) { d.layout.lift = None }
    d.layout.stamp();
    Ok(d)
}

fn attempt(s: &Layout, op: &Op, ctx: &Ctx) -> Result<Applied, Refusal> {
    if let Op::Open { at: At::Beside(b), .. } = op { return placement::beside_attempt(s, op, b, ctx) }
    if let Some(expected) = &ctx.expected && let Some(why) = revision_refusal(s, expected) { return Err(Refusal(why)) }
    let holds = |id: &str| (ctx.facts)(id).holds;
    let typing = ctx.typing_in.as_ref().filter(|t| ctx.protect_typing && s.tree().has(t));
    let before = typing.and_then(|t| s.unzoomed().rects(ctx.area, &holds).into_iter().find(|(id, _)| id == t).map(|(_, r)| r));
    let mut step = step::Step { d: s.clone(), ctx, changed: true, answer: Map::new(), went: None };
    step.run(op).map_err(Refusal)?;
    let step::Step { mut d, changed, answer, .. } = step;
    d.never_blank();
    wide_opens(&mut d);
    if ctx.protect_typing && ctx.typing_in.is_some() && d.focus != s.focus { return Err(Refusal(held_back("the person is typing", "move their keys out of that tile", Some(MARK_THEM)))) }
    if let (Some(before), Some(typing)) = (before, typing) {
        let after = d.unzoomed().rects(ctx.area, &holds).into_iter().find(|(id, _)| id == typing).map(|(_, r)| r);
        if after.is_none_or(|after| (after.cols - before.cols).abs() > 1.0 || (after.rows - before.rows).abs() > 1.0) {
            let way = if op.name() == "open" { format!("an open goes beside another tile (to=), or {MARK_THEM}") } else { MARK_THEM.to_string() };
            return Err(Refusal(typing_in(&s.name(typing), "resize it", Some(&way))));
        }
    }
    Ok(Applied { layout: d, changed, answer })
}

/// A flow's wide column is never folded.
fn wide_opens(d: &mut Layout) {
    fn walk(n: &Node, out: &mut Vec<Id>) {
        if let Node::Flow { memory, .. } = n && let Some(i) = tree::column_of(n, memory.anchor.as_deref()) { out.extend(n.kids()[i].leaves()) }
        for k in n.kids() { walk(k, out) }
    }
    let mut open = Vec::new();
    walk(d.tree(), &mut open);
    for id in open { d.collapsed.remove(&id); }
}

/// Why an agent's `expected` revision is refused.
pub fn revision_refusal(s: &Layout, expected: &Value) -> Option<String> {
    let e = match expected { Value::Number(n) => n.as_f64().filter(|n| n.fract() == 0.0), Value::String(text) if !text.is_empty() && text.chars().all(|c| c.is_ascii_digit()) => text.parse::<f64>().ok(), _ => None };
    let Some(e) = e else { return Some(format!("expected is the revision layout.get gave (a number), not {expected}")) };
    (e != s.rev as f64).then(|| format!("the layout changed since revision {e} (it is {} now): nothing was done; read layout.get again, or name splits and tiles by id", s.rev))
}
