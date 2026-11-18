//! One operation on a layout, done: the door's `Step` (desk/screen-layout.ts), method for method. Each refusal is
//! the door's reason and the door's ways out, each way an act (`Refusal`, `Way`): the contract table holds both to
//! them, and no sentence here names a key or spells an action (`tests/one_owner.rs` scans for one).
use serde_json::{Map, Value, json};

use super::placement::{self, Destination, Heir, Route, covers_of};
use super::tree::{self, Axis, Cover, Dir, Effective, Id, Layer, Node, Path, Place, Policy, Rect, SPINE, Target, TileSpec, chain_of, effective, flow_holding, node_by_id, node_by_key, normalise, parent_of, tabs_of};
use super::{At, By, Ctx, Facts, Float, Fold, Layout, Lift, Op, OpenedFrom, Refusal, Way, Wire, agent_refusal, held_back, keys_in, typing_in};

type Done = Result<(), Refusal>;

fn no<T>(why: impl Into<Refusal>) -> Result<T, Refusal> { Err(why.into()) }
/// A refusal with ways out: the reason, then each way as an act.
fn why(reason: impl Into<String>) -> Refusal { Refusal::new(reason) }
/// The way out of a policy that says no: its flag turned on at the layer that says it.
fn turns_on(flag: &str, by: Option<&str>) -> Way { Way::new("layout.policy", format!("turns {flag} on")).node(by).arg(flag, true).at("there") }
/// The read that names every container: what a refusal about an id nothing has points at.
fn ids(does: &str) -> Way { Way::new("layout.get", does) }

/// The smallest a float is, and what a new one is sized to read at.
const FLOAT_MIN: (f64, f64) = (20.0, 5.0);
const FLOAT_READS: (f64, f64) = (64.0, 20.0);

fn order(level: &str) -> u8 { match level { "free" => 0, "edit" => 1, _ => 2 } }

/// A float kept on the screen: at least its smallest size, no larger than the area, inside it.
pub fn keep_on_screen(r0: Rect, area: Rect) -> Rect {
    let mut r = r0;
    let (w, h, top) = (area.cols, area.rows, area.row);
    r.cols = w.min(FLOAT_MIN.0.max(tree::round(r.cols))).max(0.0);
    r.rows = h.min(FLOAT_MIN.1.max(tree::round(r.rows))).max(0.0);
    r.col = (w - r.cols).min(tree::round(r.col)).max(0.0);
    r.row = (top + h - r.rows).min(tree::round(r.row)).max(top);
    r
}

/// The tree with a tile put at a place.
pub fn put_at(mut t: Node, spec: TileSpec, at: &At) -> Node {
    let leaf = Node::Leaf(spec.clone());
    t = match at {
        At::Edge { .. } if t.leaves().is_empty() => leaf,
        At::Edge { dir } => tree::edge(t, leaf, *dir, 0.3),
        At::Kept => tree::kept_in_dock(t, vec![spec]),
        At::Tabs { target, index, behind } => tree::tab_into(t, target, spec, *index, *behind),
        At::Split { target, dir, pair, weight } => tree::beside_slot(t, target, leaf, *dir, weight.unwrap_or(0.5), *pair),
        At::In { key, node, index, weight } => {
            let found = node.as_deref().and_then(|id| node_by_id(&t, id)).or_else(|| node_by_key(&t, key));
            if let Some(mut path) = found {
                // The line keyed so, at or under the one named.
                if let Some(inner) = t.at(&path).and_then(|n| node_by_key(n, key)) { path.extend(inner) }
                if let Some((kids, weights)) = t.at_mut(&path).filter(|n| n.key() == Some(key.as_str())).and_then(Node::line_mut) {
                    let i = index.unwrap_or(kids.len()).min(kids.len());
                    kids.insert(i, leaf);
                    weights.insert(i, weight.unwrap_or(1.0));
                }
            }
            t
        }
        At::Next { from } => {
            if let Some((path, ci)) = flow_holding(&t, from) && let Some((kids, weights)) = t.at_mut(&path).and_then(Node::line_mut) { kids.insert(ci + 1, leaf); weights.insert(ci + 1, 1.0) }
            t
        }
        At::Float { .. } | At::Beside(_) => t,
    };
    normalise(t, true)
}

pub(super) struct Step<'a, 'c> {
    pub d: Layout,
    pub ctx: &'a Ctx<'c>,
    pub changed: bool,
    pub answer: Map<String, Value>,
    /// Where the keys went when their tile left: said in the answer.
    pub went: Option<Value>,
}

fn obj(v: Value) -> Map<String, Value> { match v { Value::Object(map) => map, _ => Map::new() } }

impl Step<'_, '_> {
    fn agent(&self) -> bool { !self.ctx.standing }
    fn takes_keys(&self) -> bool { self.ctx.keys }
    fn yolo(&self) -> bool { matches!(self.ctx.by, By::Agent(_)) && self.ctx.yolo }
    fn name(&self, id: &str) -> String { self.d.name(id) }
    fn theirs(&self, id: &str, what: &str) -> Refusal { keys_in(&self.name(id), what, self.ctx.typing_in.as_deref() == Some(id), self.ctx.mark_them()) }
    fn own_name(&self) -> String { self.ctx.own.as_ref().map_or("the screen".into(), |(name, ..)| name.clone()) }
    fn facts(&self, id: &str) -> Facts { (self.ctx.facts)(id) }
    fn tree(&self) -> &Node { self.d.tree() }
    fn all(&self) -> Vec<Id> { self.d.all() }
    fn policy_at(&self, id: &str) -> Effective { let f = self.facts(id); self.d.policy_at(id, Some(&f)) }
    fn holds(&self) -> impl Fn(&str) -> bool + '_ { |id: &str| (self.ctx.facts)(id).holds }
    fn rects(&self) -> Vec<(Id, Rect)> { self.d.unzoomed().rects(self.ctx.area, &|_| false) }
    fn here(&self) -> bool { self.ctx.here != Some(false) }
    /// The new tile's spec, wherever it now is.
    fn spec(&self, id: &str) -> TileSpec { self.d.spec(id).cloned().unwrap_or_else(|| TileSpec::new(id, self.facts(id).kind)) }

    /// How the person unlocks this layout: the ways out of every refusal its lock causes.
    fn unlock_ways(&self) -> Vec<Way> {
        let (name, chip, covered) = self.ctx.own.clone().unwrap_or_else(|| ("the screen".into(), Some("screen".into()), None));
        let said = format!("▣ {} locked", chip.clone().unwrap_or_else(|| name.clone()));
        let unlock = || Way::new("layout.lock", "unlocks it").arg("on", false);
        match (chip.is_some(), covered.as_deref()) {
            (true, Some("drawer")) => vec![Way::new("host.toggle", "puts the drawer away").arg("open", false), unlock().at(format!("with the keys in {name}")).on(said).then()],
            (true, Some("lift")) => vec![Way::new("agent.lift", "drops the lifted tile").arg("on", false), unlock().at(format!("with the keys in {name}")).on(said).then()],
            (true, _) => vec![unlock().on(said)],
            _ => vec![unlock().at("in it")],
        }
    }
    fn locked_why(&self, e: &Effective, what: &str) -> Refusal {
        match e.by("locked") {
            Some("screen") => why(format!("{} is locked: {what} is refused", self.own_name())).ways(self.unlock_ways()),
            by => why(format!("{} is locked: {what} is refused", by.unwrap_or("undefined"))).way(Way::new("layout.policy", "unlocks it").node(by).arg("locked", false)),
        }
    }
    /// A kind that says why its tiles stay is believed over the general sentence.
    fn kept(&self, id: &str, by: Option<&str>, said: Refusal) -> Refusal {
        let f = self.facts(id);
        match f.stays { Some(stays) if by == Some(format!("{} tiles", f.kind).as_str()) => why(stays), _ => said }
    }
    fn whose(&self, by: Option<&str>) -> String {
        match by {
            Some("screen") => self.own_name(),
            Some(by) => node_by_id(self.tree(), by).and_then(|p| self.tree().at(&p)).and_then(Node::key).map_or_else(|| by.to_string(), |key| format!("the {key} container")),
            None => "undefined".into(),
        }
    }
    fn shape(&self, id: &str, what: &str) -> Done { let e = self.policy_at(id); if e.locked && !self.yolo() { no(self.locked_why(&e, what)) } else { Ok(()) } }
    fn not_float(&self, id: &str, what: &str) -> Done {
        if self.d.is_float(id) { no(why(format!("{} is a float: {what} needs a tile in the layout", self.name(id))).way(Way::new("tile.float", "puts it back first").arg("on", false).tile(&self.name(id)).on("its ⧉"))) } else { Ok(()) }
    }
    fn guard(&self, id: &str, what: &str) -> Done {
        if self.ctx.protect_typing && self.ctx.typing_in.as_deref() == Some(id) { no(typing_in(&self.name(id), &format!("{what} it"), self.ctx.mark_them())) } else { Ok(()) }
    }
    fn present(&self, id: &str) -> Done { if self.all().iter().any(|x| x == id) { Ok(()) } else { no(format!("no tile {} in the layout", self.name(id))) } }

    /// The share of the row and of the column a tile has, through every line over it.
    fn share_of(&self, id: &str) -> (f64, f64) {
        let (mut row, mut col) = (1.0, 1.0);
        let chain = chain_of(self.tree(), id);
        for (n, path) in chain.iter().enumerate() {
            let Some(c) = self.tree().at(path).filter(|c| c.is_line() && !c.is_flow()) else { continue };
            let k = match chain.get(n + 1) { Some(next) => next.last().copied(), None => c.kids().iter().position(|x| matches!(x, Node::Leaf(s) if s.id == id)) };
            let sum = { let s: f64 = c.weights().iter().sum(); if s == 0.0 { 1.0 } else { s } };
            if let Some(k) = k { if c.dir() == Some(Axis::Col) { col *= c.weights()[k] / sum } else { row *= c.weights()[k] / sum } }
        }
        (row, col)
    }
    /// A step that may not change the share of the tile the person types in.
    fn keeps_size(&mut self, step: impl FnOnce(&mut Self) -> Done) -> Done {
        let Some(t) = self.ctx.typing_in.clone().filter(|t| self.ctx.protect_typing && self.tree().has(t)) else { return step(self) };
        let before = self.share_of(&t);
        step(self)?;
        let after = self.share_of(&t);
        if (after.0 - before.0).abs() > 1e-9 || (after.1 - before.1).abs() > 1e-9 { return no(typing_in(&self.name(&t), "resize it", self.ctx.mark_them())) }
        Ok(())
    }
    fn may_move_keys(&self, what: &str) -> Done {
        if self.ctx.protect_typing && self.ctx.busy { no(held_back("the person is typing", what, self.ctx.mark_them())) } else { Ok(()) }
    }
    fn drag(&self, id: &str) -> Done {
        let e = self.policy_at(id);
        if e.locked && !self.yolo() { return no(self.locked_why(&e, &format!("moving {}", self.name(id)))) }
        if !e.draggable { return no(self.kept(id, e.by("draggable"), why(format!("{} stays where it is: {} keeps its tiles in place", self.name(id), self.whose(e.by("draggable")))).way(turns_on("draggable", e.by("draggable"))))) }
        Ok(())
    }
    fn screen_layer(&self) -> Layer<'_> { Layer { by: "screen".into(), policy: Some(&self.d.policy), flow: false } }

    /// Whether a tile of `kind` may be put at a place: the policies over it, and what the tile there takes.
    fn goes_at(&self, kind: &str, label: &str, to: &At) -> Done {
        if let At::Split { target, .. } | At::Tabs { target, .. } = to {
            self.present(target)?;
            self.not_float(target, &format!("putting {label} {}", if matches!(to, At::Tabs { .. }) { "into its tabs" } else { "beside it" }))?;
        }
        let (e, there) = match to {
            At::Tabs { target, .. } => (self.policy_at(target), self.name(target)),
            At::Split { target, .. } => {
                let mut chain = chain_of(self.tree(), target);
                if chain.last().and_then(|p| self.tree().at(p)).is_some_and(Node::is_tabs) { chain.pop(); }
                let mut layers = vec![self.screen_layer()];
                layers.extend(chain.iter().filter_map(|p| self.tree().at(p)).map(|c| Layer { by: c.id_or_t(), policy: c.policy(), flow: false }));
                (effective(&layers), self.name(target))
            }
            At::Edge { .. } | At::Kept => {
                let mut layers = vec![self.screen_layer()];
                if !self.tree().is_leaf() { layers.push(Layer { by: self.tree().id_or_t(), policy: self.tree().policy(), flow: false }) }
                (effective(&layers), match to { At::Edge { dir } => format!("the {} edge", dir.word()), _ => "the dock that keeps work".into() })
            }
            At::In { key, node, .. } => {
                let Some(line) = node.as_deref().map_or_else(|| node_by_key(self.tree(), key), |id| node_by_id(self.tree(), id)) else { return no(format!("there's no {key} in the layout for {label}")) };
                (self.d.policy_of_node(&line), key.clone())
            }
            At::Next { from } => {
                let Some((flow, _)) = flow_holding(self.tree(), from) else { return no(format!("{} isn't in a flow: nothing opens into a next column there", self.name(from))) };
                (self.d.policy_of_node(&flow), format!("the column after {}", self.name(from)))
            }
            At::Float { near, .. } => (match near { Some(near) if self.tree().has(near) => self.policy_at(near), _ => effective(&[self.screen_layer()]) }, "a float".into()),
            At::Beside(_) => return Ok(()),
        };
        if e.locked && !self.yolo() { return no(self.locked_why(&e, &format!("putting {label} by {there}"))) }
        if matches!(to, At::Float { .. }) { return Ok(()) }
        if !e.droppable { return no(why(format!("{} takes no drops: {label} can't go by {there}", self.whose(e.by("droppable")))).way(turns_on("droppable", e.by("droppable")))) }
        if let Some(accepts) = &e.accepts && !accepts.iter().any(|k| k == kind) { return no(format!("{} takes only {}: not {label} ({kind})", self.whose(e.by("accepts")), if accepts.is_empty() { "nothing".to_string() } else { accepts.join(", ") })) }
        if let At::Tabs { target, .. } = to {
            let t = self.facts(target);
            if let Some(tabs) = &t.tabs && !tabs.iter().any(|k| k == kind) { return no(format!("{there} ({}) takes only {} as tabs: not {label} ({kind})", t.kind, if tabs.is_empty() { "no tiles".to_string() } else { tabs.join(", ") })) }
        }
        Ok(())
    }

    /// Why the line at `path` keeps its sizes.
    fn resize_why(&self, path: &[usize], border: Option<usize>) -> Option<Refusal> {
        let e = self.d.policy_of_node(path);
        let n = self.tree().at(path)?;
        if e.locked && !self.yolo() { return Some(self.locked_why(&e, "resizing")) }
        if !e.resizable { return Some(why(format!("{} keeps its sizes", self.whose(e.by("resizable")))).way(turns_on("resizable", e.by("resizable")))) }
        if n.is_flow() { return Some(why(format!("{} sizes its columns itself", n.id().unwrap_or("the flow"))).way(Way::new("tile.widen", "gives one the wide place"))) }
        if let (true, Some(border)) = (n.is_line(), border) {
            let sides: Vec<&Node> = [n.kids().get(border), n.kids().get(border + 1)].into_iter().flatten().filter(|k| !k.is_leaf()).collect();
            for k in &sides { if k.policy().and_then(|p| p.flag("resizable")) == Some(false) { return Some(why(format!("{} keeps its size", k.id_or_t())).way(turns_on("resizable", k.id()))) } }
            for k in &sides { if let Some(fixed) = k.policy().and_then(|p| p.0.get("fixed")) { return Some(why(format!("{} is fixed at {fixed} cells", k.id_or_t())).way(Way::new("layout.policy", "frees it").node(k.id()).arg("clear", "fixed"))) } }
        }
        None
    }

    pub fn run(&mut self, op: &Op) -> Done {
        self.dispatch(op)?;
        self.reconcile_folds();
        Ok(())
    }

    /// A tab set folds as one: every tab has its front tab's fold, and a fold that no longer fits its line is gone.
    fn reconcile_folds(&mut self) {
        let mut seen: Vec<Id> = Vec::new();
        for id in self.d.collapsed.keys() {
            if seen.contains(&id) { continue }
            let here = self.tree().has(&id);
            let set = if here { self.fold_set(&id) } else { vec![id.clone()] };
            seen.extend(set.iter().cloned());
            let front = match tabs_of(self.tree(), &id).and_then(|p| self.tree().at(&p)) { Some(Node::Tabs { kids, active, .. }) => kids.get(*active).map(|s| s.id.clone()).unwrap_or_else(|| id.clone()), _ => id.clone() };
            let fold = self.d.collapsed.get(&front).cloned();
            let axis = parent_of(self.tree(), Target::Tile(&id)).and_then(|(p, _)| self.tree().at(&p)).and_then(Node::dir);
            match fold { Some(f) if here && f.fits(axis) => for t in set { self.d.collapsed.set(&t, f.clone()) }, _ => for t in set { self.d.collapsed.remove(&t); } }
        }
    }

    fn dispatch(&mut self, op: &Op) -> Done {
        if self.agent() { self.agent_gate(op)? }
        match op {
            Op::OpenNote { .. } | Op::Open { .. } => self.open(op, false),
            Op::Close { tile, gone, heir } => self.close(tile, *gone, *heir),
            Op::Release { tile } => { self.present(tile)?; self.lift(tile); Ok(()) }
            Op::PeekRelease { tile } => {
                if let Some(at) = self.d.floats.iter().position(|f| f.spec.id == *tile) {
                    let of = self.d.floats[at].peek_of.take();
                    self.d.wires.retain(|w| Some(&w.from) != of.as_ref() || w.to != *tile || w.verb != "select");
                }
                Ok(())
            }
            Op::Replace { .. } => self.replace(op),
            Op::Take { tile, heir } => self.take(tile, heir.as_ref()),
            Op::Group { .. } => self.group(op),
            Op::Ungroup { .. } => self.ungroup(op),
            Op::Move { tile, to } => self.move_(tile, to),
            Op::Swap { tile, with } => self.swap(tile, with),
            Op::Float { tile, at } => {
                if self.ctx.protect_typing && self.ctx.typing_in.as_ref() == Some(tile) { return no(typing_in(&self.name(tile), "float it", self.ctx.mark_them())) }
                if self.agent() && *tile == self.d.focus { return no(self.theirs(tile, "float it")) }
                if self.d.is_float(tile) { self.land(tile, at.as_ref()) } else { self.float(tile) }
            }
            Op::Nudge { .. } => self.nudge(op),
            Op::Pin { tile, on, edge, container } => self.pin(tile, *on, *edge, container.as_deref()),
            Op::Slide { tile, open, container, beside } => self.slide(tile, *open, container.as_deref(), *beside),
            Op::Collapse { tile, on, dir } => self.collapse(tile, *on, dir.as_deref()),
            Op::Room { tile } => self.room(tile),
            Op::AltHold { tile } => {
                self.present(tile)?;
                self.shape(tile, "holding it out of the pile")?;
                if self.d.collapsed.has(tile) { self.collapse(tile, Some(false), None)? }
                self.d.alt_readers.retain(|x| x != tile);
                self.changed = true;
                Ok(())
            }
            Op::Resize { .. } => self.keeps_size(|s| s.resize_border(op)),
            Op::Shares { split, shares } => self.keeps_size(|s| s.shares(split, shares)),
            Op::Grow { tile, axis, by } => self.keeps_size(|s| s.grow(tile, *axis, *by)),
            Op::Gather { tile, node, side } => self.keeps_size(|s| s.gather(tile, side, node.as_deref())),
            Op::Even => self.keeps_size(|s| s.even()),
            Op::Lock { on } => self.lock(*on),
            Op::Agents { tile, level } => self.set_agents(tile, level.as_deref()),
            Op::Opened { tile, from, typing } => { self.present(tile)?; self.present(from)?; self.d.opened_from.set(tile, OpenedFrom { from: from.clone(), typing: *typing }); Ok(()) }
            Op::Policy { .. } => self.set_policy(op),
            Op::Link { tile, to, verb, remove, rule, across } => {
                let verb = verb.as_deref().unwrap_or("open");
                let Some(across) = across else { return self.link(tile, to.as_deref(), verb, *remove, rule.as_deref()) };
                self.d.across.retain(|w| w.from != *tile || w.verb != verb || (*remove && w.to != *across));
                if !remove {
                    self.d.wires.retain(|w| w.from != *tile || w.verb != verb);
                    self.d.across.push(Wire { from: tile.clone(), to: across.clone(), verb: verb.to_string(), rule: rule.clone() });
                }
                Ok(())
            }
            Op::Focus { tile, quiet } => self.focus(tile, *quiet),
            Op::Reveal { tile } => self.reveal(tile),
            Op::Tab { tile, by } => self.tab(tile, *by),
            Op::Zoom { tile, on, reach } => {
                let (lift, zoom) = (self.d.lift.clone(), self.d.zoom.clone());
                self.zoom(tile, *on, reach.as_deref().unwrap_or("screen"))?;
                let same = |a: &Option<Lift>, b: &Option<Lift>| a.as_ref().map(|l| (&l.tile, &l.reach)) == b.as_ref().map(|l| (&l.tile, &l.reach));
                if same(&self.d.lift, &lift) && self.d.zoom == zoom { self.answer.insert("changed".into(), json!(false)); }
                Ok(())
            }
            Op::Load { name, to, keys } => self.load(name, to.as_deref(), *keys),
            Op::Fill { .. } => self.fill(op),
            Op::Source { container, source } => {
                if self.agent() { return no(why("where a columns container's tiles come from is the screen's").way(Way::new("board.hub", "says which hub fills it"))) }
                let Some(path) = node_by_id(self.tree(), container).filter(|p| matches!(self.tree().at(p), Some(Node::Columns { .. }))) else { return no(format!("no columns {container} in the layout")) };
                if let Some(Node::Columns { source: slot, .. }) = self.d.tree_mut().at_mut(&path) { *slot = Some(source.clone()) }
                Ok(())
            }
            Op::FlowWiden { tile } => self.widen(tile),
            Op::FlowTravel { tile, dir } => self.travel(tile, *dir),
            Op::FlowHold { tile, on } => self.hold_column(tile, *on),
            Op::Rename { tile, name } => self.rename(tile, name),
            Op::Names => { self.changed = false; Ok(()) }
            Op::Remember { key, policy } => {
                if self.d.remembered.has(key) { self.changed = false } else { self.d.remembered.set(key, Some(Policy::of(Some(&policy.json())))) }
                Ok(())
            }
        }
    }

    /// What a tile's limit on agents refuses, before anything else is asked.
    fn agent_gate(&self, op: &Op) -> Done {
        let no_ = |id: &str, what: &str, only_off: bool| -> Done {
            if !self.all().iter().any(|x| x == id) { return Ok(()) }
            let f = self.facts(id);
            let (level, by) = self.d.agent_level(id, Some(&f));
            if only_off && level != "off" { return Ok(()) }
            match agent_refusal(&level, &self.name(id), what, &by, None) { Some(why) => no(why), None => Ok(()) }
        };
        let each = |ids: Vec<Id>, what: &str, only_off: bool| -> Done { for id in ids { no_(&id, what, only_off)? } Ok(()) };
        let under = |path: Option<Path>| path.and_then(|p| self.tree().at(&p).map(Node::leaves)).unwrap_or_default();
        match op {
            Op::Close { tile, .. } => no_(tile, "closing it", false),
            Op::Rename { tile, .. } => no_(tile, "renaming it", false),
            Op::Replace { tile, .. } => no_(tile, "replacing it", false),
            Op::Take { tile, .. } => no_(tile, "taking it away", false),
            Op::Group { tile, node, take, .. } => {
                let nd = node.as_deref().and_then(|n| node_by_id(self.tree(), n).or_else(|| node_by_key(self.tree(), n)));
                let mut ids = match nd { Some(p) => under(Some(p)), None => tile.iter().cloned().collect() };
                ids.extend(take.iter().cloned());
                each(ids, "gathering it into a group", false)
            }
            Op::Ungroup { tile, .. } => no_(tile, "spilling its group", false),
            Op::Move { tile, to } => { no_(tile, "moving it", false)?; if let Place::Tabs { target, .. } = to { no_(target, "putting another tile in its tabs", false)? } Ok(()) }
            Op::Swap { tile, with } => { no_(tile, "swapping it", false)?; no_(with, "swapping it", false) }
            Op::Float { tile, .. } => no_(tile, "floating it", false),
            Op::Nudge { tile: Some(tile), .. } => no_(tile, "moving or sizing it", false),
            Op::Pin { tile, container, .. } => match container { Some(c) => each(under(node_by_id(self.tree(), c)), "docking it", false), None => no_(tile, "docking it", false) },
            Op::Slide { tile, container, .. } => {
                let nd = container.as_deref().and_then(|c| node_by_id(self.tree(), c)).filter(|p| self.tree().at(p).is_some_and(Node::is_dock));
                each(under(nd.or_else(|| tree::dock_of(self.tree(), tile))), "sliding its dock", false)
            }
            Op::AltHold { tile } => no_(tile, "holding it", false),
            Op::Collapse { tile, .. } => no_(tile, "folding it", false),
            Op::Grow { tile, .. } => no_(tile, "resizing it", true),
            Op::Resize { split, path, border, .. } => {
                let n = match split { Some(id) => node_by_id(self.tree(), id), None => read_path(path.as_deref().unwrap_or("")).filter(|p| self.tree().at(p).is_some()) };
                let Some(line) = n.as_ref().and_then(|p| self.tree().at(p)).filter(|n| n.is_line()) else { return Ok(()) };
                let b = *border as usize;
                each([line.kids().get(b), line.kids().get(b + 1)].into_iter().flatten().flat_map(Node::leaves).collect(), "resizing it", true)
            }
            Op::Shares { split, .. } => each(under(node_by_id(self.tree(), split)), "resizing it", true),
            Op::Gather { tile, node, .. } => each(under(match node { Some(n) => node_by_id(self.tree(), n), None => parent_of(self.tree(), Target::Tile(tile)).map(|(p, _)| p) }), "gathering its spines", false),
            Op::Even => each(self.all(), "evening out the layout (it resizes it)", true),
            Op::Link { tile, to, .. } => { no_(tile, "changing where its opens land", false)?; if let Some(to) = to { no_(to, "linking opens into it", false)? } Ok(()) }
            Op::Tab { tile, .. } => {
                no_(tile, "switching its tabs", false)?;
                match tabs_of(self.tree(), tile).and_then(|p| self.tree().at(&p)) { Some(Node::Tabs { kids, active, .. }) => no_(&kids[*active].id, "hiding it by switching tabs", false), _ => Ok(()) }
            }
            Op::Zoom { tile, .. } => no_(tile, "zooming it", false),
            Op::FlowWiden { tile } | Op::FlowTravel { tile, .. } | Op::FlowHold { tile, .. } => no_(tile, "widening, holding or travelling it", false),
            Op::Load { name, .. } => each(self.all(), &format!("laying the screen out as {name} (it replaces the tiles)"), false),
            Op::Open { at: At::Tabs { target, .. }, .. } => no_(target, "opening a tile into its tabs", false),
            Op::Agents { tile, level } => {
                let f = self.facts(tile);
                let (was, by) = self.d.agent_level(tile, Some(&f));
                let want = level.clone().unwrap_or_else(|| self.d.policy_at(tile, Some(&f)).agents);
                if order(&want) < order(&was) && let Some(why) = agent_refusal(&was, &self.name(tile), "loosening its own limit", &by, None) { return no(why) }
                Ok(())
            }
            Op::Policy { tile, node, set, clear } => {
                if !set.contains_key("agents") && !clear.iter().any(|k| k == "agents") { return Ok(()) }
                let Some(c) = self.policy_target(tile.as_deref(), node.as_deref()) else { return Ok(()) };
                // The default as it stands, and as it would: the same layers, the container's own level swapped.
                let level = |own: Option<&str>| -> String {
                    let strip = |p: Option<&Policy>| { let mut p = p.cloned().unwrap_or_default(); p.0.remove("agents"); if let Some(own) = own { p.0.insert("agents".into(), json!(own)); } p };
                    match &c {
                        None => effective(&[Layer { by: "screen".into(), policy: Some(&strip(Some(&self.d.policy))), flow: false }]).agents,
                        Some(path) => {
                            let own_policy = strip(self.tree().at(path).and_then(Node::policy));
                            let chain = tree::node_chain(self.tree(), path);
                            let mut layers = vec![self.screen_layer()];
                            layers.extend(chain.iter().filter_map(|p| self.tree().at(p).map(|x| Layer { by: x.id_or_t(), policy: if p == path { Some(&own_policy) } else { x.policy() }, flow: x.is_flow() })));
                            effective(&layers).agents
                        }
                    }
                };
                let own_now = match &c { None => self.d.policy.text("agents"), Some(path) => self.tree().at(path).and_then(Node::policy).and_then(|p| p.text("agents")) };
                let (was, now) = (level(own_now), level(set.get("agents").and_then(Value::as_str)));
                let by = match &c { None => "screen".to_string(), Some(path) => self.tree().at(path).map_or_else(String::new, Node::id_or_t) };
                if order(&now) < order(&was) && let Some(why) = agent_refusal(&was, if by == "screen" { "the screen" } else { &by }, "loosening its default", &by, Some(Way::new("layout.policy", "loosens it").node(Some(&by)).arg("agents", "free").theirs())) { return no(why) }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// The container a policy step names: `Some(None)` the screen, `Some(Some(path))` a node, `None` nothing by that id.
    fn policy_target(&self, tile: Option<&str>, node: Option<&str>) -> Option<Option<Path>> {
        match node {
            Some("screen") => Some(None),
            Some(id) if !id.is_empty() => node_by_id(self.tree(), id).map(Some),
            _ => Some(tile.and_then(|t| chain_of(self.tree(), t).pop())),
        }
    }

    fn rename(&mut self, id: &str, name: &str) -> Done {
        self.present(id)?;
        let was = self.name(id);
        if was == name { self.changed = false; self.answer = obj(json!({ "tile": name, "changed": false })); return Ok(()) }
        if self.d.named(name).is_some() { return no(format!("there's already a tile named {name} here · pick another name ({} is free)", self.d.auto_name(name, &[]))) }
        if node_by_key(self.tree(), name).is_some() { return no(format!("{name} is the key of a container here: a tile named so would take what opens into it · pick another name")) }
        // Every policy whose open rule names the tile follows the new name, unless its owner is locked.
        let mut owners: Vec<(Option<Path>, Effective, String)> = Vec::new();
        if self.d.policy.text("opensInto") == Some(was.as_str()) { owners.push((None, effective(&[self.screen_layer()]), "the screen's".into())) }
        fn walk(n: &Node, path: &mut Path, was: &str, out: &mut Vec<Path>) { if n.is_leaf() { return } if n.policy().and_then(|p| p.text("opensInto")) == Some(was) { out.push(path.clone()) } for (i, k) in n.kids().iter().enumerate() { path.push(i); walk(k, path, was, out); path.pop(); } }
        let mut found = Vec::new();
        walk(self.tree(), &mut Vec::new(), &was, &mut found);
        for path in found { let what = format!("{}'s", self.tree().at(&path).map_or_else(String::new, Node::id_or_t)); owners.push((Some(path.clone()), self.d.policy_of_node(&path), what)) }
        for (_, e, what) in &owners { if e.locked && !self.yolo() { return no(self.locked_why(e, &format!("renaming {was} ({what} open rule names it)"))) } }
        self.d.names.set(id, name.to_string());
        for (path, ..) in owners {
            match path { None => { self.d.policy.0.insert("opensInto".into(), json!(name)); } Some(path) => if let Some(p) = self.d.tree_mut().at_mut(&path).and_then(Node::meta_mut).and_then(|m| m.policy.as_mut()) { p.0.insert("opensInto".into(), json!(name)); } }
        }
        self.answer = obj(json!({ "tile": name, "was": was, "changed": true }));
        Ok(())
    }

    fn set_agents(&mut self, id: &str, level: Option<&str>) -> Done {
        self.present(id)?;
        let f = self.facts(id);
        if self.d.agents.get(id).map(String::as_str) == level {
            self.changed = false;
            self.answer = obj(json!({ "tile": self.name(id), "agents": self.d.agent_level(id, Some(&f)).0, "changed": false }));
            return Ok(());
        }
        match level { None => { self.d.agents.remove(id); } Some(level) => self.d.agents.set(id, level.to_string()) }
        self.answer = obj(json!({ "tile": self.name(id), "agents": self.d.agent_level(id, Some(&f)).0, "own": level.is_some(), "changed": true }));
        Ok(())
    }

    fn open(&mut self, op: &Op, automatic: bool) -> Done {
        if let Op::OpenNote { request, tile, name } = op {
            let plan = placement::placement(&self.d, request, self.ctx);
            if let Destination::None { reason, ways, .. } = &plan.destination { return no(why(reason.clone()).ways(ways.clone())) }
            let open_at = |at: &At, kind: &str, keys: bool| Op::Open { tile: TileSpec { kind: kind.to_string(), ..tile.clone() }, name: name.clone(), loose: false, alt: false, deliberate: None, at: at.clone(), keys, link: None, verb: None, select_from: Vec::new() };
            if let Some((kept, at)) = &plan.keep {
                // The reader's old note stays in a spine beside it.
                let before = self.rects();
                // (A tile of the kind the open brought: the kind that reads notes, by whatever name it has here.)
                self.open(&open_at(at, &tile.kind, false), true)?;
                self.d.collapsed.set(&tile.id, self.ctx.by.fold());
                spine_weights(self.d.tree_mut(), kept, &tile.id, &before);
            }
            if let Destination::New { at } = &plan.destination { self.open(&open_at(at, &tile.kind, plan.give_new_keys), true)? }
            if matches!((&plan.destination, &plan.route), (Destination::New { .. }, Some(Route::Float))) && self.ctx.standing {
                if let Some(f) = self.d.floats.iter_mut().find(|f| f.spec.id == tile.id) { f.peek_of = Some(request.from.clone()) }
                self.d.wires.push(Wire { from: request.from.clone(), to: tile.id.clone(), verb: "select".into(), rule: None });
            }
            if let Some(merge) = &plan.merge {
                self.guard(merge, "merge")?;
                let focused = self.d.focus == *merge;
                self.lift(merge);
                self.forget(merge);
                if focused && let Destination::Swap { tile, .. } = &plan.destination { self.d.focus = tile.clone() }
            }
            if let Destination::Swap { tile: dest, .. } = &plan.destination {
                self.present(dest)?;
                self.guard(dest, "open into")?;
                if let Some(from) = &plan.next_from { self.reach(dest, from, plan.keys.is_some())? } else if plan.reuse != Some(false) { self.reveal(dest)? }
                if let Some(keys) = &plan.keys { self.give(keys) }
            }
            if plan.keep.is_some() || matches!(plan.destination, Destination::New { .. }) {
                let of = plan.keep.as_ref().map_or(&tile.id, |(kept, _)| kept);
                if let Some((row, _)) = parent_of(self.tree(), Target::Tile(of)) && self.tree().at(&row).is_some_and(|r| r.is_line() && !r.is_flow()) && self.d.policy_of_node(&row).spines == "centre" { self.centre_spines(&row) }
            }
            if let Some(Route::To { full: true, .. }) = &plan.route {
                match &plan.destination { Destination::New { .. } => self.dispatch(&Op::Zoom { tile: tile.id.clone(), on: Some(true), reach: None })?, Destination::Swap { tile, .. } => self.dispatch(&Op::Zoom { tile: tile.clone(), on: Some(true), reach: None })?, _ => {} }
            }
            self.answer = obj(json!({ "placement": plan.json() }));
            return Ok(());
        }
        let Op::Open { tile, name, loose, alt, deliberate, at, keys, link, verb, select_from } = op else { return Ok(()) };
        if self.all().contains(&tile.id) {
            if let At::Next { from } = at { return self.reach(&tile.id, from, true) }
            return no(format!("{} is in the layout already", self.name(&tile.id)));
        }
        let mut name = name.clone();
        if let Some(n) = &name && self.d.named(n).is_some() { if *loose { name = None } else { return no(format!("there's already a tile named {n}")) } }
        let label = name.clone().unwrap_or_else(|| format!("a new {} tile", tile.kind));
        self.goes_at(&tile.kind, &label, at)?;
        let named = name.unwrap_or_else(|| self.d.auto_name(&tile.kind, &[]));
        self.d.names.set(&tile.id, named);
        if *alt { self.d.alt_readers.push(tile.id.clone()) }
        if let At::Float { rect, .. } = at {
            let r = rect.unwrap_or_else(|| self.new_float_rect());
            self.d.floats.push(Float { spec: tile.clone(), rect: keep_on_screen(r, self.ctx.area), peek_of: None });
        } else {
            let was_shown = self.tree().shown();
            let root = std::mem::replace(self.d.tree_mut(), super::nothing());
            *self.d.tree_mut() = put_at(root, tile.clone(), at);
            if let Some((row, _)) = parent_of(self.tree(), Target::Tile(&tile.id)) && self.tree().at(&row).is_some_and(|r| r.is_line() && !r.is_flow()) && self.d.policy_of_node(&row).spines == "centre" { self.centre_spines(&row) }
            if !self.takes_keys() && was_shown.contains(&self.d.focus) && !self.tree().shown().contains(&self.d.focus) { let focus = self.d.focus.clone(); tree::activate(self.d.tree_mut(), &focus); }
            if let At::Next { from } = at && let Some((path, ci)) = flow_holding(self.tree(), &tile.id) && let Some(flow) = self.d.tree_mut().at_mut(&path) { set_from(flow, ci, Some(from.clone())) }
        }
        self.d.zoom = None;
        if self.takes_keys() && *keys {
            self.give(&tile.id);
            if let At::Next { from } = at && let Some((path, ci)) = flow_holding(self.tree(), &tile.id) {
                self.remember_flow_sides(&path);
                let covers = covers_of(&self.d, &path, self.ctx.area, &self.holds());
                let from_col = self.tree().at(&path).and_then(|f| tree::column_of(f, Some(from)));
                let touched = self.d.touched.clone();
                if let Some(flow) = self.d.tree_mut().at_mut(&path) { arrive(flow, ci, from_col, &covers, &touched) }
            }
        }
        if !self.all().contains(&self.d.focus) { self.d.focus = tile.id.clone() }
        let notes = self.ctx.kinds.as_ref().is_none_or(|k| k.notes.contains(&tile.kind));
        if let Some(link) = link { self.link_to(link, &tile.id, notes, &tile.kind, verb.as_deref().unwrap_or("open"))? }
        for from in select_from { self.link_to(from, &tile.id, notes, &tile.kind, "select")? }
        let mut answer = Map::new();
        answer.insert("tile".into(), json!(self.d.names.get(&tile.id)));
        if !automatic { answer.insert("deliberate".into(), json!(deliberate.unwrap_or(true))); }
        if let Some(link) = link { answer.insert("link".into(), json!(self.name(link))); }
        self.answer = answer;
        Ok(())
    }

    /// The keys reach a flow's column that is there already.
    fn reach(&mut self, id: &str, from: &str, keys: bool) -> Done {
        let Some((path, ci)) = flow_holding(self.tree(), id) else { return no(format!("{} isn't in a flow", self.name(id))) };
        if !self.takes_keys() { self.changed = false; return Ok(()) }
        let from_col = self.tree().at(&path).and_then(|f| tree::column_of(f, Some(from)));
        if let Some(fc) = from_col && fc != ci && let Some(flow) = self.d.tree_mut().at_mut(&path) { set_from(flow, ci, Some(from.to_string())) }
        if keys { self.give(id) }
        self.remember_flow_sides(&path);
        let covers = covers_of(&self.d, &path, self.ctx.area, &self.holds());
        let touched = self.d.touched.clone();
        if let Some(flow) = self.d.tree_mut().at_mut(&path) { arrive(flow, ci, from_col, &covers, &touched) }
        Ok(())
    }

    /// The keys go to a tile.
    fn give(&mut self, id: &str) {
        let was = self.d.focus.clone();
        if let Some((path, ci)) = flow_holding(self.tree(), id) && was != id && let Some((was_path, was_ci)) = flow_holding(self.tree(), &was) && was_path == path && was_ci != ci && let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(&path) { memory.read = Some(was) }
        self.d.focus = id.to_string();
        self.touch(id);
    }

    fn close(&mut self, id: &str, gone: bool, asks_heir: bool) -> Done {
        self.present(id)?;
        let (name, f) = (self.name(id), self.facts(id));
        if !gone {
            self.shape(id, &format!("closing {name}"))?;
            let e = self.policy_at(id);
            let fold = e.collapsible.then(|| Way::new("tile.collapse", "folds it to a spine").arg("on", true).tile(&name));
            if let Some(editing) = &f.editing { return no(why(format!("not closed: it holds {editing}")).way(Way::new("edit", "enters it").tile(&name).theirs())) }
            let own = chain_of(self.tree(), id).into_iter().filter_map(|p| self.tree().at(&p)).find(|c| c.id() == e.by("closable") && matches!(c, Node::Tabs { kids, .. } if kids.len() == 1)).and_then(Node::id).map(str::to_string);
            if !e.closable && !(f.clears_on_close && e.by("closable") == Some(format!("{} tiles", f.kind).as_str())) {
                return no(match own { Some(own) => why(format!("{name} stays: its place ({own}) keeps it")).ways(fold).way(turns_on("closable", Some(&own))), None => self.kept(id, e.by("closable"), why(format!("{name} stays: {} keeps its tiles", self.whose(e.by("closable")))).ways(fold).way(turns_on("closable", e.by("closable")))) });
            }
            if let Some(keeps) = &f.keeps { return no(why(format!("{name} stays: {keeps}")).ways(fold)) }
            if self.agent() && self.here() && id == self.d.focus { return no(self.theirs(id, "close it")) }
            if self.agent() && let Some(running) = &f.running { return no(format!("{name} is running {running}; an agent doesn't end it")) }
        }
        if !gone && !self.ctx.empties && !self.d.is_float(id) && self.tree().leaves().len() <= 1 { return no(format!("{name} is the screen's last tile: it stays (the screen is never blank)")) }
        // Who keeps its note, asked while its wires are there (the door's `closeHeir`).
        let heir = if gone || !asks_heir || f.clears_on_close { None } else { placement::close_heir(&self.d, id, self.ctx) };
        if !f.clears_on_close { self.lift(id) }
        let mut answer = Map::new();
        answer.insert("tile".into(), json!(name));
        match heir {
            Some(Heir::Across(path)) => { answer.insert("heirAcross".into(), json!(path)); answer.insert("note".into(), json!(f.showing)); }
            Some(Heir::To(to)) => { answer.insert("heir".into(), json!(self.name(&to))); answer.insert("note".into(), json!(f.showing)); }
            None => {}
        }
        if let Some(went) = self.went.take() { answer.insert("keys".into(), went); }
        self.answer = answer;
        Ok(())
    }

    fn replace(&mut self, op: &Op) -> Done {
        let Op::Replace { tile: id, with, name: new_name, link, verb, select_from } = op else { return Ok(()) };
        self.present(id)?;
        if self.all().contains(&with.id) { return no(format!("{} is in the layout already", self.name(&with.id))) }
        let (name, f) = (self.name(id), self.facts(id));
        self.shape(id, &format!("replacing {name}"))?;
        if let Some(editing) = &f.editing { return no(why(format!("{name} holds {editing}")).way(Way::new("edit", "enters it").tile(&name).theirs())) }
        if let Some(running) = &f.running { return no(why(format!("{name} is running {running}")).way(Way::new("tile.close", "ends it first").tile(&name))) }
        if f.holds { return no(why(format!("{name} holds work")).way(Way::new("tile.close", "closes it first").tile(&name))) }
        if let Some(keeps) = &f.keeps { return no(format!("{name} stays: {keeps}")) }
        let e = self.policy_at(id);
        if !e.closable { return no(self.kept(id, e.by("closable"), why(format!("{name} stays: {} keeps its tiles", self.whose(e.by("closable")))).way(turns_on("closable", e.by("closable"))))) }
        if let Some(accepts) = &e.accepts && !accepts.contains(&with.kind) { return no(format!("{} takes only {}: not a {} tile", self.whose(e.by("accepts")), if accepts.is_empty() { "nothing".to_string() } else { accepts.join(", ") }, with.kind)) }
        if self.agent() && *id == self.d.focus && !f.placeholder { return no(self.theirs(id, "replace it")) }
        self.guard(id, "replace")?;
        if let Some(n) = new_name && self.d.named(n).is_some_and(|other| other != *id) { return no(format!("there's already a tile named {n}")) }
        self.swap_in(id, with);
        let had = self.d.focus == *id;
        self.forget(id);
        let named = new_name.clone().unwrap_or_else(|| self.d.auto_name(&with.kind, &[]));
        self.d.names.set(&with.id, named);
        if had { self.d.focus = with.id.clone() }
        let notes = self.ctx.kinds.as_ref().is_none_or(|k| k.notes.contains(&with.kind));
        if let Some(link) = link { self.link_to(link, &with.id, notes, &with.kind, verb.as_deref().unwrap_or("open"))? }
        for from in select_from.iter().filter(|from| *from != id) { self.link_to(from, &with.id, notes, &with.kind, "select")? }
        self.answer = obj(json!({ "tile": self.d.names.get(&with.id), "replaced": name }));
        Ok(())
    }

    /// The tile `id` becomes `with`, in the tree or among the floats.
    fn swap_in(&mut self, id: &str, with: &TileSpec) {
        match self.d.floats.iter_mut().find(|f| f.spec.id == id) { Some(float) => float.spec = with.clone(), None => { tree::swap_leaf(self.d.tree_mut(), id, with); } }
    }

    fn take(&mut self, id: &str, heir: Option<&(TileSpec, Option<String>)>) -> Done {
        self.present(id)?;
        let name = self.name(id);
        self.guard(id, "move")?;
        self.drag(id)?;
        let (e, f) = (self.policy_at(id), self.facts(id));
        if !e.closable && !(f.stays.is_some() && e.by("closable") == Some(format!("{} tiles", f.kind).as_str())) { return no(why(format!("{name} stays: {} keeps it", self.whose(e.by("closable")))).way(turns_on("closable", e.by("closable")))) }
        if let Some(keeps) = &f.keeps { return no(format!("{name} stays: {keeps}")) }
        if heir.is_none() && !self.ctx.empties && !self.d.is_float(id) && self.tree().leaves().len() <= 1 { return no(format!("{name} is the screen's last tile: it stays (the screen is never blank)")) }
        if self.agent() && self.here() && id == self.d.focus { return no(self.theirs(id, "take it away")) }
        if let Some((heir, heir_name)) = heir {
            if self.all().contains(&heir.id) { return no(format!("{} is in the layout already", self.name(&heir.id))) }
            self.swap_in(id, heir);
            let had = self.d.focus == id;
            self.forget(id);
            self.d.names.set(&heir.id, heir_name.clone().unwrap_or_else(|| name.clone()));
            if had { self.d.focus = heir.id.clone() }
        } else { self.lift(id) }
        let mut answer = obj(json!({ "tile": name, "taken": true }));
        if let Some((heir, _)) = heir { answer.insert("heir".into(), json!(self.d.names.get(&heir.id))); }
        if let Some(went) = self.went.take() { answer.insert("keys".into(), went); }
        self.answer = answer;
        Ok(())
    }

    fn group(&mut self, op: &Op) -> Done {
        let Op::Group { tile, node, take, with, name } = op else { return Ok(()) };
        if self.all().contains(&with.id) { return no(format!("{} is in the layout already", self.name(&with.id))) }
        let target = node.as_deref().and_then(|n| node_by_id(self.tree(), n).or_else(|| node_by_key(self.tree(), n)));
        if let (Some(n), None) = (node, &target) { return no(format!("there's no container {n} in the layout")) }
        if node.is_none() {
            let Some(tile) = tile else { return no("a group gathers a tile (tile=) or a container (node=)") };
            self.present(tile)?;
            self.not_float(tile, "gathering it into a group")?;
        }
        let inside: Vec<Id> = match &target { Some(p) => self.tree().at(p).map(Node::leaves).unwrap_or_default(), None => tile.iter().cloned().collect() };
        let extra: Vec<Id> = take.iter().filter(|t| !inside.contains(t)).cloned().collect();
        let all: Vec<Id> = inside.iter().chain(extra.iter()).cloned().collect();
        if all.is_empty() { return no(format!("{} holds no tiles to gather", node.as_deref().unwrap_or("undefined"))) }
        for t in &all {
            self.present(t)?;
            let name = self.name(t);
            self.guard(t, "move")?;
            self.drag(t)?;
            let (e, f) = (self.policy_at(t), self.facts(t));
            if !e.closable && !(f.stays.is_some() && e.by("closable") == Some(format!("{} tiles", f.kind).as_str())) { return no(why(format!("{name} stays: {} keeps it", self.whose(e.by("closable")))).way(turns_on("closable", e.by("closable")))) }
            if let Some(keeps) = &f.keeps { return no(format!("{name} stays: {keeps}")) }
            if self.agent() && self.here() && *t == self.d.focus { return no(self.theirs(t, "gather it into a group")) }
        }
        if let Some(Node::Columns { source: Some(source), .. }) = target.as_ref().and_then(|p| self.tree().at(p)) { return no(why(format!("{} is filled from {source}: its tiles come and go with the data, so it isn't gathered", node.as_deref().unwrap_or(""))).way(Way::new("tile.open", "mounts the screen's part instead (part=)").arg("kind", "screen"))) }
        let had = all.contains(&self.d.focus);
        // The container is found again by one of its tiles once the extra ones have gone.
        let anchor = inside.first().cloned();
        let target_id = target.as_ref().and_then(|p| self.tree().at(p)).and_then(Node::id).map(str::to_string);
        for t in &extra {
            if !self.d.is_float(t) {
                let root = std::mem::replace(self.d.tree_mut(), super::nothing());
                let Some(next) = tree::remove(root.clone(), t) else { *self.d.tree_mut() = root; return no(format!("{} is the screen's last tile", self.name(t))) };
                *self.d.tree_mut() = normalise(next, true);
            }
            self.d.floats.retain(|f| f.spec.id != *t);
        }
        if target.is_some() {
            let again = target_id.as_deref().and_then(|id| node_by_id(self.tree(), id)).or_else(|| node.as_deref().and_then(|n| node_by_key(self.tree(), n)));
            match again { Some(path) if !path.is_empty() => tree::replace_at(self.d.tree_mut(), &path, Node::Leaf(with.clone())), Some(_) => *self.d.tree_mut() = Node::Leaf(with.clone()), None => if let Some(a) = &anchor { tree::swap_leaf(self.d.tree_mut(), a, with); } }
        } else if let Some(tile) = tile {
            if self.d.is_float(tile) { return no(format!("{} is a float", self.name(tile))) }
            tree::swap_leaf(self.d.tree_mut(), tile, with);
        }
        let root = std::mem::replace(self.d.tree_mut(), super::nothing());
        *self.d.tree_mut() = normalise(root, true);
        let names: Vec<String> = all.iter().map(|t| self.name(t)).collect();
        for t in &all { self.forget(t) }
        let named = name.clone().filter(|n| self.d.named(n).is_none()).unwrap_or_else(|| self.d.auto_name(&with.kind, &[]));
        self.d.names.set(&with.id, named);
        if had { self.d.focus = with.id.clone() }
        self.answer = obj(json!({ "tile": self.d.names.get(&with.id), "grouped": names }));
        Ok(())
    }

    fn ungroup(&mut self, op: &Op) -> Done {
        let Op::Ungroup { tile, tree: spilled, names, folds, agents, wires } = op else { return Ok(()) };
        self.present(tile)?;
        let name = self.name(tile);
        self.not_float(tile, &format!("spilling {name}"))?;
        self.shape(tile, &format!("spilling {name}"))?;
        self.guard(tile, "spill")?;
        if self.agent() && self.here() && *tile == self.d.focus { return no(self.theirs(tile, "spill it")) }
        let fresh = spilled.leaves();
        if fresh.is_empty() { return no(format!("{name} holds no tiles")) }
        for t in &fresh { if self.all().contains(t) { return no(format!("{} is in the layout already", self.name(t))) } }
        let mut spilled = spilled.clone();
        fn strip(n: &mut Node) { if let Some(meta) = n.meta_mut() { meta.id = None } for k in n.kids_mut() { strip(k) } }
        strip(&mut spilled);
        let had = self.d.focus == *tile;
        if tabs_of(self.tree(), tile).is_some() && !spilled.is_leaf() { return no(why(format!("{name} is a tab: a tab holds one tile or a group, so it stays a group there")).way(Way::new("layout.move", "moves it out of the tab set first").arg("to", name.as_str()).arg("where", "right").tile(&name))) }
        match &spilled {
            Node::Leaf(spec) => { tree::swap_leaf(self.d.tree_mut(), tile, spec); }
            _ => { let path = leaf_path(self.tree(), tile); match path { Some(path) if !path.is_empty() => tree::replace_at(self.d.tree_mut(), &path, spilled.clone()), _ => *self.d.tree_mut() = spilled.clone() } }
        }
        let root = std::mem::replace(self.d.tree_mut(), super::nothing());
        *self.d.tree_mut() = normalise(root, true);
        self.forget(tile);
        for (t, n) in names {
            let named = if self.d.named(n).is_none() { n.clone() } else { let stem = n.trim_end_matches(|c: char| c.is_ascii_digit() || c == '-'); self.d.auto_name(if stem.is_empty() { "tile" } else { stem }, &[]) };
            self.d.names.set(t, named);
        }
        for (t, f) in folds { if fresh.contains(t) { self.d.collapsed.set(t, f.clone()) } }
        for (t, l) in agents { if fresh.contains(t) { self.d.agents.set(t, l.clone()) } }
        for w in wires { if fresh.contains(&w.from) && fresh.contains(&w.to) { self.d.wires.push(w.clone()) } }
        if had { self.d.focus = fresh[0].clone() }
        self.answer = obj(json!({ "tile": name, "spilled": fresh.iter().map(|t| self.d.names.get(t)).collect::<Vec<_>>() }));
        Ok(())
    }

    /// The tile leaves the layout, and the keys it had go somewhere that shows.
    fn lift(&mut self, id: &str) {
        let float = self.d.is_float(id);
        let (had, back) = (self.d.focus == id, self.d.opened_from.get(id).cloned());
        let into = if had && self.ctx.standing { self.ctx.opened.iter().find(|(_, ids, _)| ids.iter().any(|x| x == id)).cloned() } else { None };
        let fl = if float { None } else { flow_holding(self.tree(), id) };
        let alone = fl.as_ref().is_some_and(|(path, ci)| self.tree().at(path).is_some_and(|f| f.kids()[*ci].leaves().len() == 1));
        let heir = fl.as_ref().filter(|_| alone).and_then(|(path, ci)| self.tree().at(path).and_then(|f| tree::tile_of_column(f, if *ci > 0 { ci - 1 } else { ci + 1 })));
        if let Some((path, ci)) = fl.as_ref().filter(|_| alone) {
            let covers = covers_of(&self.d, path, self.ctx.area, &self.holds());
            if let Some(flow) = self.d.tree_mut().at_mut(path) { leaving(flow, *ci, &covers) }
        }
        if !float {
            let root = std::mem::replace(self.d.tree_mut(), super::nothing());
            *self.d.tree_mut() = normalise(tree::remove(root, id).unwrap_or_else(super::nothing), true);
        }
        self.forget(id);
        if self.d.focus != id { return }
        if had && self.ctx.standing && let Some((to, by, typing)) = self.keys_back_to(id, back.as_ref(), into.as_ref()) {
            self.give(&to);
            tree::activate(self.d.tree_mut(), &to);
            let mut went = obj(json!({ "tile": self.name(&to), "by": by }));
            if typing { went.insert("typing".into(), json!(true)); }
            self.went = Some(Value::Object(went));
            return;
        }
        let visible = self.tree().visible();
        self.d.focus = heir.filter(|h| self.tree().has(h)).or_else(|| visible.iter().find(|x| !self.d.collapsed.has(x)).cloned()).or_else(|| visible.first().cloned()).or_else(|| self.all().into_iter().next()).unwrap_or_default();
    }

    /// Where the keys go back to when their tile leaves: the tile it was opened from, or the container it was opened into.
    fn keys_back_to(&self, id: &str, back: Option<&OpenedFrom>, into: Option<&(String, Vec<Id>, Option<Id>)>) -> Option<(Id, &'static str, bool)> {
        let all = self.all();
        let here = |x: Option<&Id>| x.filter(|x| x.as_str() != id && all.contains(x)).cloned();
        if let Some((key, ids, active)) = into {
            if let Some(top) = here(self.d.floats.last().map(|f| &f.spec.id)) { return Some((top, "into", false)) }
            let order = node_by_key(self.tree(), key).and_then(|p| self.tree().at(&p)).map(Node::leaves).unwrap_or_default();
            let live: Vec<&Id> = ids.iter().filter(|x| here(Some(x)).is_some() && !self.d.is_float(x)).collect();
            let listed: Vec<Id> = order.iter().filter(|x| live.contains(x)).cloned().chain(live.iter().filter(|x| !order.contains(x)).map(|x| (*x).clone())).collect();
            let at = active.as_ref().filter(|a| listed.contains(a)).or(listed.last());
            if let Some(at) = here(at) { return Some((at, "into", false)) }
            return here(self.ctx.home.as_ref()).map(|home| (home, "home", false));
        }
        back.and_then(|b| here(Some(&b.from)).map(|from| (from, "opener", b.typing)))
    }

    /// Everything the layout held about a tile that is gone.
    fn forget(&mut self, id: &str) {
        self.d.across.retain(|w| w.from != id);
        self.d.floats.retain(|f| f.spec.id != id);
        self.d.collapsed.remove(id);
        self.d.agents.remove(id);
        self.d.opened_from.0.retain(|(k, o)| k != id && o.from != id);
        self.d.names.remove(id);
        self.d.wires.retain(|w| w.from != id && w.to != id);
        self.d.alt_readers.retain(|x| x != id);
        if self.d.zoom.as_deref() == Some(id) { self.d.zoom = None }
        if self.d.lift.as_ref().is_some_and(|l| l.tile == id) { self.d.lift = None }
    }

    fn move_(&mut self, src: &str, to: &Place) -> Done {
        self.present(src)?;
        let target = match to { Place::Split { target, .. } | Place::Tabs { target, .. } => Some(target), Place::Edge { .. } => None };
        if let Some(target) = target.filter(|t| t.as_str() != src && self.d.collapsed.has(t)) { self.collapse(target, Some(false), None)? }
        self.guard(src, "move")?;
        self.drag(src)?;
        let (kind, name) = (self.facts(src).kind, self.name(src));
        self.goes_at(&kind, &name, &At::of_place(to))?;
        if let Some(at) = self.d.floats.iter().position(|f| f.spec.id == src) {
            let float = self.d.floats.remove(at);
            let root = std::mem::replace(self.d.tree_mut(), super::nothing());
            *self.d.tree_mut() = put_at(root, float.spec, &At::of_place(to));
            if self.takes_keys() { self.d.focus = src.to_string() }
            return Ok(());
        }
        let Some(next) = tree::move_tile(self.tree(), src, to) else { return no(format!("{name} can't go there: {}", if self.tree().leaves().len() < 2 { "it's the only tile" } else { "that's where it is" })) };
        *self.d.tree_mut() = next;
        self.unfold_misfit(src);
        let was_shown = self.tree().visible();
        for path in chain_of(self.tree(), src) {
            let opens = !self.agent() || src == self.d.focus;
            if let Some(Node::Dock { open, .. }) = self.d.tree_mut().at_mut(&path) && !*open && opens { *open = true }
        }
        tree::activate(self.d.tree_mut(), src);
        if self.agent() && was_shown.contains(&self.d.focus) && !self.tree().shown().contains(&self.d.focus) { let focus = self.d.focus.clone(); tree::activate(self.d.tree_mut(), &focus); }
        self.d.zoom = None;
        if self.takes_keys() { self.d.focus = src.to_string() }
        Ok(())
    }

    fn swap(&mut self, a: &str, b: &str) -> Done {
        self.present(a)?;
        self.present(b)?;
        if a == b { return no("a tile can't swap with itself") }
        self.guard(a, "move")?;
        self.guard(b, "move")?;
        self.not_float(a, "a swap")?;
        self.not_float(b, "a swap")?;
        self.drag(a)?;
        self.drag(b)?;
        self.goes_at(&self.facts(a).kind, &self.name(a), &At::Tabs { target: b.to_string(), index: None, behind: false })?;
        self.goes_at(&self.facts(b).kind, &self.name(b), &At::Tabs { target: a.to_string(), index: None, behind: false })?;
        let (sa, sb) = (self.spec(a), self.spec(b));
        for spec in self.d.tree_mut().specs_mut() { if spec.id == a { *spec = sb.clone() } else if spec.id == b { *spec = sa.clone() } }
        fn views(n: &mut Node, a: &str, b: &str) { if let Node::Dock { view: Some(view), .. } = n { for x in view.iter_mut() { if x == a { *x = b.to_string() } else if x == b { *x = a.to_string() } } } for k in n.kids_mut() { views(k, a, b) } }
        let _ = views;
        for id in [a, b] { self.unfold_misfit(id) }
        Ok(())
    }

    fn new_float_rect(&self) -> Rect {
        let (a, n) = (self.ctx.area, self.d.floats.len() as f64);
        let cols = tree::round(a.cols * 0.5).max((a.cols - 2.0).min(FLOAT_READS.0));
        let rows = tree::round(a.rows * 0.6).max((a.rows - 2.0).min(FLOAT_READS.1));
        Rect { col: a.col + tree::round(a.cols * 0.22).min((a.cols - cols - 1.0).max(1.0)) + n * 3.0, row: a.row + tree::round(a.rows * 0.12).min((a.rows - rows - 1.0).max(0.0)) + n * 2.0, cols, rows }
    }

    fn float(&mut self, id: &str) -> Done {
        self.present(id)?;
        self.guard(id, "float")?;
        self.drag(id)?;
        if !self.ctx.empties && self.tree().leaves().len() < 2 { return no(format!("{} is the only tile in the layout; there's nothing for it to float over", self.name(id))) }
        let spec = self.spec(id);
        let root = std::mem::replace(self.d.tree_mut(), super::nothing());
        *self.d.tree_mut() = normalise(tree::remove(root, id).unwrap_or_else(super::nothing), true);
        self.d.collapsed.remove(id);
        let rect = keep_on_screen(self.new_float_rect(), self.ctx.area);
        self.d.floats.push(Float { spec, rect, peek_of: None });
        if self.takes_keys() { self.d.focus = id.to_string() }
        self.d.zoom = None;
        self.answer = obj(json!({ "floated": true }));
        Ok(())
    }

    /// A float goes back into the layout: where asked, beside the tile with the keys, or the first place that takes it.
    fn land(&mut self, id: &str, at: Option<&At>) -> Done {
        self.guard(id, "float")?;
        let e = effective(&[self.screen_layer()]);
        if e.locked && !self.yolo() { return no(self.locked_why(&e, &format!("putting {} back", self.name(id)))) }
        let (kind, name, spec) = (self.facts(id).kind, self.name(id), self.spec(id));
        let why_not = |next: &Node| -> Option<Refusal> {
            if !next.has(id) { return Some(why(format!("there's no place for {name} in the layout"))) }
            let mut layers = vec![self.screen_layer()];
            layers.extend(chain_of(next, id).iter().filter_map(|p| next.at(p)).map(|c| Layer { by: c.id_or_t(), policy: c.policy(), flow: false }));
            let e = effective(&layers);
            if e.locked && !self.yolo() { return Some(self.locked_why(&e, &format!("putting {name} back"))) }
            if !e.droppable { return Some(why(format!("{} takes no drops: {name} doesn't land there", self.whose(e.by("droppable")))).way(turns_on("droppable", e.by("droppable")))) }
            if let Some(accepts) = &e.accepts && !accepts.contains(&kind) { return Some(why(format!("{} takes only {}: not {name} ({kind})", self.whose(e.by("accepts")), if accepts.is_empty() { "nothing".to_string() } else { accepts.join(", ") }))) }
            None
        };
        let try_at = |to: &At| put_at(self.tree().clone(), spec.clone(), to);
        let focus = self.d.focus.clone();
        let base = if self.d.is_float(&focus) || focus == id || !self.tree().has(&focus) { tree::pinned_tiles(self.tree()).pop().or_else(|| self.tree().leaves().pop()) } else { Some(focus) };
        let default = match &base { Some(base) => At::Split { target: base.clone(), dir: Dir::Right, pair: false, weight: None }, None => At::Edge { dir: Dir::Right } };
        let first = try_at(at.unwrap_or(&default));
        let refused = why_not(&first);
        if let (Some(At::Split { .. }), Some(refused)) = (at, &refused) { return no(refused.clone().way(Way::new("tile.float", "puts it back where it was opened").arg("on", false).tile(&name))) }
        let mut next = if refused.is_none() { Some(first) } else { None };
        if next.is_none() {
            let tries: Vec<At> = tree::pinned_tiles(self.tree()).into_iter().map(|t| At::Split { target: t, dir: Dir::Right, pair: false, weight: None }).chain([Dir::Right, Dir::Down, Dir::Left, Dir::Up].into_iter().map(|dir| At::Edge { dir })).collect();
            next = tries.iter().map(try_at).find(|n| why_not(n).is_none());
        }
        let Some(next) = next else { return no(refused.unwrap_or_else(|| why(""))) };
        *self.d.tree_mut() = next;
        if let Some(At::Split { target, .. }) = at && self.d.floats.iter().find(|f| f.spec.id == id).and_then(|f| f.peek_of.as_ref()) == Some(target) { self.d.wires.retain(|w| w.to != id || w.verb != "select") }
        self.d.floats.retain(|f| f.spec.id != id);
        self.answer = obj(json!({ "floated": false }));
        Ok(())
    }

    fn nudge(&mut self, op: &Op) -> Done {
        let Op::Nudge { tile, dx, dy, col, row, cols, rows } = op else { return Ok(()) };
        let focus = self.d.focus.clone();
        let id = tile.clone().or_else(|| self.d.is_float(&focus).then_some(focus)).or_else(|| self.d.floats.last().map(|f| f.spec.id.clone()));
        let Some(id) = id.filter(|id| self.d.is_float(id)) else { return no(why(format!("{} isn't a float", tile.as_ref().map_or("no tile".to_string(), |t| self.name(t)))).way(Way::new("tile.float", "pops a tile out as one"))) };
        self.guard(&id, "move")?;
        self.shape(&id, &format!("moving {}", self.name(&id)))?;
        let area = self.ctx.area;
        let name = self.name(&id);
        let Some(f) = self.d.floats.iter_mut().find(|f| f.spec.id == id) else { return Ok(()) };
        let mut r = f.rect;
        if let Some(cols) = cols { r.cols = *cols }
        if let Some(rows) = rows { r.rows = *rows }
        r.col = col.unwrap_or(r.col + dx.unwrap_or(0.0));
        r.row = row.unwrap_or(r.row + dy.unwrap_or(0.0));
        f.rect = keep_on_screen(r, area);
        self.answer = obj(json!({ "tile": name, "rect": f.rect.json() }));
        Ok(())
    }

    /// What a dock is remembered by once it is no dock: its tile, or its container.
    fn dock_key(&self, path: &[usize]) -> String {
        match self.tree().at(path) { Some(Node::Dock { kid, .. }) => match kid.as_ref() { Node::Leaf(s) => format!("t{}", s.id), kid => kid.id().map_or_else(|| format!("t{}", kid.leaves().first().cloned().unwrap_or_default()), str::to_string) }, _ => String::new() }
    }
    fn remember(&mut self, dock: Option<Path>, key: &str) {
        let Some(Some(policy)) = self.d.remembered.get(key).cloned() else { return };
        if let Some(meta) = dock.and_then(|p| self.d.tree_mut().at_mut(&p)).and_then(Node::meta_mut) && meta.policy.is_none() { meta.policy = Some(policy) }
    }
    fn set_tree(&mut self, next: Node) { *self.d.tree_mut() = normalise(next, true) }
    fn dock_answer(&self, id: &str) -> Map<String, Value> {
        let now = tree::dock_of(self.tree(), id).and_then(|p| self.tree().at(&p));
        let mut answer = obj(json!({ "pinned": now.is_none() }));
        if let Some(Node::Dock { side, open, meta, .. }) = now {
            answer.insert("edge".into(), json!(side.word()));
            if let Some(id) = &meta.id { answer.insert("container".into(), json!(id)); }
            answer.insert("open".into(), json!(open));
        }
        answer
    }

    fn pin(&mut self, id: &str, mut on: Option<bool>, edge_to: Option<Dir>, container: Option<&str>) -> Done {
        self.present(id)?;
        if self.d.is_float(id) {
            if self.agent() && id == self.d.focus { return no(self.theirs(id, "move it")) }
            if container.is_some() { return no(why(format!("{} is a float: no container holds it", self.name(id))).way(Way::new("tile.dock", "puts it in a dock of its own").tile(&self.name(id)))) }
            self.land(id, None)?;
            if on == Some(true) { self.answer = obj(json!({ "pinned": true, "floated": false })); return Ok(()) }
            on = Some(false);
        }
        let (name, focus) = (self.name(id), self.d.focus.clone());
        if let (Some(container), true) = (container, on != Some(true)) {
            let Some(c) = node_by_id(self.tree(), container).filter(|p| !self.tree().at(p).is_some_and(Node::is_dock)) else { return no(why(format!("no container {container} to put in a dock")).way(ids("gives each one's id"))) };
            let inside = self.tree().at(&c).map(Node::leaves).unwrap_or_default();
            if !inside.iter().any(|x| x == id) { return no(format!("{container} doesn't hold {name}")) }
            if inside.contains(&focus) { self.guard(&focus, "move")? }
            let in_dock = tree::dock_of(self.tree(), id);
            let held = in_dock.as_ref().filter(|dock| dock.len() < c.len()).and_then(|dock| match self.tree().at(dock) { Some(Node::Dock { side, meta, .. }) if edge_to.is_none_or(|e| e == *side) => Some((*side, meta.id.clone())), _ => None });
            if let Some((side, dock_id)) = held {
                self.changed = false;
                self.answer = obj(json!({ "pinned": false, "changed": false, "edge": side.word(), "container": dock_id }));
                return Ok(());
            }
            self.shape(id, &format!("putting {container} in a dock"))?;
            let open = !self.agent() || inside.contains(&focus);
            let next = match (&in_dock, edge_to) { (Some(dock), Some(edge)) => tree::dock_to_edge(self.tree(), dock, edge, None), _ => tree::wrap_node_dock(self.tree(), &c, edge_to, open, 0.26) };
            let Some(next) = next else { return no(format!("{container} is the whole layout, holds every tile not docked, or is docked already; a dock needs something to slide over")) };
            self.set_tree(next);
            // The new dock's id is stamped when the step is sealed: the answer names it only when it had one.
            let now = tree::dock_of(self.tree(), id);
            if now.is_some() && in_dock.is_none() { self.remember(now, container) }
            self.answer = self.dock_answer(id);
            return Ok(());
        }
        let dock = tree::dock_of(self.tree(), id);
        let pinned = dock.is_none();
        let want = on.unwrap_or(if edge_to.is_some() { false } else { !pinned });
        let dock_side = dock.as_ref().and_then(|p| match self.tree().at(p) { Some(Node::Dock { side, .. }) => Some(*side), _ => None });
        if want == pinned && !(edge_to.is_some() && !want && dock_side.is_some_and(|s| Some(s) != edge_to)) {
            self.changed = false;
            let mut answer = obj(json!({ "pinned": pinned, "changed": false }));
            if let Some(Node::Dock { side, meta, .. }) = dock.as_ref().and_then(|p| self.tree().at(p)) { answer.insert("edge".into(), json!(side.word())); answer.insert("container".into(), json!(meta.id)); }
            self.answer = answer;
            return Ok(());
        }
        for t in self.fold_set(id) { self.guard(&t, "move")? }
        self.shape(id, &if want { format!("taking {name} out of its dock") } else { format!("putting {name} in a dock") })?;
        match (&dock, want, edge_to) {
            (Some(dock), true, _) => {
                let key = self.dock_key(dock);
                let policy = self.tree().at(dock).and_then(Node::policy).cloned();
                self.d.remembered.set(&key, policy);
                let root = std::mem::replace(self.d.tree_mut(), super::nothing());
                self.set_tree(tree::unwrap_dock(root, dock));
            }
            (Some(dock), false, Some(edge)) => {
                let Some(next) = tree::dock_to_edge(self.tree(), dock, edge, None) else { return no(format!("{} holds every tile; there's nothing for it to slide over", self.tree().at(dock).and_then(Node::id).unwrap_or("the dock"))) };
                self.set_tree(next);
            }
            _ => {
                let open = !self.agent() || self.fold_set(id).contains(&focus);
                let Some(next) = tree::wrap_dock(self.tree(), id, edge_to, open, 0.26) else { return no(format!("{name} is the last tile not docked (or its tab set is the whole layout); a dock needs something to slide over")) };
                self.set_tree(next);
                if let Some(now) = tree::dock_of(self.tree(), id) { let key = self.dock_key(&now); self.remember(Some(now), &key) }
            }
        }
        self.answer = self.dock_answer(id);
        Ok(())
    }

    fn slide(&mut self, id: &str, open: Option<bool>, container: Option<&str>, beside: bool) -> Done {
        self.present(id)?;
        let name = self.name(id);
        let nd = container.and_then(|c| node_by_id(self.tree(), c));
        let nd_dock = nd.as_ref().filter(|p| self.tree().at(p).is_some_and(Node::is_dock));
        if let Some(container) = container && !nd_dock.is_some_and(|p| self.tree().at(p).is_some_and(|d| d.has(id))) {
            return no(if nd_dock.is_some() { why(format!("{name} isn't in dock {container}")).way(Way::new("tile.slide", "slides that dock's own tile").arg("container", container.to_string()).arg("open", true)) } else { why(format!("no dock {container} in the layout")).way(ids("gives each dock's id (d<n>)")) });
        }
        let Some(dr) = nd_dock.cloned().or_else(|| tree::dock_of(self.tree(), id)) else { return no(why(format!("{name} isn't docked")).way(Way::new("tile.dock", "docks it").tile(&name))) };
        let dock = self.tree().at(&dr).cloned().unwrap_or_else(super::nothing);
        let Node::Dock { open: is_open, side, .. } = &dock else { return Ok(()) };
        let dock_id = dock.id().unwrap_or("the dock").to_string();
        let want = open.unwrap_or(!(*is_open && dock.visible().iter().any(|x| x == id)));
        if want && self.ctx.screen_host.as_deref() == Some("none") && self.tree().has("screen") { return no("the screen shown keeps the whole screen (its host policy is none): the host layer comes back on another screen") }
        if !want && !self.d.policy_of_node(&dr).collapsible { return no(why(format!("{dock_id} stays open: it doesn't slide shut")).way(turns_on("collapsible", Some(&dock_id)))) }
        if dock.has(&self.d.focus) && (!want || (!beside && id != self.d.focus)) { self.may_move_keys(if want { "swap the dock they have" } else { "shut the dock they have" })? }
        if !want && *is_open {
            let mut shut = self.tree().clone();
            if let Some(Node::Dock { open, .. }) = shut.at_mut(&dr) { *open = false }
            if shut.visible().is_empty() { return no(why(format!("{dock_id} is all the screen shows: shut, nothing would be left")).way(Way::new("tile.dock", "undocks it").arg("on", false).at("on a tile in it"))) }
        }
        if want && !beside {
            for other in tree::docks(self.tree()).into_iter().filter(|p| *p != dr) {
                let Some(Node::Dock { side: s, open: true, meta, .. }) = self.tree().at(&other) else { continue };
                if s != side || meta.policy.as_ref().and_then(|p| p.flag("overlay")) == Some(false) || !self.d.policy_of_node(&other).collapsible { continue }
                if self.tree().at(&other).is_some_and(|d| d.has(&self.d.focus)) { self.may_move_keys("swap the dock they have")? }
                if let Some(Node::Dock { open, .. }) = self.d.tree_mut().at_mut(&other) { *open = false }
            }
        }
        if let Some(d) = self.d.tree_mut().at_mut(&dr) { tree::choose_dock(d, id, want, beside, open.is_none()) }
        if want && !self.agent() && !self.ctx.busy { self.d.focus = id.to_string(); tree::activate(self.d.tree_mut(), id); }
        else if !self.tree().visible().contains(&self.d.focus) {
            let visible = self.tree().visible();
            let home = self.ctx.home.clone().filter(|h| self.ctx.standing && visible.contains(h));
            if let Some(to) = home.clone().or_else(|| visible.first().cloned()) { self.d.focus = to }
            if let Some(home) = home { self.went = Some(json!({ "tile": self.name(&home), "by": "home" })) }
        }
        let mut answer = obj(json!({ "open": want, "edge": side.word() }));
        if let Some(id) = dock.id() { answer.insert("container".into(), json!(id)); }
        if let Some(went) = self.went.take() { answer.insert("keys".into(), went); }
        self.answer = answer;
        Ok(())
    }

    /// The tiles that fold together: a tab set's, else the tile alone.
    fn fold_set(&self, id: &str) -> Vec<Id> { match tabs_of(self.tree(), id).and_then(|p| self.tree().at(&p)) { Some(Node::Tabs { kids, .. }) => kids.iter().map(|s| s.id.clone()).collect(), _ => vec![id.to_string()] } }
    fn unfold_misfit(&mut self, id: &str) {
        let axis = parent_of(self.tree(), Target::Tile(id)).and_then(|(p, _)| self.tree().at(&p)).and_then(Node::dir);
        if self.d.collapsed.get(id).is_some_and(|f| !f.fits(axis)) { for t in self.fold_set(id) { self.d.collapsed.remove(&t); } }
    }
    /// The flow whose column a tile is by itself (a leaf or a tab set).
    fn flow_column(&self, id: &str) -> Option<(Path, usize)> {
        let (path, ci) = flow_holding(self.tree(), id)?;
        matches!(self.tree().at(&path)?.kids().get(ci)?, Node::Leaf(_) | Node::Tabs { .. }).then_some((path, ci))
    }

    fn collapse(&mut self, id: &str, on: Option<bool>, dir: Option<&str>) -> Done {
        self.present(id)?;
        let (name, was) = (self.name(id), self.d.collapsed.get(id).cloned());
        let want = on.unwrap_or(was.is_none());
        if let Some(dir) = dir.filter(|d| *d != "v" && *d != "h") { return no(format!("dir is v (a vertical spine) or h (a horizontal one), not {dir}")) }
        if !want && was.is_none() { self.changed = false; self.answer = obj(json!({ "collapsed": false, "changed": false })); return Ok(()) }
        let column = self.flow_column(id);
        if !want {
            let before = self.rects();
            for t in self.fold_set(id) { self.d.collapsed.remove(&t); }
            if column.is_none() {
                self.open_spine(id, Some(&before))?;
                if self.d.alt_readers.iter().any(|x| x == id) { self.room(id)? }
                self.changed = true;
            }
            self.answer.insert("collapsed".into(), json!(false));
            return Ok(());
        }
        let parent = parent_of(self.tree(), Target::Tile(id)).and_then(|(p, _)| self.tree().at(&p));
        let (in_flow, has_parent) = (parent.is_some_and(Node::is_flow), parent.is_some());
        let axis = if in_flow { None } else { parent.and_then(Node::dir) };
        let flat = dir.unwrap_or(if axis == Some(Axis::Col) { "h" } else { "v" }) == "h";
        if was.as_ref().is_some_and(|w| w.flat == flat) { self.changed = false; self.answer = obj(json!({ "collapsed": true, "changed": false })); return Ok(()) }
        self.not_float(id, "a spine")?;
        self.shape(id, &format!("folding {name}"))?;
        if let Some(column) = column { return self.fold_column(id, column) }
        let fold = Fold { by: None, flat };
        if !has_parent || in_flow || !fold.fits(axis) {
            if in_flow { return no(why(format!("{name} is a column of a flow: it squeezes to a spine by itself as it recedes")).way(Way::new("tile.widen", "widens it").tile(&name))) }
            return no(if !has_parent { format!("{name} isn't side by side with other tiles (nor stacked with any): only a tile in a row or a column folds to a spine") }
                else if flat { format!("{name} isn't stacked with other tiles: a horizontal spine needs a tile above or below it (dir=v folds it to a vertical one)") }
                else { format!("{name} isn't side by side with other tiles: a vertical spine needs a tile beside it (dir=h folds it to a horizontal one)") });
        }
        let e = self.policy_at(id);
        if !e.collapsible { return no(why(format!("{name} stays open: {} doesn't fold", e.by("collapsible").unwrap_or("undefined"))).way(turns_on("collapsible", e.by("collapsible")))) }
        if self.agent() && self.fold_set(id).contains(&self.d.focus) { return no(self.theirs(&self.d.focus, "fold it")) }
        let by = Fold { flat, ..self.ctx.by.fold() };
        for t in self.fold_set(id) { self.d.collapsed.set(&t, by.clone()) }
        self.answer = obj(json!({ "collapsed": true, "dir": if flat { "h" } else { "v" } }));
        Ok(())
    }

    fn fold_column(&mut self, id: &str, (path, ci): (Path, usize)) -> Done {
        let e = self.policy_at(id);
        if !e.collapsible { return no(why(format!("{} stays open: {} doesn't fold", self.name(id), e.by("collapsible").unwrap_or("undefined"))).way(turns_on("collapsible", e.by("collapsible")))) }
        if self.agent() && self.fold_set(id).contains(&self.d.focus) { return no(self.theirs(&self.d.focus, "fold it")) }
        let Some(flow @ Node::Flow { memory, .. }) = self.tree().at(&path) else { return Ok(()) };
        if tree::column_of(flow, memory.anchor.as_deref()) == Some(ci) {
            let open = |i: usize| flow.kids()[i].leaves().iter().any(|t| !self.d.collapsed.has(t));
            let mut others: Vec<usize> = (0..flow.kids().len()).filter(|i| *i != ci && open(*i)).collect();
            others.sort_by_key(|i| ((*i as i64 - ci as i64).abs(), *i));
            let Some(to) = others.first() else { return no(why(format!("{} is the only open column of its flow: open another first", self.name(id))).way(Way::new("tile.widen", "widens one"))) };
            let anchor = tree::tile_of_column(flow, *to);
            if let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(&path) { memory.anchor = anchor }
        }
        let by = self.ctx.by.fold();
        for t in self.fold_set(id) { self.d.collapsed.set(&t, by.clone()) }
        self.answer = obj(json!({ "collapsed": true, "dir": "v" }));
        Ok(())
    }

    fn touch(&mut self, id: &str) {
        let names = &self.d.names;
        self.d.touched.retain(|t| t != id && names.has(t));
        self.d.touched.push(id.to_string());
    }
    fn folded(&self, k: &Node) -> bool { k.leaves().iter().all(|t| self.d.collapsed.has(t)) }

    /// A line's kids in a new order, each with the share it had.
    fn reorder(&mut self, row: &[usize], order: Vec<usize>) {
        if let Some((kids, weights)) = self.d.tree_mut().at_mut(row).and_then(Node::line_mut) {
            let mut was: Vec<Option<(Node, f64)>> = std::mem::take(kids).into_iter().zip(std::mem::take(weights)).map(Some).collect();
            for i in order { if let Some((k, w)) = was.get_mut(i).and_then(Option::take) { kids.push(k); weights.push(w) } }
        }
    }

    /// A flow remembers which side of its middle each column shows on.
    fn remember_flow_sides(&mut self, flow: &[usize]) {
        let (base, slid) = self.d.placed(self.ctx.area, &self.holds());
        let Some(at) = base.flows.iter().chain(slid.iter().flat_map(|d| d.placed.flows.iter())).find(|f| f.path == flow).cloned() else { return };
        let middle = at.rect.col + at.rect.cols / 2.0;
        let Some(node) = self.tree().at(flow) else { return };
        let visible: Vec<(Id, bool)> = at.cols.iter().flat_map(|(i, _, rect)| node.kids()[*i].leaves().into_iter().map(|tile| (tile, rect.col + rect.cols / 2.0 < middle)).collect::<Vec<_>>()).collect();
        if let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(flow) {
            let hidden: Vec<(Id, bool)> = memory.sides.iter().filter(|(tile, _)| !visible.iter().any(|(t, _)| t == tile)).cloned().collect();
            memory.sides = hidden.iter().filter(|(_, left)| *left).cloned().chain(visible).chain(hidden.iter().filter(|(_, left)| !*left).cloned()).collect();
        }
    }

    fn gather(&mut self, id: &str, side: &str, node: Option<&str>) -> Done {
        let row = match node { Some(n) => node_by_id(self.tree(), n), None => parent_of(self.tree(), Target::Tile(id)).map(|(p, _)| p) };
        let Some(row) = row.filter(|p| self.tree().at(p).is_some_and(|r| r.is_line() && r.dir() == Some(Axis::Row))) else { return no(format!("{} needs a row or flow to gather spines", self.name(id))) };
        let policy = self.d.policy_of_node(&row);
        if policy.locked && !self.yolo() { return no(self.locked_why(&policy, "gathering spines")) }
        for t in self.tree().at(&row).map(Node::leaves).unwrap_or_default() { self.drag(&t)? }
        let spines = match side { "left" => "start", "right" => "end", "centre" => "centre", _ => "book" };
        let set_spines = |s: &mut Self| {
            if let Some(meta) = s.d.tree_mut().at_mut(&row).and_then(Node::meta_mut) { meta.policy.get_or_insert_with(Policy::default).0.insert("spines".into(), json!(spines)); }
            s.answer = obj(json!({ "side": side, "node": s.tree().at(&row).and_then(Node::id), "spines": spines }));
        };
        if self.tree().at(&row).is_some_and(Node::is_flow) {
            if side == "sides" { self.remember_flow_sides(&row) }
            set_spines(self);
            return Ok(());
        }
        if let Some(why) = self.resize_why(&row, None) { return no(why) }
        let boxes = self.rects();
        let at = |t: &Id| boxes.iter().find(|(x, _)| x == t).map(|(_, r)| *r);
        let line = self.tree().at(&row).cloned().unwrap_or_else(super::nothing);
        let rs: Vec<Rect> = line.leaves().iter().filter_map(at).collect();
        let middle = if rs.is_empty() { 0.0 } else { (rs.iter().map(|r| r.col).fold(f64::INFINITY, f64::min) + rs.iter().map(|r| r.col + r.cols).fold(f64::NEG_INFINITY, f64::max)) / 2.0 };
        let (mut left, mut open, mut right) = (Vec::new(), Vec::new(), Vec::new());
        for (i, k) in line.kids().iter().enumerate() {
            if !self.folded(k) { open.push(i); continue }
            let boxed = k.leaves().first().and_then(at);
            if side == "left" || (side == "sides" && boxed.is_some_and(|b| b.col + b.cols / 2.0 < middle)) { left.push(i) } else { right.push(i) }
        }
        if side == "centre" { self.centre_spines(&row) } else { self.reorder(&row, left.into_iter().chain(open).chain(right).collect()) }
        set_spines(self);
        Ok(())
    }

    fn centre_spines(&mut self, row: &[usize]) {
        let Some(line) = self.tree().at(row).filter(|r| r.dir() == Some(Axis::Row)).cloned() else { return };
        let collapsed = |t: &str| self.d.collapsed.has(t);
        let (mut left, mut open, mut right) = (Vec::new(), Vec::new(), Vec::new());
        for (i, k) in line.kids().iter().enumerate() {
            if !self.folded(k) { open.push(i) } else if k.leaves().first().and_then(|t| tree::spine_edge(&line, &collapsed, t, "centre", false, false)).is_some_and(|(_, left)| left) { left.push(i) } else { right.push(i) }
        }
        self.reorder(row, left.into_iter().chain(open).chain(right).collect());
    }

    fn open_spine(&mut self, id: &str, prior: Option<&[(Id, Rect)]>) -> Done { self.keeps_size(|s| s.unfold_row(id, prior)) }

    /// A spine opens in its row: the row's open tiles share the room, and the ones touched longest ago fold when
    /// there is too little for each to be read.
    fn unfold_row(&mut self, id: &str, prior: Option<&[(Id, Rect)]>) -> Done {
        let Some((row, _)) = parent_of(self.tree(), Target::Tile(id)).filter(|(p, _)| self.tree().at(p).is_some_and(|r| r.dir() == Some(Axis::Row) && !r.is_flow())) else { return Ok(()) };
        self.shape(id, "opening a spine")?;
        if self.resize_why(&row, None).is_some() { self.touch(id); return Ok(()) }
        let e = self.d.policy_of_node(&row);
        let line = |s: &Self| s.tree().at(&row).cloned().unwrap_or_else(super::nothing);
        let kid_of = |s: &Self, t: &str| line(s).kids().iter().position(|k| k.has(t));
        let move_to_edge = |s: &mut Self, kid: usize, target: &str, right: bool| {
            let n = line(s).kids().len();
            let mut rest: Vec<usize> = (0..n).filter(|i| *i != kid).collect();
            let kids = line(s);
            let at = rest.iter().position(|i| kids.kids()[*i].has(target)).map_or(0, |at| at + usize::from(right));
            rest.insert(at.min(rest.len()), kid);
            s.reorder(&row, rest);
        };
        {
            let l = line(self);
            let collapsed = |t: &str| self.d.collapsed.has(t);
            if let Some((target, left)) = tree::spine_edge(&l, &collapsed, id, &e.spines, false, true) && target != id && let Some(kid) = kid_of(self, id) { move_to_edge(self, kid, &target, !left) }
        }
        let boxes = self.rects();
        let span = |ids: &[Id], from: &[(Id, Rect)]| -> Option<f64> {
            let rs: Vec<Rect> = ids.iter().filter_map(|t| from.iter().find(|(x, _)| x == t).map(|(_, r)| *r)).collect();
            (!rs.is_empty()).then(|| rs.iter().map(|r| r.col + r.cols).fold(f64::NEG_INFINITY, f64::max) - rs.iter().map(|r| r.col).fold(f64::INFINITY, f64::min))
        };
        let width = span(&line(self).leaves(), &boxes).unwrap_or(0.0);
        // The kids that keep the size they had: a fixed container, a locked tile's.
        let kept: Vec<(Id, f64)> = line(self).kids().iter().filter_map(|k| {
            let fixed = k.policy().is_some_and(|p| p.0.contains_key("fixed"));
            if self.folded(k) || (!fixed && (self.yolo() || !k.leaves().iter().any(|t| self.policy_at(t).locked))) { return None }
            Some((k.leaves().first()?.clone(), span(&k.leaves(), prior.unwrap_or(&boxes)).unwrap_or(f64::NEG_INFINITY)))
        }).collect();
        let is_kept = |k: &Node| kept.iter().find(|(t, _)| k.has(t)).map(|(_, w)| *w);
        let reserved: f64 = kept.iter().map(|(_, w)| *w).sum();
        let state = |s: &Self| { let l = line(s); let opened = l.kids().iter().filter(|k| !s.folded(k)).count() as f64; let sharing = l.kids().iter().filter(|k| !s.folded(k) && is_kept(k).is_none()).count() as f64; (width - (l.kids().len() as f64 - opened) * SPINE - reserved, opened, sharing) };
        loop {
            let (room, opened, sharing) = state(self);
            if !(e.min_width > 0.0 && opened > 1.0 && room / sharing < e.min_width) { break }
            let l = line(self);
            let age = |k: &Node| k.leaves().iter().map(|t| self.d.touched.iter().position(|x| x == t).map_or(-1, |i| i as i64)).max().unwrap_or(-1);
            let mut candidates: Vec<&Node> = l.kids().iter().filter(|k| !self.folded(k) && !k.has(id) && matches!(k, Node::Leaf(_) | Node::Tabs { .. }) && k.leaves().iter().all(|t| {
                let (f, p) = (self.facts(t), self.policy_at(t));
                !f.holds && f.editing.is_none() && !p.locked && p.draggable && p.collapsible && (!self.agent() || (*t != self.d.focus && self.d.agent_level(t, Some(&f)).0 == "free"))
            })).collect();
            candidates.sort_by_key(|k| age(k));
            let Some(oldest) = candidates.first().map(|k| k.leaves()) else { break };
            let t = oldest[0].clone();
            let edge = { let collapsed = |x: &str| self.d.collapsed.has(x); tree::spine_edge(&l, &collapsed, &t, &e.spines, false, false) };
            for x in &oldest { self.d.collapsed.set(x, self.ctx.by.fold()) }
            if let Some((target, left)) = edge && target != t && let Some(kid) = kid_of(self, &t) { move_to_edge(self, kid, &target, !left) }
        }
        if e.spines == "centre" { self.centre_spines(&row) }
        let (room, _, sharing) = state(self);
        let share = room / sharing;
        let weights: Vec<f64> = line(self).kids().iter().map(|k| is_kept(k).unwrap_or(if self.folded(k) { 1.0 } else { share })).collect();
        if let Some((_, w)) = self.d.tree_mut().at_mut(&row).and_then(Node::line_mut) { *w = weights }
        self.touch(id);
        Ok(())
    }

    fn room(&mut self, id: &str) -> Done {
        self.present(id)?;
        let f = flow_holding(self.tree(), id);
        self.changed = f.is_some();
        self.answer = obj(json!({ "folded": [] }));
        if let Some((path, ci)) = f {
            self.remember_flow_sides(&path);
            let touched = self.d.touched.clone();
            if let Some(flow) = self.d.tree_mut().at_mut(&path) { widen(flow, ci, &touched) }
        }
        Ok(())
    }

    fn resize_border(&mut self, op: &Op) -> Done {
        let Op::Resize { split, path, border, share } = op else { return Ok(()) };
        if path.is_none() == split.is_none() { return no(why("a split is named by split=<id>, or by path=<p>").way(ids("gives each split's id"))) }
        let found = match split { Some(id) => node_by_id(self.tree(), id), None => read_path(path.as_deref().unwrap_or("")) }.filter(|p| self.tree().at(p).is_some_and(Node::is_line));
        let Some(at) = found else { return no(match split { Some(id) => why(format!("no split {id} in the layout (it's gone: its tiles were moved or closed)")).way(ids("gives each split's id")), None => why(format!("no split at path {}", json!(path))).way(ids("gives each split's path")) }) };
        let n = self.tree().at(&at).cloned().unwrap_or_else(super::nothing);
        let count = n.kids().len();
        if border.fract() != 0.0 || *border < 0.0 || *border >= count as f64 - 1.0 { return no(format!("split {} has borders 0-{}", n.id().unwrap_or("undefined"), count as i64 - 2)) }
        let b = *border as usize;
        if let Some(why) = self.resize_why(&at, Some(b)) { return no(why) }
        let f = share.min(0.92).max(0.08);
        let slides = |k: Option<&Node>| matches!(k, Some(Node::Dock { meta, .. }) if meta.policy.as_ref().and_then(|p| p.flag("overlay")) != Some(false));
        let di = if slides(n.kids().get(b)) { Some(b) } else if slides(n.kids().get(b + 1)) { Some(b + 1) } else { None };
        if let Some((_, weights)) = self.d.tree_mut().at_mut(&at).and_then(Node::line_mut) {
            let sum = weights[b] + weights[b + 1];
            match di {
                Some(di) => {
                    let total: f64 = weights.iter().sum();
                    let want = if di == b { sum * f } else { sum * (1.0 - f) };
                    let others = total - weights[di];
                    let scale = if others > 0.0 { (total - want) / others } else { 1.0 };
                    for (i, w) in weights.iter_mut().enumerate() { *w = if i == di { want } else { *w * scale } }
                }
                None => { weights[b] = sum * f; weights[b + 1] = sum - weights[b] }
            }
        }
        self.answer = obj(json!({ "split": n.id(), "path": at.iter().map(usize::to_string).collect::<Vec<_>>().join("."), "border": b, "share": tree::num(tree::round(f * 1000.0) / 1000.0), "tiles": n.leaves().iter().map(|x| self.name(x)).collect::<Vec<_>>() }));
        Ok(())
    }

    fn shares(&mut self, split: &str, shares: &[f64]) -> Done {
        let Some(at) = node_by_id(self.tree(), split).filter(|p| self.tree().at(p).is_some_and(|n| n.is_line() && !n.is_flow())) else { return no(why(format!("no split {split} in the layout")).way(ids("gives each split's id"))) };
        let count = self.tree().at(&at).map_or(0, |n| n.kids().len());
        if shares.len() != count || !shares.iter().all(|x| x.is_finite() && *x > 0.0) { return no(format!("split {split} has {count} kids: shares are that many positive numbers")) }
        if let Some(why) = self.resize_why(&at, None) { return no(why) }
        let sum: f64 = shares.iter().sum();
        if let Some((_, weights)) = self.d.tree_mut().at_mut(&at).and_then(Node::line_mut) { *weights = shares.iter().map(|x| x / sum).collect() }
        Ok(())
    }

    fn grow(&mut self, id: &str, axis: Axis, by: f64) -> Done {
        self.present(id)?;
        let along = chain_of(self.tree(), id).into_iter().rev().find(|p| self.tree().at(p).is_some_and(|c| c.is_line() && c.dir() == Some(axis) && c.kids().len() > 1));
        match along { Some(along) => if let Some(why) = self.resize_why(&along, None) { return no(why) }, None => self.shape(id, "resizing")? }
        if !tree::resize(self.d.tree_mut(), id, axis, 0.05 * by, (0.1, 0.9)) { return no(format!("tile {} has no border {} to move", self.name(id), if axis == Axis::Row { "beside it" } else { "above or below it" })) }
        Ok(())
    }

    fn even(&mut self) -> Done {
        if self.d.policy.flag("locked") == Some(true) && !self.yolo() { return no(why(format!("{} is locked: evening it out is refused", self.own_name())).ways(self.unlock_ways())) }
        let mut tree = self.tree().clone();
        tree::even(&mut tree, &mut Vec::new(), &|path| self.resize_why(path, None).is_some());
        *self.d.tree_mut() = tree;
        Ok(())
    }

    /// An agent's lock is an agent's to undo; the person's is theirs alone.
    fn locked_by(&mut self, key: &str, lock: bool) -> Done {
        if self.agent() && !lock && !self.d.locks.iter().any(|k| k == key) { return no(why(format!("{} was locked by the person; an agent doesn't unlock it", if key == "screen" { self.own_name() } else { key.to_string() })).ways(self.ctx.mark_them())) }
        self.d.locks.retain(|k| k != key);
        if lock && self.agent() { self.d.locks.push(key.to_string()) }
        Ok(())
    }

    fn lock(&mut self, on: Option<bool>) -> Done {
        let locked = self.d.policy.flag("locked") == Some(true);
        let want = on.unwrap_or(!locked);
        if want == locked { self.changed = false; self.answer = obj(json!({ "locked": want, "changed": false, "layout": self.own_name() })); return Ok(()) }
        self.locked_by("screen", want)?;
        self.d.policy.0.remove("locked");
        if want { self.d.policy.0.insert("locked".into(), json!(true)); }
        self.answer = obj(json!({ "locked": want, "changed": true, "layout": self.own_name(), "unlock": self.unlock_ways().iter().map(Way::json).collect::<Vec<_>>() }));
        Ok(())
    }

    fn set_policy(&mut self, op: &Op) -> Done {
        let Op::Policy { tile, node, set, clear } = op else { return Ok(()) };
        let Some(c) = self.policy_target(tile.as_deref(), node.as_deref()) else { return no(why(format!("no container {} in the layout (s<n> is a split, g<n> a tab set, d<n> a dock, f<n> a flow; node=screen is the screen)", node.as_deref().unwrap_or("undefined"))).way(ids("gives each one's id"))) };
        let bad: Vec<&str> = clear.iter().map(String::as_str).filter(|k| !tree::POLICY_KEYS.contains(k)).collect();
        if !bad.is_empty() { return no(format!("clear names {}, not {}", tree::POLICY_KEYS.join(", "), bad.join(", "))) }
        let name = match &c { None => "screen".to_string(), Some(path) => self.tree().at(path).map_or_else(String::new, Node::id_or_t) };
        let before = match &c { None => self.d.policy.clone(), Some(path) => self.tree().at(path).and_then(Node::policy).cloned().unwrap_or_default() };
        let e = match &c { None => effective(&[self.screen_layer()]), Some(path) => self.d.policy_of_node(path) };
        if e.locked && !self.yolo() && set.keys().chain(clear.iter()).any(|k| k != "locked") { return no(self.locked_why(&e, &format!("changing {name}'s policy"))) }
        if let Some(into) = set.get("opensInto").and_then(Value::as_str) {
            let to = self.d.named(into);
            if to.is_none() && node_by_key(self.tree(), into).is_none() { return no(format!("no tile or container {into} for opens to land in")) }
            if let Some(to) = to && !self.facts(&to).notes { return no(format!("{into} is a {} tile: opens land in a tile that takes notes", self.facts(&to).kind)) }
        }
        if let (Some(accepts), Some(kinds)) = (set.get("accepts").and_then(Value::as_array), &self.ctx.kinds) {
            let unknown: Vec<&str> = accepts.iter().filter_map(Value::as_str).filter(|k| !kinds.all.iter().any(|x| x == k)).collect();
            if !unknown.is_empty() { return no(format!("accepts names tile kinds ({}), not {}", kinds.all.join(", "), unknown.join(", "))) }
        }
        let was_locked = before.flag("locked") == Some(true);
        let locking = if set.get("locked") == Some(&json!(true)) { Some(true) } else if (set.get("locked") == Some(&json!(false)) || clear.iter().any(|k| k == "locked")) && was_locked { Some(false) } else { None };
        if let Some(locking) = locking && locking != was_locked { self.locked_by(&name, locking)? }
        let mut next = before.0.clone();
        for (k, v) in set { next.insert(k.clone(), v.clone()); }
        for k in clear { next.remove(k); }
        let policy = Policy::of(Some(&Value::Object(next)));
        match &c {
            None => self.d.policy = policy.clone(),
            Some(path) => if let Some(meta) = self.d.tree_mut().at_mut(path).and_then(Node::meta_mut) { meta.policy = (!policy.is_empty()).then(|| policy.clone()) },
        }
        self.answer = obj(json!({ "node": name, "policy": policy.json() }));
        Ok(())
    }

    fn link(&mut self, id: &str, to: Option<&str>, verb: &str, remove: bool, rule: Option<&str>) -> Done {
        self.present(id)?;
        self.shape(id, &format!("changing where {}'s {verb} lands", self.name(id)))?;
        let Some(to) = to.filter(|_| !remove) else {
            self.d.wires.retain(|w| !(w.from == id && w.verb == verb && to.is_none_or(|to| w.to == to)));
            self.answer = obj(json!({ "wire": null, "verb": verb }));
            return Ok(());
        };
        self.d.across.retain(|w| w.from != id || w.verb != verb);
        self.present(to)?;
        let f = self.facts(to);
        if let (true, Some(rule)) = (verb == "alt", rule.filter(|r| *r != "tile")) {
            self.d.wires.retain(|w| !(w.from == id && w.verb == verb));
            self.d.wires.push(Wire { from: id.to_string(), verb: verb.to_string(), to: to.to_string(), rule: Some(rule.to_string()) });
        } else { self.link_to(id, to, f.notes, &f.kind, verb)? }
        self.answer = obj(json!({ "wire": self.name(to), "verb": verb }));
        Ok(())
    }

    fn link_to(&mut self, id: &str, to: &str, notes: bool, kind: &str, verb: &str) -> Done {
        self.present(id)?;
        self.shape(id, &format!("changing where {}'s {verb} lands", self.name(id)))?;
        if to == id && verb != "open" { return no(format!("{}'s {verb} can't land in itself · leave to= out to unlink", self.name(id))) }
        if !notes && !(to == id && self.facts(id).lists) {
            return no(format!("{} is a {kind} tile: opens land in a tile that takes notes{}{}", self.name(to), if to == id { " or lists them" } else { "" }, self.ctx.kinds.as_ref().map_or(String::new(), |k| format!(" ({})", k.notes.join(", ")))));
        }
        self.d.wires.retain(|w| !(w.from == id && w.verb == verb));
        self.d.across.retain(|w| w.from != id || w.verb != verb);
        self.d.wires.push(Wire { from: id.to_string(), verb: verb.to_string(), to: to.to_string(), rule: None });
        Ok(())
    }

    fn focus(&mut self, id: &str, quiet: bool) -> Done {
        self.present(id)?;
        if id != self.d.focus { self.may_move_keys("move their keys")? }
        self.give(id);
        tree::activate(self.d.tree_mut(), id);
        if self.d.zoom.is_some() { self.d.zoom = Some(id.to_string()) }
        if !quiet { self.bring_out(id, true) }
        Ok(())
    }

    fn reveal(&mut self, id: &str) -> Done {
        self.present(id)?;
        let set = self.fold_set(id);
        let in_tabs = tabs_of(self.tree(), id).is_some();
        if !(self.agent() && in_tabs && set.contains(&self.d.focus) && self.d.focus != id) { tree::activate(self.d.tree_mut(), id); }
        let folded = self.d.collapsed.has(id);
        let prior = folded.then(|| self.rects());
        for t in self.fold_set(id) { self.d.collapsed.remove(&t); }
        if folded { self.open_spine(id, prior.as_deref())? }
        self.touch(id);
        let flow = flow_holding(self.tree(), id).map(|(p, _)| p);
        let steps = !(self.ctx.protect_typing && flow.is_some() && self.ctx.typing_in.as_ref().is_some_and(|t| flow_holding(self.tree(), t).map(|(p, _)| p) == flow));
        self.bring_out(id, steps);
        self.answer = obj(json!({ "tile": self.name(id) }));
        Ok(())
    }

    /// The tile is somewhere the person can see: its float on top, its docks open, its flow's wide column near enough.
    fn bring_out(&mut self, id: &str, flow_steps: bool) {
        if let Some(fi) = self.d.floats.iter().position(|f| f.spec.id == id) && fi < self.d.floats.len() - 1 { let f = self.d.floats.remove(fi); self.d.floats.push(f) }
        for path in chain_of(self.tree(), id) { if let Some(Node::Dock { open, .. }) = self.d.tree_mut().at_mut(&path) { *open = true } }
        let Some((path, ci)) = flow_holding(self.tree(), id).filter(|_| flow_steps) else { return };
        let shown = |s: &Self| covers_of(&s.d, &path, s.ctx.area, &s.holds()).iter().any(|(i, _)| *i == ci);
        let anchor = self.tree().at(&path).and_then(|f| match f { Node::Flow { memory, .. } => tree::column_of(f, memory.anchor.as_deref()), _ => None }).unwrap_or(0);
        let mut a = anchor;
        while a != ci && !shown(self) {
            if ci > a { a += 1 } else { a -= 1 }
            let tile = self.tree().at(&path).and_then(|f| tree::tile_of_column(f, a));
            if let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(&path) { memory.anchor = tile }
        }
    }

    fn tab(&mut self, id: &str, by: Option<i64>) -> Done {
        self.present(id)?;
        let Some(Node::Tabs { kids, active, .. }) = tabs_of(self.tree(), id).and_then(|p| self.tree().at(&p)).cloned() else { return no(format!("{} isn't in a tab set", self.name(id))) };
        let had_focus = kids.iter().any(|s| s.id == self.d.focus);
        let by = by.filter(|b| *b != 0);
        let showing = match by { Some(by) => kids[(active as i64 + by).rem_euclid(kids.len() as i64) as usize].id.clone(), None => id.to_string() };
        if self.agent() && had_focus && showing != self.d.focus { return no(format!("{} is the tab the person has; an agent doesn't hide it", self.name(&self.d.focus))) }
        match by { Some(by) => { tree::cycle(self.d.tree_mut(), id, by.signum()); } None => { tree::activate(self.d.tree_mut(), id); } }
        if !self.agent() && had_focus { self.d.focus = showing.clone() }
        self.answer = obj(json!({ "tile": self.name(&showing), "tabs": kids.iter().map(|s| self.name(&s.id)).collect::<Vec<_>>() }));
        Ok(())
    }

    fn zoom(&mut self, id: &str, on: Option<bool>, reach: &str) -> Done {
        self.present(id)?;
        let lift = self.d.lift.clone();
        if self.agent() && lift.as_ref().is_some_and(|l| l.by.get("kind") == Some(&json!("user"))) { return no("the person's lift stays up until they drop it") }
        if reach != "screen" {
            let want = on.unwrap_or(!lift.as_ref().is_some_and(|l| l.tile == id && l.reach == reach));
            if want && self.d.collapsed.has(id) { self.collapse(id, Some(false), None)? }
            let shown = if want { match tabs_of(self.tree(), id).and_then(|p| self.tree().at(&p)) { Some(Node::Tabs { kids, active, .. }) => kids.get(*active).map(|s| s.id.clone()), _ => None } } else { None };
            if let Some(shown) = shown.filter(|s| s != id) {
                if self.agent() && ((self.here() && shown == self.d.focus) || self.ctx.typing_in.as_ref() == Some(&shown)) { return no(format!("lifting {} would hide tile {}, which has the person's keys", self.name(id), self.name(&shown))) }
                tree::activate(self.d.tree_mut(), id);
                if shown == self.d.focus && (!self.agent() || !self.here()) { self.d.focus = id.to_string() }
            }
            self.d.lift = want.then(|| Lift { tile: id.to_string(), reach: reach.to_string(), by: self.ctx.by.json() });
            self.answer = obj(json!({ "zoomed": want, "reach": reach }));
            return Ok(());
        }
        self.d.lift = None;
        let want = on.unwrap_or(self.d.zoom.as_deref() != Some(id));
        if self.agent() && want && id != self.d.focus { return no(format!("zooming tile {} would hide tile {}, which has the person's keys", self.name(id), self.name(&self.d.focus))) }
        if !want { self.d.zoom = None } else {
            if self.d.collapsed.has(id) { self.collapse(id, Some(false), None)? }
            self.d.zoom = Some(id.to_string());
            if !self.agent() { self.d.focus = id.to_string() }
        }
        self.answer = obj(json!({ "zoomed": self.d.zoom.as_deref() == Some(id) }));
        Ok(())
    }

    /// Whether another arrangement may take this one's place, and, given the arrangement, the load itself: every
    /// tile that would go is asked what a close asks (does it hold an edit, has it the person's keys).
    fn load(&mut self, name: &str, to: Option<&Layout>, keys: bool) -> Done {
        if self.d.policy.flag("locked") == Some(true) { return no(why(format!("{} is locked: loading {name} would change its shape", self.own_name())).ways(self.unlock_ways())) }
        if self.agent() {
            fn locks(n: &Node, out: &mut Vec<String>) { if n.is_leaf() { return } if n.policy().and_then(|p| p.flag("locked")) == Some(true) { out.push(n.id_or_t()) } for k in n.kids() { locks(k, out) } }
            let mut found = Vec::new();
            locks(self.tree(), &mut found);
            if let Some(theirs) = found.iter().find(|k| !self.d.locks.contains(k)) { return no(why(format!("{theirs} was locked by the person; loading {name} would undo it, and an agent doesn't")).ways(self.ctx.mark_them())) }
        }
        self.may_move_keys("lay the desk out under them")?;
        let Some(to) = to else { self.changed = false; return Ok(()) };
        let stays = to.all();
        for id in self.all().into_iter().filter(|id| !stays.contains(id)) {
            let (label, f) = (self.name(&id), self.facts(&id));
            if let Some(editing) = &f.editing { return no(format!("{label} holds {editing}, and {name} has no such tile: save or discard it first")) }
            if self.agent() && self.here() && id == self.d.focus { return no(self.theirs(&id, &format!("lay the screen out as {name} without it"))) }
            if self.agent() && let Some(running) = &f.running { return no(format!("{label} is running {running}; an agent doesn't end it")) }
        }
        let had = self.d.focus.clone();
        let mut next = to.clone();
        // The revision counts on from this arrangement's, and a changed shape is a new one.
        (next.rev, next.next_node, next.shape_key) = (self.d.rev, self.d.next_node.max(next.next_node), self.d.shape_key.clone());
        if (!keys || self.agent()) && next.all().contains(&had) { tree::activate(next.tree_mut(), &had); next.focus = had }
        self.d = next;
        self.answer.insert("tiles".into(), json!(self.d.names.0.iter().map(|(_, name)| name.clone()).collect::<Vec<_>>()));
        Ok(())
    }

    fn fill(&mut self, op: &Op) -> Done {
        let Op::Fill { container, order, fresh, drop, weights, names, select } = op else { return Ok(()) };
        if self.agent() { return no("a columns container is filled from its source by the screen; an agent changes the source's data (its hub's views) instead") }
        for id in drop {
            if !self.all().contains(id) { self.forget(id); continue }
            if !self.d.is_float(id) {
                let root = std::mem::replace(self.d.tree_mut(), super::nothing());
                match tree::remove(root.clone(), id) { Some(next) => *self.d.tree_mut() = normalise(next, true), None => *self.d.tree_mut() = root }
            }
            self.forget(id);
            if self.d.focus == *id { let visible = self.tree().visible(); self.d.focus = visible.iter().find(|x| !self.d.collapsed.has(x)).cloned().or_else(|| visible.first().cloned()).or_else(|| self.all().into_iter().next()).unwrap_or_default() }
        }
        let renames: Vec<&(Id, String)> = names.iter().filter(|(id, name)| self.d.names.get(id).is_some_and(|n| n != name)).collect();
        let was: Vec<(Id, String)> = renames.iter().map(|(id, _)| (id.clone(), self.name(id))).collect();
        // Renames give way to each other first: each keeps its place in the order names were first set.
        let places: Vec<usize> = renames.iter().filter_map(|(id, _)| self.d.names.0.iter().position(|(k, _)| k == id)).collect();
        let _ = places;
        for (id, _) in &renames { self.d.names.remove(id); }
        for (id, name) in &renames {
            let old = was.iter().find(|(k, _)| k == id).map(|(_, n)| n.clone()).unwrap_or_default();
            let to = if self.d.named(name).is_none() { name.clone() } else if self.d.named(&old).is_none() { old } else { self.d.auto_name(&self.facts(id).kind, &[]) };
            self.d.names.set(id, to);
        }
        for (t, name) in fresh { let named = name.clone().filter(|n| self.d.named(n).is_none()).unwrap_or_else(|| self.d.auto_name(&t.kind, &[])); self.d.names.set(&t.id, named) }
        let Some(path) = node_by_id(self.tree(), container).filter(|p| matches!(self.tree().at(p), Some(Node::Columns { .. }))) else { return if drop.is_empty() { no(format!("no columns {container} in the layout")) } else { Ok(()) } };
        let col = self.tree().at(&path).cloned().unwrap_or_else(super::nothing);
        let at = |id: &Id| col.kids().iter().position(|k| matches!(k, Node::Leaf(s) if s.id == *id));
        let (mut kids, mut ws, mut used): (Vec<Node>, Vec<f64>, Vec<usize>) = (Vec::new(), Vec::new(), Vec::new());
        for id in order {
            let (i, new) = (at(id), fresh.iter().find(|(t, _)| t.id == *id));
            if i.is_none() && new.is_none() { continue }
            let weight = weights.iter().find(|(t, _)| t == id).map(|(_, w)| *w).unwrap_or_else(|| i.map_or(1.0, |i| col.weights()[i]));
            match (i, new) { (Some(i), _) => { kids.push(col.kids()[i].clone()); used.push(i) } (None, Some((spec, _))) => kids.push(Node::Leaf(spec.clone())), _ => {} }
            ws.push(weight);
        }
        let all = self.all();
        for (i, k) in col.kids().iter().enumerate() {
            if !used.contains(&i) && !k.leaves().is_empty() && k.leaves().iter().all(|id| all.contains(id) || fresh.iter().any(|(t, _)| t.id == *id)) { kids.push(k.clone()); ws.push(col.weights()[i]) }
        }
        for to in select { for from in order { if from != to && !self.d.wires.iter().any(|w| w.from == *from && w.to == *to && w.verb == "select") { self.d.wires.push(Wire { from: from.clone(), to: to.clone(), verb: "select".into(), rule: None }) } } }
        if let Some((k, w)) = self.d.tree_mut().at_mut(&path).and_then(Node::line_mut) { *k = kids; *w = ws }
        let root = std::mem::replace(self.d.tree_mut(), super::nothing());
        *self.d.tree_mut() = normalise(root, true);
        Ok(())
    }

    fn flow_of(&self, id: &str) -> Result<(Path, usize), Refusal> {
        self.present(id)?;
        flow_holding(self.tree(), id).ok_or_else(|| why(format!("{} isn't in a flow: a flow's columns widen, pin and go back and forward", self.name(id))))
    }

    fn widen(&mut self, id: &str) -> Done {
        let (path, ci) = self.flow_of(id)?;
        let e = self.d.policy_of_node(&path);
        if e.locked && !self.yolo() { return no(self.locked_why(&e, "widening")) }
        let flow = self.tree().at(&path).cloned().unwrap_or_else(super::nothing);
        if let Some(typing) = self.ctx.typing_in.as_ref().filter(|t| self.ctx.protect_typing && t.as_str() != id && tree::column_of(&flow, Some(t)).is_some()) { return no(typing_in(&format!("{}, a column of this flow", self.name(typing)), "widen another column: it would squeeze theirs", self.ctx.mark_them())) }
        let before = match &flow { Node::Flow { memory, .. } => memory.anchor.clone(), _ => None };
        let folded: Vec<Id> = flow.kids()[ci].leaves().into_iter().filter(|t| self.d.collapsed.has(t)).collect();
        self.remember_flow_sides(&path);
        let touched = self.d.touched.clone();
        if let Some(flow) = self.d.tree_mut().at_mut(&path) { widen(flow, ci, &touched) }
        for t in &folded { self.d.collapsed.remove(t); }
        let after = match self.tree().at(&path) { Some(Node::Flow { memory, .. }) => memory.anchor.clone(), _ => None };
        if after == before && folded.is_empty() { self.changed = false }
        self.answer = obj(json!({ "wide": true }));
        Ok(())
    }

    fn travel(&mut self, id: &str, dir: i64) -> Done {
        if self.agent() { return no(why("back and forward in a flow move the person's keys between columns; an agent opens beside instead").way(Way::new("open", "opens a note beside")).way(Way::new("link.follow", "follows a link beside"))) }
        let (path, ci) = self.flow_of(id)?;
        let flow = self.tree().at(&path).cloned().unwrap_or_else(super::nothing);
        let Some(to) = travel_target(&flow, ci, dir) else { return no(if dir < 0 { "nothing to go back to: this column wasn't opened from one still open" } else { "nothing ahead: go back first" }) };
        let (here, there) = (tree::tile_of_column(&flow, ci), tree::tile_of_column(&flow, to));
        if let Some(f) = self.d.tree_mut().at_mut(&path) {
            if dir < 0 { set_ahead(f, to, ci) }
            if let Node::Flow { memory, .. } = f { memory.read = here }
        }
        if let Some(there) = there { self.d.focus = there }
        let covers = covers_of(&self.d, &path, self.ctx.area, &self.holds());
        if covers.iter().find(|(i, _)| *i == to).map(|(_, c)| *c) != Some(Cover::Full) {
            self.remember_flow_sides(&path);
            let touched = self.d.touched.clone();
            if let Some(f) = self.d.tree_mut().at_mut(&path) { widen(f, to, &touched) }
        }
        self.answer = obj(json!({ "tile": self.name(&self.d.focus) }));
        Ok(())
    }

    fn hold_column(&mut self, id: &str, on: Option<bool>) -> Done {
        let (path, ci) = self.flow_of(id)?;
        let e = self.d.policy_of_node(&path);
        if e.locked && !self.yolo() { return no(self.locked_why(&e, "holding a column")) }
        let flow = self.tree().at(&path).cloned().unwrap_or_else(super::nothing);
        let was = matches!(&flow, Node::Flow { memory, .. } if memory.held.iter().any(|t| tree::column_of(&flow, Some(t)) == Some(ci)));
        let want = on.unwrap_or(!was);
        if want == was { self.changed = false }
        let here = flow.kids()[ci].leaves();
        if let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(&path) {
            memory.held.retain(|t| !here.contains(t));
            if want && let Some(first) = here.first() { memory.held.push(first.clone()); memory.keep = None }
        }
        if want && !was {
            self.touch(id);
            let touched = self.d.touched.clone();
            if let Some(Node::Flow { memory, .. }) = self.d.tree_mut().at_mut(&path) { memory.recent = touched }
        }
        self.answer = obj(json!({ "held": want }));
        Ok(())
    }
}

/// A path as an agent writes one: `0.2.1`.
fn read_path(path: &str) -> Option<Path> { path.split('.').filter(|p| !p.is_empty()).map(|p| p.parse().ok()).collect() }

/// The path of a tile's own leaf (not a tab of a set).
fn leaf_path(root: &Node, id: &str) -> Option<Path> {
    fn go(n: &Node, id: &str, path: &mut Path) -> Option<Path> {
        match n { Node::Leaf(s) => (s.id == id).then(|| path.clone()), Node::Tabs { .. } => None, other => other.kids().iter().enumerate().find_map(|(i, k)| { path.push(i); let found = go(k, id, path); path.pop(); found }) }
    }
    go(root, id, &mut Vec::new())
}

/// The shares of the row a kept reader and its new spine sit in: each kid as wide as it was, the reader less a spine.
pub(super) fn spine_weights(root: &mut Node, kept: &str, spine: &str, before: &[(Id, Rect)]) {
    let Some((path, _)) = parent_of(root, Target::Tile(kept)) else { return };
    let Some(parent) = root.at_mut(&path).filter(|p| p.is_line() && !p.is_flow()) else { return };
    let weights: Vec<f64> = parent.kids().iter().map(|k| {
        if matches!(k, Node::Leaf(s) if s.id == spine) { return SPINE }
        let boxes: Vec<Rect> = k.leaves().iter().filter_map(|t| before.iter().find(|(x, _)| x == t).map(|(_, r)| *r)).collect();
        let width = if boxes.is_empty() { 1.0 } else { boxes.iter().map(|r| r.col + r.cols).fold(f64::NEG_INFINITY, f64::max) - boxes.iter().map(|r| r.col).fold(f64::INFINITY, f64::min) };
        (width - if k.has(kept) { SPINE } else { 0.0 }).max(1.0)
    }).collect();
    if let Some((_, w)) = parent.line_mut() { *w = weights }
}

// ── a flow's memory, as its columns come and go (the door's desk/flow.ts) ─────────────────────────────────────

fn trail_at(flow: &Node, i: usize) -> Option<usize> {
    let here = flow.kids().get(i).map(Node::leaves).unwrap_or_default();
    match flow { Node::Flow { memory, .. } => memory.trail.iter().position(|t| here.contains(&t.tile)), _ => None }
}

fn set_from(flow: &mut Node, i: usize, from: Option<Id>) {
    let Some(tile) = tree::tile_of_column(flow, i) else { return };
    let at = trail_at(flow, i);
    let Node::Flow { memory, .. } = flow else { return };
    match (at, from) { (Some(at), from) => memory.trail[at].from = from, (None, Some(from)) => memory.trail.push(tree::Trail { tile, from: Some(from), ahead: None }), (None, None) => {} }
}

fn travel_target(flow: &Node, i: usize, dir: i64) -> Option<usize> {
    let Node::Flow { memory, .. } = flow else { return None };
    let t = trail_at(flow, i).map(|at| &memory.trail[at]);
    let here = flow.kids().get(i).map(Node::leaves).unwrap_or_default();
    let to = if dir < 0 { t.and_then(|t| t.from.clone()) } else { t.and_then(|t| t.ahead.clone()).or_else(|| memory.trail.iter().rev().find(|x| x.from.as_ref().is_some_and(|f| here.contains(f))).map(|x| x.tile.clone())) };
    tree::column_of(flow, to.as_deref())
}

fn set_ahead(flow: &mut Node, to: usize, from: usize) {
    let (Some(tile), Some(back)) = (tree::tile_of_column(flow, to), tree::tile_of_column(flow, from)) else { return };
    let at = trail_at(flow, to);
    let Node::Flow { memory, .. } = flow else { return };
    match at { Some(at) => memory.trail[at].ahead = Some(back), None => memory.trail.push(tree::Trail { tile, from: None, ahead: Some(back) }) }
}

/// A column takes the wide place; the one being read stays open beside it.
fn widen(flow: &mut Node, ci: usize, touched: &[Id]) {
    let (anchor, read_at) = match &*flow { Node::Flow { memory, .. } => (tree::column_of(flow, memory.anchor.as_deref()).unwrap_or(0), tree::column_of(flow, memory.read.as_deref())), _ => return };
    if flow.kids().get(ci).is_none() || ci == anchor { return }
    let read = read_at.filter(|r| *r != ci).unwrap_or(anchor);
    let (keep, wide) = (tree::tile_of_column(flow, read), tree::tile_of_column(flow, ci));
    let Node::Flow { memory, .. } = flow else { return };
    memory.recent = touched.to_vec();
    if read != ci { memory.keep = keep }
    memory.anchor = wide;
    let keep = memory.keep.clone();
    if tree::column_of(flow, keep.as_deref()) == Some(ci) && let Node::Flow { memory, .. } = flow { memory.keep = None }
}

/// The keys arrive in a column: it takes the wide place unless it and where they came from both show whole.
fn arrive(flow: &mut Node, ci: usize, from: Option<usize>, covers: &[(usize, Cover)], touched: &[Id]) {
    let full = |i: usize| covers.iter().any(|(n, c)| *n == i && *c == Cover::Full);
    if full(ci) && from.is_none_or(full) { return }
    let (wide, keep) = (tree::tile_of_column(flow, ci), from.filter(|f| *f != ci).and_then(|f| tree::tile_of_column(flow, f)));
    let Node::Flow { memory, .. } = flow else { return };
    memory.recent = touched.to_vec();
    memory.anchor = wide;
    memory.keep = keep;
}

/// A column is about to go: the wide place and the kept one move to its neighbours.
fn leaving(flow: &mut Node, ci: usize, covers: &[(usize, Cover)]) {
    if tree::tile_of_column(flow, ci).is_none() || flow.kids().len() < 2 { return }
    let n = flow.kids().len();
    let (anchor, keep) = match &*flow { Node::Flow { memory, .. } => (tree::column_of(flow, memory.anchor.as_deref()).unwrap_or(0), tree::column_of(flow, memory.keep.as_deref())), _ => return };
    let was_full = covers.iter().any(|(i, c)| *i == ci && *c == Cover::Full);
    let new_anchor = if ci == anchor { if ci > 0 { ci - 1 } else { ci + 1 } } else { anchor };
    let (anchor_tile, kept) = (tree::tile_of_column(flow, new_anchor), keep.is_some_and(|k| k != ci && k != new_anchor));
    let next = [ci as i64 + 1, ci as i64 - 1].into_iter().find(|j| *j >= 0 && (*j as usize) < n && *j as usize != new_anchor && *j as usize != ci).and_then(|j| tree::tile_of_column(flow, j as usize));
    let Node::Flow { memory, .. } = flow else { return };
    if ci == anchor { memory.anchor = anchor_tile }
    if (was_full || keep == Some(ci)) && !kept { memory.keep = next }
    let keep = memory.keep.clone();
    if tree::column_of(flow, keep.as_deref()) == Some(ci) && let Node::Flow { memory, .. } = flow { memory.keep = None }
}
