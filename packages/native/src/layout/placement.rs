//! Where an open lands, and why: the door's `placement` (desk/screen-layout.ts) and `landing` (desk/landing.ts),
//! in the door's order: the tile's own wire, the place its policy opens into, its home, a flow's next column,
//! the first reader not pinned. `place` is the one question the `open` action asks.
use serde_json::{Map, Value, json};

use super::step::{put_at, spine_weights};
use super::tree::{self, Axis, Cover, Dir, Id, Layer, Node, Rect, Target, TileSpec, chain_of, effective, flow_holding, node_by_key, parent_of};
use super::{Applied, At, Beside, Ctx, Fold, Layout, MARK_THEM, Op, Refusal, apply, attempt, holds_edit, typing_in};

/// The size a tile opened beside another reads at.
pub const OPEN_READS: (f64, f64) = (28.0, 6.0);

/// An open, as a tile or an action asks for one.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Request {
    /// The tile it comes from.
    pub from: Id,
    /// The note to open.
    pub note: String,
    /// The tile it is to land in, when the asker says.
    pub to: Option<Id>,
    /// A list row's own say: `current`, `beside`, `float`, `full`.
    pub where_: Option<String>,
    pub hover: bool,
    /// The alt open: beside what is shown, never over it.
    pub fresh: bool,
    pub rule: Option<String>,
    pub keep: Option<bool>,
    pub history: bool,
    pub at: Option<At>,
    pub container: Option<String>,
    pub new_note: Option<String>,
    /// An open from outside any tile (a link followed, an agent's `open`): the first reader takes it.
    pub default: bool,
    /// False: the new tile never takes the keys.
    pub keys: Option<bool>,
    pub inspect: bool,
    pub act: bool,
}

impl Request {
    pub fn read(v: &Value) -> Request {
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
        let flag = |k: &str| v.get(k) == Some(&json!(true));
        Request {
            from: text("from").unwrap_or_default(), note: text("note").unwrap_or_default(), to: text("to"), where_: text("where"), hover: text("verb").as_deref() == Some("hover"), fresh: flag("fresh"), rule: text("rule"),
            keep: v.get("keep").and_then(Value::as_bool), history: flag("history"), at: v.get("at").and_then(At::read), container: text("container"), new_note: text("newNote"), default: flag("default"),
            keys: v.get("keys").and_then(Value::as_bool), inspect: flag("inspect"), act: flag("act"),
        }
    }
}

/// Where a tile's rules send an open, before anything is known of the tiles it would land in.
#[derive(Clone, Debug, PartialEq)]
pub enum Route { To { to: Id, full: bool }, Float, Into(String), Next, Beside(Id), Tab(Id), Across { target: String, rule: String } }

impl Route {
    fn json(&self) -> Value {
        match self {
            Route::To { to, full } => if *full { json!({ "to": to, "full": true }) } else { json!({ "to": to }) },
            Route::Float => json!({ "float": true }), Route::Into(key) => json!({ "into": key }), Route::Next => json!({ "next": true }),
            Route::Beside(id) => json!({ "beside": id }), Route::Tab(id) => json!({ "tab": id }), Route::Across { target, rule } => json!({ "across": target, "rule": rule }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Destination {
    /// A tile that is there takes the note.
    Swap { tile: Id, in_place: bool },
    /// A new tile, at a place.
    New { at: At },
    /// Another screen's tile takes it.
    Across { target: String, rule: String, source: bool, screen: bool },
    /// The screen runs an action of its own for it.
    Action { action: String },
    None { reason: String, refused: bool },
}

impl Destination {
    pub fn kind(&self) -> &'static str { match self { Destination::Swap { .. } => "swap", Destination::New { .. } => "new", Destination::Across { .. } => "across", Destination::Action { .. } => "action", Destination::None { .. } => "none" } }
    fn json(&self) -> Value {
        let mut out = Map::new();
        out.insert("kind".into(), json!(self.kind()));
        match self {
            Destination::Swap { tile, in_place } => { out.insert("tile".into(), json!(tile)); if *in_place { out.insert("inPlace".into(), json!(true)); } }
            Destination::New { at } => { out.insert("at".into(), at.json()); }
            Destination::Across { target, rule, source, screen } => { out.insert("target".into(), json!(target)); out.insert("rule".into(), json!(rule)); if *source { out.insert("source".into(), json!(true)); } if *screen { out.insert("screen".into(), json!(true)); } }
            Destination::Action { action } => { out.insert("action".into(), json!(action)); }
            Destination::None { reason, refused } => { out.insert("reason".into(), json!(reason)); if *refused { out.insert("refused".into(), json!(true)); } }
        }
        Value::Object(out)
    }
}

/// The door's whole answer about an open (`NotePlacement`).
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub destination: Destination,
    /// The reader whose old note stays in a new spine, and where the spine goes.
    pub keep: Option<(Id, At)>,
    pub merge: Option<Id>,
    /// A tile that shows the note already takes the open: whether it is brought out.
    pub reuse: Option<bool>,
    pub why: Option<String>,
    pub reveal: bool,
    pub route: Option<Route>,
    /// The tile the keys go to.
    pub keys: Option<Id>,
    pub next_from: Option<Id>,
    pub give_new_keys: bool,
    pub beside_of: Option<Id>,
    pub no_spine: bool,
}

impl Placement {
    pub fn json(&self) -> Value {
        let mut out = Map::new();
        out.insert("destination".into(), self.destination.json());
        if let Some((tile, at)) = &self.keep { out.insert("keep".into(), json!({ "tile": tile, "at": at.json() })); }
        if let Some(merge) = &self.merge { out.insert("merge".into(), json!(merge)); }
        if let Some(reveal) = self.reuse { out.insert("reuse".into(), json!({ "reveal": reveal })); }
        if let Some(why) = &self.why { out.insert("why".into(), json!(why)); }
        out.insert("reveal".into(), json!(self.reveal));
        out.insert("route".into(), self.route.as_ref().map_or(Value::Null, Route::json));
        if let Some(keys) = &self.keys { out.insert("keys".into(), json!(keys)); }
        if let Some(from) = &self.next_from { out.insert("nextFrom".into(), json!(from)); }
        out.insert("giveNewKeys".into(), json!(self.give_new_keys));
        if let Some(of) = &self.beside_of { out.insert("besideOf".into(), json!(of)); }
        if self.no_spine { out.insert("noSpine".into(), json!(true)); }
        Value::Object(out)
    }
}

/// Where a tile's own rules send its opens (`landing`).
fn landing(s: &Layout, id: &str, verb: &str, ctx: &Ctx, preferred: Option<&str>) -> Option<Route> {
    let facts = (ctx.facts)(id);
    let wire = s.wires.iter().find(|w| w.from == id && w.verb == verb && s.names.has(&w.to));
    if verb == "alt" {
        let open = landing(s, id, "open", ctx, None);
        let policy = s.policy_at(id, Some(&facts));
        let rule = wire.and_then(|w| w.rule.clone()).unwrap_or_else(|| if wire.is_some() { "tile".into() } else { policy.alt_opens.clone() });
        let target = wire.map(|w| w.to.clone()).or_else(|| match &open { Some(Route::To { to, .. }) => Some(to.clone()), _ => None }).unwrap_or_else(|| id.to_string());
        if rule == "first-unheld" && let Some(available) = s.tree().leaves().into_iter().find(|t| { let f = (ctx.facts)(t); f.notes && !f.follower && !f.pinned && f.editing.is_none() && !f.holds }) { return Some(Route::To { to: available, full: false }) }
        if wire.is_none() && let Some(Route::Across { target, .. }) = &open { return Some(Route::Across { target: target.clone(), rule }) }
        if rule == "tile" { return Some(Route::To { to: target, full: false }) }
        if rule == "tab" { return Some(Route::Tab(target)) }
        if wire.is_none() && policy.by("altOpens").is_none() && matches!(open, Some(Route::Into(_) | Route::Next)) { return open }
        return Some(Route::Beside(target));
    }
    if let Some(wire) = wire { return Some(Route::To { to: wire.to.clone(), full: false }) }
    if verb == "hover" { return None }
    let e = s.policy_at(id, Some(&facts));
    let into = e.opens_into.as_deref().and_then(|name| s.named(name));
    if let Some(into) = &into && into != id { return Some(Route::To { to: into.clone(), full: false }) }
    if into.is_none() && let Some(key) = &e.opens_into && node_by_key(s.tree(), key).is_some() { return Some(Route::Into(key.clone())) }
    let preferred = preferred.map(str::to_string).or_else(|| match e.opens.as_str() { "float" | "full" => Some(e.opens.clone()), "self" => Some("current".into()), _ => None });
    match preferred.as_deref() { Some("current") => return Some(Route::To { to: id.to_string(), full: false }), Some("full") => return Some(Route::To { to: id.to_string(), full: true }), Some("beside") => return Some(Route::Beside(id.to_string())), Some("float") => return Some(Route::Float), _ => {} }
    let home = facts.home.as_deref().and_then(|h| s.named(h));
    if let Some(home) = home && home != id { return Some(Route::To { to: home, full: false }) }
    if let Some(home) = facts.home.as_ref().filter(|h| h.contains('/')) { return Some(Route::Across { target: home.clone(), rule: "tile".into() }) }
    if e.opens == "beside" { return Some(Route::Beside(id.to_string())) }
    if e.opens == "next" && flow_holding(s.tree(), id).is_some() { return Some(Route::Next) }
    None
}

/// What a close leaves of the note a tile shows (the door's `closeHeir`).
#[derive(Clone, Debug, PartialEq)]
pub(super) enum Heir {
    /// A tile here takes the note.
    To(Id),
    /// A reader across an edge (another screen's), by the wire's path: that screen asks its own reader.
    Across(String),
}

/// What a close leaves of the note tile `id` shows (the door's `closeHeir`, desk/landing.ts): when no other tile here
/// shows it, the reader its opens land in takes it, so the note stays on screen: a tile here, or one across an edge
/// (by the wire's path, as an open finds it). Asked while its wires are there; the action shows the note there.
pub(super) fn close_heir(s: &Layout, id: &str, ctx: &Ctx) -> Option<Heir> {
    let f = (ctx.facts)(id);
    let note = f.showing.as_ref().filter(|_| f.notes)?;
    let all = s.all();
    if all.iter().any(|x| x != id && (ctx.facts)(x).showing.as_ref() == Some(note)) { return None }
    if let Some(across) = s.across.iter().find(|w| w.from == id && w.verb == "open") { return Some(Heir::Across(across.to.clone())) }
    match landing(s, id, "open", ctx, None) {
        Some(Route::To { to, .. }) if to != id && all.contains(&to) && heir_takes(s, &to, ctx) => Some(Heir::To(to)),
        _ => None,
    }
}

/// Whether reader `to` takes a closed reader's note (the door's `heirTakes`): it takes notes and shows none, isn't
/// pinned, holds no edit or work and follows no list; and, for an agent's close, it isn't where the person's keys
/// are (their remembered focus in a layout they're not in is no one's).
pub(super) fn heir_takes(s: &Layout, to: &str, ctx: &Ctx) -> bool {
    let g = (ctx.facts)(to);
    let theirs = !ctx.standing && ctx.here != Some(false) && s.focus == to;
    !theirs && g.notes && g.showing.is_none() && !g.pinned && g.editing.is_none() && !g.holds && !g.follower && g.available != Some(false)
}

/// How much of itself each column of the flow at `path` shows.
pub(super) fn covers_of(s: &Layout, path: &[usize], area: Rect, holds: &dyn Fn(&str) -> bool) -> Vec<(usize, Cover)> {
    let (base, slid) = s.placed(area, holds);
    if let Some(at) = base.flows.iter().chain(slid.iter().flat_map(|d| d.placed.flows.iter())).find(|f| f.path == path) { return at.cols.iter().map(|(i, cover, _)| (*i, *cover)).collect() }
    let Some(flow) = s.tree().at(path) else { return Vec::new() };
    let folded = |id: &str| s.collapsed.has(id);
    tree::squeeze(flow, area.cols, holds, &s.policy_of_node(path), Some(&folded), 0.0).into_iter().map(|c| (c.i, c.cover)).collect()
}

/// A reader a tile opened beside itself before, when it can take another open.
fn beside_reader(s: &Layout, ctx: &Ctx, id: &str) -> Option<Id> {
    let at = ctx.beside.iter().find(|(from, _)| from == id).map(|(_, to)| to.clone()).filter(|at| s.names.has(at))?;
    let f = (ctx.facts)(&at);
    (f.notes && !f.pinned && f.editing.is_none() && !f.holds && f.available != Some(false)).then_some(at)
}

fn takes_open(s: &Layout, ctx: &Ctx, id: &str) -> bool {
    let f = (ctx.facts)(id);
    !s.collapsed.has(id) && f.notes && !f.follower && !f.lists && !f.pinned && f.editing.is_none() && !f.holds && f.available != Some(false)
}

/// Whether a spine for a reader's old note leaves every tile that read still reading.
fn spine_fits(s: &Layout, keep: &(Id, At), area: Rect) -> bool {
    let reads = |r: Option<Rect>| r.is_some_and(|r| r.cols >= OPEN_READS.0 && r.rows >= OPEN_READS.1);
    let before = s.unzoomed().rects(area, &|_| false);
    const SPINE_ID: &str = "\u{0}spine";
    let mut with = s.unzoomed();
    let kind = s.spec(&keep.0).map_or("tile", |spec| spec.kind.as_str());
    *with.tree_mut() = put_at(s.tree().clone(), TileSpec::new(SPINE_ID, kind), &keep.1);
    spine_weights(with.tree_mut(), &keep.0, SPINE_ID, &before);
    with.collapsed.set(SPINE_ID, Fold::default());
    let after = with.rects(area, &|_| false);
    before.iter().all(|(id, r)| {
        let now = after.iter().find(|(x, _)| x == id).map(|(_, r)| *r);
        s.collapsed.has(id) || if reads(Some(*r)) { reads(now) } else { now.is_none_or(|now| flow_holding(s.tree(), id).is_some() || (now.cols >= r.cols && now.rows >= r.rows)) }
    })
}

fn hand_out(screen: &Option<String>) -> Destination {
    match screen { None => Destination::None { reason: "this screen has no tiles to open it in · q goes back to one".into(), refused: true }, Some(screen) => Destination::Across { target: screen.clone(), rule: "tile".into(), source: true, screen: true } }
}

/// Where an open lands, as the door decides it.
pub fn placement(s: &Layout, request: &Request, ctx: &Ctx) -> Placement {
    // An open from outside any tile lands where the screen says its opens land: the tile `lands` names, else the
    // container keyed so (the door's `Desk.landingRequest`). One that says a tile or a container itself is past this.
    if request.default && request.to.is_none() && request.container.is_none() && request.at.is_none() && request.new_note.is_none() && let Some(lands) = &ctx.lands {
        return match s.lands(lands) {
            Some(super::Lands::Tile(tile)) => placement(s, &Request { to: Some(tile), ..request.clone() }, ctx),
            // (A key the layout no longer has is said as the container gone, where an open into it is refused.)
            Some(super::Lands::Container(_)) | None => placement(s, &Request { container: Some(lands.clone()), default: false, ..request.clone() }, ctx),
        };
    }
    let (from, to, fresh, note) = (&request.from, &request.to, request.fresh, &request.note);
    let facts = |id: &str| (ctx.facts)(id);
    let verb = if request.hover { "hover" } else if fresh { "alt" } else { "open" };
    let wire = s.across.iter().find(|w| w.from == *from && w.verb == verb);
    let open_wire = if fresh && !s.wires.iter().any(|w| w.from == *from && w.verb == "alt") { s.across.iter().find(|w| w.from == *from && w.verb == "open") } else { None };
    let mut route: Option<Route> = match (to, wire, open_wire) {
        (Some(to), ..) => Some(Route::To { to: to.clone(), full: false }),
        (None, Some(wire), _) => Some(Route::Across { target: wire.to.clone(), rule: wire.rule.clone().unwrap_or_else(|| "tile".into()) }),
        (None, None, Some(wire)) => Some(Route::Across { target: wire.to.clone(), rule: "beside".into() }),
        _ => landing(s, from, verb, ctx, if fresh { None } else { request.where_.as_deref() }),
    };
    if let (Some(to), Some(rule)) = (to, request.rule.as_deref().filter(|r| *r != "tile")) {
        let available = if rule == "first-unheld" { s.tree().leaves().into_iter().find(|id| { let f = facts(id); f.notes && !f.pinned && f.editing.is_none() && !f.holds && !f.follower }) } else { None };
        route = Some(match available { Some(to) => Route::To { to, full: false }, None if rule == "tab" => Route::Tab(to.clone()), None => Route::Beside(to.clone()) });
    }
    if let Some(container) = &request.container { route = Some(Route::Into(container.clone())) } else if request.history { route = None }
    let mut inward = false;
    let self_ = to.is_none() && matches!(&route, Some(Route::To { to, .. }) if to == from);
    let in_place = self_ && !request.default;
    if request.default && to.is_none() && (route.is_none() || self_ || facts(from).notes) {
        let readers: Vec<Id> = s.tree().leaves().into_iter().filter(|id| { let f = facts(id); !s.collapsed.has(id) && f.notes && !f.follower && f.editing.is_none() && !f.holds && !f.pinned && f.available != Some(false) }).collect();
        match readers.first() { Some(target) => route = Some(Route::To { to: target.clone(), full: false }), None => if self_ && !facts(from).notes { route = None } }
        let _ = &mut inward;
    }
    let keys = ctx.keys;
    let from_tile = to.is_none() && !request.act && !request.default && request.container.is_none() && request.at.is_none() && request.new_note.is_none() && !request.history && verb != "hover";
    let base = |route: &Option<Route>| Placement { destination: Destination::None { reason: "no reader takes this open".into(), refused: false }, keep: None, merge: None, reuse: None, why: None, reveal: false, route: route.clone(), keys: None, next_from: None, give_new_keys: false, beside_of: None, no_spine: false };
    if from_tile && fresh && let Some(action) = &ctx.fresh_action { return Placement { destination: Destination::Action { action: action.clone() }, ..base(&route) } }
    let routed = if fresh { wire.is_some() || open_wire.is_some() || s.wires.iter().any(|w| w.from == *from && (w.verb == "alt" || w.verb == "open")) || landing(s, from, "open", ctx, None).is_some() } else { route.is_some() };
    if from_tile && !routed && let Some(screen) = &ctx.screen && facts(from).opens_out { return Placement { destination: hand_out(screen), ..base(&route) } }
    let mut result = Placement {
        reveal: ctx.standing && verb != "hover",
        give_new_keys: keys && request.keys != Some(false) && !ctx.busy && (to.is_some() || !facts(from).lists || matches!(route, Some(Route::Into(_) | Route::Next))),
        ..base(&route)
    };
    if verb == "hover" && route.is_none() { return result }
    if matches!(route, Some(Route::Float)) {
        let followers: Vec<Id> = s.floats.iter().filter(|f| f.peek_of.as_ref() == Some(from)).map(|f| f.spec.id.clone()).chain(s.select_targets(from).into_iter().filter(|id| !s.is_float(id))).collect();
        let peek = if ctx.standing { followers.into_iter().find(|id| { let f = facts(id); f.editing.is_none() && !f.holds && !f.pinned }) } else { None };
        result.give_new_keys = keys && request.keys != Some(false);
        match peek { None => result.destination = Destination::New { at: At::Float { rect: None, near: Some(from.clone()) } }, Some(peek) => { if result.give_new_keys { result.keys = Some(peek.clone()) } result.destination = Destination::Swap { tile: peek, in_place: false } } }
        return result;
    }
    if let Some(new_note) = &request.new_note {
        let f = facts(from);
        let policy = s.policy_at(from, Some(&f));
        let tab = new_note == "tab" && !s.is_float(from) && s.tree().visible().contains(from) && (!policy.locked || ctx.yolo) && policy.droppable && policy.accepts.as_ref().is_none_or(|a| ctx.sprouts_into(a)) && f.tabs.as_ref().is_none_or(|t| ctx.sprouts_into(t));
        result.destination = Destination::New { at: if tab { At::Tabs { target: from.clone(), index: None, behind: false } } else { At::Float { rect: None, near: None } } };
        result.give_new_keys = keys;
        if new_note == "tab" && !tab { result.why = Some("not a tab here: it floats instead".into()) }
        return result;
    }
    let deliberate_target = in_place || s.wires.iter().any(|w| w.from == *from && w.verb == verb) || matches!(&route, Some(Route::To { to, .. }) if facts(to).deliberate || facts(to).pinned);
    if to.is_none() && request.at.is_none() && !deliberate_target && !matches!(route, Some(Route::Across { .. })) {
        let source = facts(from);
        let existing = s.all().into_iter().find(|id| { let f = facts(id); id != from && f.notes && !f.lists && !f.follower && f.showing.as_ref() == Some(note) && (!request.history || (f.history && !f.pinned)) });
        let removable = s.policy_at(from, Some(&source));
        let flow = flow_holding(s.tree(), from);
        let flow_node = flow.as_ref().and_then(|(path, _)| s.tree().at(path));
        let held = flow.as_ref().zip(flow_node).is_some_and(|((_, ci), node)| matches!(node, Node::Flow { memory, .. } if memory.held.iter().any(|id| tree::column_of(node, Some(id)) == Some(*ci))));
        if let Some(existing) = existing && (!request.history || (!source.deliberate && !source.follower && !held && !source.pinned && !source.clears_on_close && removable.closable && (!removable.locked || ctx.yolo) && !s.wires.iter().any(|w| w.from == *from || w.to == *from))) {
            result.reuse = Some(!ctx.protect_typing || ctx.typing_in.is_none());
            if matches!(route, Some(Route::Next)) && flow_node.is_some_and(|f| f.has(&existing)) { result.next_from = Some(from.clone()) }
            if let Some(Route::Into(key)) = &route && let Some(container) = node_by_key(s.tree(), key).and_then(|p| s.tree().at(&p)) && container.is_flow() && container.has(&existing) { result.next_from = if container.has(from) { Some(from.clone()) } else { container.leaves().pop() } }
            if keys && request.keys != Some(false) && !ctx.busy { result.keys = Some(existing.clone()) }
            if request.history { result.merge = Some(from.clone()) }
            result.destination = Destination::Swap { tile: existing, in_place: false };
            return result;
        }
    }
    if request.history { return result }
    if let Some(container) = &request.container && node_by_key(s.tree(), container).is_none() {
        let why = format!("the {container} row is gone (its tiles were moved out of it): opening a detail needs it · the screen comes back whole when it's opened again");
        let target = if ctx.standing { s.tree().visible().into_iter().find(|id| { let f = facts(id); f.notes && f.editing.is_none() && !f.holds && f.available != Some(false) }) } else { None };
        let Some(target) = target else { return Placement { destination: Destination::None { reason: why, refused: false }, ..result } };
        return Placement { why: Some(why), ..placement(s, &Request { container: None, at: None, to: Some(target), ..request.clone() }, ctx) };
    }
    if let Some(at) = &request.at { result.destination = Destination::New { at: at.clone() }; result.give_new_keys = keys && request.keys != Some(false); return result }
    let again_with = |more: Request, route: &Option<Route>| Placement { route: route.clone(), ..placement(s, &more, ctx) };
    let quiet = |result: &Placement| if result.give_new_keys { request.keys } else { Some(false) };
    match &route {
        Some(Route::Across { target, rule }) => result.destination = Destination::Across { target: target.clone(), rule: rule.clone(), source: inward, screen: false },
        Some(Route::Into(key)) => {
            let Some(container) = node_by_key(s.tree(), key).and_then(|p| s.tree().at(&p)) else { result.destination = Destination::None { reason: format!("no container {key} takes this open"), refused: false }; return result };
            let ids = container.leaves();
            if container.is_flow() {
                if let Some(source) = if ids.contains(from) { Some(from.clone()) } else { ids.last().cloned() } {
                    let existing = if !fresh { ids.iter().find(|id| **id != source && { let f = facts(id); f.showing.as_ref() == Some(note) && f.editing.is_none() && !f.lists }).cloned() } else { None };
                    if let Some(existing) = &existing && result.give_new_keys { result.keys = Some(existing.clone()) }
                    result.destination = match existing { Some(tile) => Destination::Swap { tile, in_place: false }, None => Destination::New { at: At::Next { from: source.clone() } } };
                    result.next_from = Some(source);
                }
                return result;
            }
            let opened = ctx.opened.iter().find(|(k, ..)| k == key);
            let f = facts(from);
            let target = if f.notes && !f.follower && (ids.contains(from) || opened.is_some_and(|(_, ids, _)| ids.contains(from))) { Some(from.clone()) } else if let Some(active) = opened.and_then(|(.., active)| active.clone()).filter(|a| ids.contains(a)) { Some(active) } else { ids.iter().find(|id| { let f = facts(id); f.notes && !f.follower }).cloned() };
            if let Some(target) = target && { let f = facts(&target); f.editing.is_none() && !f.holds && f.available != Some(false) } {
                return again_with(Request { keys: quiet(&result), container: None, default: false, to: Some(target), keep: Some(fresh), ..request.clone() }, &route);
            }
            result.destination = Destination::New { at: At::In { key: key.clone(), node: None, index: None, weight: None } };
        }
        Some(Route::Next) => {
            let flow = flow_holding(s.tree(), from).and_then(|(path, _)| s.tree().at(&path));
            result.next_from = Some(from.clone());
            let existing = if !fresh { flow.and_then(|flow| flow.leaves().into_iter().find(|id| id != from && { let f = facts(id); f.showing.as_ref() == Some(note) && f.editing.is_none() && !f.lists })) } else { None };
            if let Some(existing) = &existing && keys && request.keys != Some(false) && !ctx.busy { result.keys = Some(existing.clone()) }
            result.destination = match existing { Some(tile) => Destination::Swap { tile, in_place: false }, None => Destination::New { at: At::Next { from: from.clone() } } };
        }
        Some(Route::Tab(tab)) => result.destination = Destination::New { at: At::Tabs { target: tab.clone(), index: None, behind: false } },
        Some(Route::Beside(beside)) => {
            let f = facts(beside);
            if fresh && f.notes && !f.pinned && f.editing.is_none() && !f.holds { return again_with(Request { keys: quiet(&result), default: false, rule: None, to: Some(beside.clone()), keep: Some(true), ..request.clone() }, &route) }
            if !fresh && let Some(again) = beside_reader(s, ctx, beside) { return again_with(Request { keys: Some(false), default: false, rule: None, to: Some(again), keep: Some(false), ..request.clone() }, &route) }
            result.destination = Destination::New { at: At::Split { target: beside.clone(), dir: Dir::Right, pair: false, weight: None } };
            result.beside_of = Some(beside.clone());
            if !fresh { result.give_new_keys = false }
        }
        _ => {
            let routed_to = match &route { Some(Route::To { to, .. }) => Some(to.clone()), _ => None };
            let readers: Vec<Id> = if routed_to.is_some() { Vec::new() } else { s.tree().leaves().into_iter().filter(|id| { let f = facts(id); f.notes && !f.follower && !f.lists && !s.collapsed.has(id) && f.available != Some(false) }).collect() };
            let target = routed_to.or_else(|| facts(from).notes.then(|| from.clone())).or_else(|| readers.iter().find(|id| !facts(id).pinned).cloned()).or_else(|| readers.first().cloned());
            let Some(target) = target else {
                if let Some(outward) = &ctx.outward { result.destination = Destination::Across { target: outward.clone(), rule: "tile".into(), source: true, screen: false } }
                else if let Some(screen) = &ctx.screen { result.destination = hand_out(screen) }
                else if verb != "hover" && !request.history { result.destination = Destination::New { at: At::Edge { dir: Dir::Right } }; result.why = Some("no reader here: a new one opened for it".into()) }
                return result;
            };
            let f = facts(&target);
            if f.pinned && !request.history && !in_place {
                let name = s.name(&target);
                if let Some(again) = beside_reader(s, ctx, &target) { return again_with(Request { keys: quiet(&result), default: false, to: Some(again), keep: Some(false), ..request.clone() }, &route) }
                let idle: Vec<Id> = s.tree().visible().into_iter().filter(|id| *id != target && takes_open(s, ctx, id) && facts(id).held).collect();
                if let Some(free) = idle.iter().find(|id| facts(id).showing.is_none()).or(idle.first()).cloned() {
                    let why = format!("{name} is pinned: opened in {} · p in {name} unpins it", s.name(&free));
                    return Placement { beside_of: Some(target), why: Some(why), ..again_with(Request { keys: quiet(&result), default: false, to: Some(free), keep: Some(false), ..request.clone() }, &route) };
                }
                result.destination = Destination::New { at: if s.is_float(&target) { At::Float { rect: None, near: Some(target.clone()) } } else { At::Split { target: target.clone(), dir: Dir::Right, pair: false, weight: None } } };
                result.beside_of = Some(target);
                result.why = Some(format!("{name} is pinned: opened beside it · p in {name} unpins it"));
                return result;
            }
            if to.is_none() && !fresh && f.follower { result.give_new_keys = false }
            if f.editing.is_some() || f.holds {
                if to.is_some() && !request.default && !ctx.standing { result.destination = Destination::None { reason: holds_edit(&s.name(&target)), refused: false }; return result }
                let beside = if fresh { None } else { ctx.beside.iter().find(|(from, _)| *from == target).map(|(_, to)| to.clone()) };
                if let Some(beside) = beside && s.names.has(&beside) && { let b = facts(&beside); b.editing.is_none() && !b.holds && b.available != Some(false) } { return again_with(Request { keys: quiet(&result), default: false, to: Some(beside), ..request.clone() }, &route) }
                if ctx.protect_typing && ctx.typing_in.as_ref() == Some(&target) {
                    let shown: Vec<Id> = s.tree().visible().into_iter().filter(|id| *id != target && !s.collapsed.has(id) && facts(id).available != Some(false)).collect();
                    if let Some(reader) = shown.iter().find(|id| { let f = facts(id); f.notes && !f.follower && !f.lists && f.editing.is_none() && !f.holds && !f.pinned && !f.deliberate }) { return again_with(Request { keys: Some(false), default: false, to: Some(reader.clone()), ..request.clone() }, &route) }
                    let Some(other) = shown.iter().find(|id| { let f = facts(id); f.editing.is_none() && !f.holds }) else {
                        result.destination = Destination::None { reason: typing_in(&s.name(&target), "open beside it", Some(&format!("make room with tile.open to=<another tile>, or {MARK_THEM}"))), refused: false };
                        return result;
                    };
                    result.destination = Destination::New { at: At::Split { target: other.clone(), dir: Dir::Right, pair: false, weight: None } };
                    result.give_new_keys = false;
                    return result;
                }
                result.destination = Destination::New { at: At::Split { target, dir: Dir::Right, pair: false, weight: None } };
            } else {
                result.destination = Destination::Swap { tile: target.clone(), in_place };
                if result.give_new_keys { result.keys = Some(target.clone()) }
                let chain = chain_of(s.tree(), &target);
                let mut layers = vec![Layer { by: "screen".into(), policy: Some(&s.policy), flow: false }];
                layers.extend(chain.iter().filter_map(|p| s.tree().at(p)).map(|c| Layer { by: c.id_or_t(), policy: c.policy(), flow: false }));
                let space = effective(&layers);
                let keeps = request.keep != Some(false) && !in_place && !s.wires.iter().any(|w| w.from == *from && w.verb == verb && w.to == target) && (!space.locked || ctx.yolo) && space.droppable && space.accepts.as_ref().is_none_or(|a| ctx.sprouts_into(a))
                    && ((f.held && !request.default) || request.keep == Some(true)) && !s.collapsed.has(&target) && f.showing.as_ref().is_some_and(|showing| showing != note)
                    && !s.all().iter().any(|id| *id != target && { let o = facts(id); o.notes && !o.follower && !o.lists && o.showing == f.showing })
                    && s.tree().has(&target) && !chain.iter().filter_map(|p| s.tree().at(p)).any(|c| c.is_tabs() || c.is_dock());
                if keeps { keep_spine(s, request, ctx, &target, &space.spines, &mut result) }
            }
        }
    }
    result
}

/// The spine a reader's old note stays in: which side of the row it gathers on, and whether there is room.
fn keep_spine(s: &Layout, request: &Request, ctx: &Ctx, target: &str, spines: &str, result: &mut Placement) {
    let from = &request.from;
    let order = s.tree().leaves();
    let at = |id: &str| order.iter().position(|x| x == id);
    let before = if from == target { at(target).is_some_and(|i| i > 0) } else { at(from).map_or(-1, |i| i as i64) < at(target).map_or(-1, |i| i as i64) };
    let row_path = parent_of(s.tree(), Target::Tile(target)).map(|(p, _)| p);
    let row = row_path.as_ref().and_then(|p| s.tree().at(p));
    let holds = |id: &str| (ctx.facts)(id).holds;
    let folded: Vec<Id> = match (row, &row_path) {
        (Some(row), Some(path)) if row.is_flow() => { let covers = covers_of(s, path, ctx.area, &holds); row.kids().iter().enumerate().filter(|(i, _)| covers.iter().find(|(n, _)| n == i).is_none_or(|(_, c)| *c == Cover::Spine)).flat_map(|(_, k)| k.leaves()).collect() }
        _ => s.collapsed.keys(),
    };
    let collapsed = |t: &str| folded.iter().any(|x| x == t);
    let is_flow = row.is_some_and(Node::is_flow);
    let mut edge = row.filter(|r| r.dir() == Some(Axis::Row)).and_then(|row| tree::spine_edge(row, &collapsed, target, spines, before, false));
    if edge.is_some() && !is_flow && spines == "book" { edge = edge.map(|(_, left)| (target.to_string(), left)) }
    let kid_of = |id: &str| row.and_then(|r| r.kids().iter().position(|k| k.has(id)));
    if let (Some((t, left)), Some(row), Some(typing)) = (&edge, row, ctx.typing_in.as_ref().filter(|_| ctx.protect_typing).and_then(|t| kid_of(t))) && kid_of(t).map_or(0, |i| i + usize::from(!*left)) <= typing { edge = tree::spine_edge(row, &collapsed, target, "end", before, false) }
    let keyed = row.is_some_and(|r| matches!(r, Node::Split { key: Some(_), .. }));
    if let Some((t, left)) = &edge && !keyed && !row.and_then(|r| r.kids().iter().find(|k| k.has(t))).is_some_and(Node::is_leaf) { edge = Some((target.to_string(), *left)) }
    let place = match (row, &edge) {
        (Some(Node::Split { key: Some(key), meta, .. }), Some((t, left))) => At::In { key: key.clone(), node: meta.id.clone(), index: Some(kid_of(t).map_or(0, |i| i + usize::from(!*left))), weight: None },
        _ => At::Split { target: edge.as_ref().map_or_else(|| target.to_string(), |(t, _)| t.clone()), dir: match &edge { Some((_, left)) => if *left { Dir::Left } else { Dir::Right }, None => if before { Dir::Left } else { Dir::Right } }, pair: false, weight: None },
    };
    let keep = (target.to_string(), place);
    if request.inspect || spine_fits(s, &keep, ctx.area) { result.keep = Some(keep) } else { result.no_spine = true }
}

/// Where an open lands, said for the person: the tile the note is read in, and why there.
#[derive(Clone, Debug, PartialEq)]
pub struct Landing {
    /// The tile the note is read in, by name: the one that takes it, or the new one made for it. None: it lands
    /// in no tile here (another screen's, an action, nowhere).
    pub tile: Option<String>,
    /// Why there, when it isn't where the open was aimed: "bed is pinned: opened beside it".
    pub why: Option<String>,
    pub kind: &'static str,
    /// A tile was made for it.
    pub new: bool,
    /// The new spine a reader's old note stays in, by name.
    pub keeps: Option<String>,
    pub placement: Placement,
    /// The layout the open leaves, or why the layout refuses it. None: nothing here changes.
    pub after: Option<Result<Applied, Refusal>>,
}

/// Where the open of `request` lands, and the layout it leaves. `sprout` is the tile made when the landing needs
/// a new one. The `open` action is the one caller.
pub fn place(layout: &Layout, request: &Request, sprout: &TileSpec, ctx: &Ctx) -> Landing {
    let plan = placement(layout, request, ctx);
    let after = matches!(plan.destination, Destination::Swap { .. } | Destination::New { .. }).then(|| apply(layout, &Op::OpenNote { request: request.clone(), tile: sprout.clone(), name: None }, ctx));
    let made = after.as_ref().and_then(|r| r.as_ref().ok()).and_then(|done| done.layout.names.get(&sprout.id).cloned());
    let refused = after.as_ref().is_some_and(Result::is_err);
    let tile = if refused { None } else { match &plan.destination { Destination::Swap { tile, .. } => Some(layout.name(tile)), Destination::New { .. } => made.clone(), _ => None } };
    let why = plan.why.clone().or_else(|| match &plan.destination { Destination::None { reason, .. } => Some(reason.clone()), _ => None });
    Landing { new: matches!(plan.destination, Destination::New { .. }) && tile.is_some(), keeps: if matches!(plan.destination, Destination::Swap { .. }) { made } else { None }, kind: plan.destination.kind(), tile, why, placement: plan, after }
}

// ── beside a tile, wherever it reads (the door's desk/landing.ts) ─────────────────────────────────────────────

fn beside_order(b: &Beside, r: Option<Rect>) -> Vec<At> {
    let split = |dir: Dir| At::Split { target: b.target.clone(), dir, pair: b.pair, weight: b.weight };
    let dir = b.dir.unwrap_or(Dir::Right);
    let at = |ws: &[&str]| -> Vec<At> {
        ws.iter().map(|w| match w.strip_prefix("edge-") { Some(dir) => At::Edge { dir: Dir::read(dir).unwrap_or(Dir::Right) }, None => split(Dir::read(w).unwrap_or(Dir::Right)) }).filter(|p| !b.pair || matches!(p, At::Split { .. }))
            .chain(b.tab.then(|| At::Tabs { target: b.target.clone(), index: None, behind: true })).collect()
    };
    let axis = |r: Rect, wide: bool| if r.cols >= r.rows * if wide { 4.0 } else { 2.2 } { Axis::Row } else { Axis::Col };
    match b.prefers.as_str() {
        "there" => vec![split(dir)],
        "beside" => if dir.axis() == Axis::Row { at(&[dir.word(), "down"]) } else { at(&[dir.word()]) },
        "axis" => if r.is_some_and(|r| axis(r, false) == Axis::Col) { at(&["down", "right"]) } else { at(&["right", "down"]) },
        "height" => if r.is_some_and(|r| r.rows < tree::MIN_ROWS * 2.0) { at(&["right", "down"]) } else { at(&["down", "right"]) },
        _ => {
            let min = b.needs.0.unwrap_or(OPEN_READS.0);
            let side = if b.pair { b.dir } else { None };
            let across = match side { Some(Dir::Up) => "up", _ => "down" };
            if r.is_some_and(|r| r.cols < min) { return at(&["edge-down", across, "right"]) }
            if r.is_some_and(|r| (r.cols / 2.0).floor() < min) { return at(&[across, "edge-down", "right"]) }
            if let Some(side) = side { return at(&[side.word(), if side.word() == across { "right" } else { "down" }, "edge-right"]) }
            if r.is_some_and(|r| axis(r, true) == Axis::Row) { at(&["right", "down", "edge-right"]) } else { at(&["down", "right", "edge-right"]) }
        }
    }
}

fn place_words(dir: Dir) -> &'static str { match dir { Dir::Left => "left of", Dir::Right => "right of", Dir::Up => "above", Dir::Down => "below" } }
fn where_word(at: &At) -> String { match at { At::Edge { dir } => format!("edge-{}", dir.word()), At::Split { dir, .. } => dir.word().to_string(), At::Tabs { .. } => "tabs".into(), _ => String::new() } }

/// A tile opened "beside" another: each place in the order its preference says, the first where both read.
pub(super) fn beside_attempt(s: &Layout, op: &Op, b: &Beside, ctx: &Ctx) -> Result<Applied, Refusal> {
    let Op::Open { tile, .. } = op else { return Err(Refusal("a beside open is an open".into())) };
    let needs = (b.needs.0.unwrap_or(OPEN_READS.0), b.needs.1.unwrap_or(OPEN_READS.1));
    let holds = |id: &str| (ctx.facts)(id).holds;
    let name = s.name(&b.target);
    let find = |rects: &[(Id, Rect)], id: &str| rects.iter().find(|(x, _)| x == id).map(|(_, r)| *r);
    let order = beside_order(b, find(&s.rects(ctx.area, &holds), &b.target));
    let was = find(&s.unzoomed().rects(ctx.area, &holds), &b.target);
    let with_at = |at: &At| -> Op { let mut op = op.clone(); if let Op::Open { at: slot, .. } = &mut op { *slot = at.clone() } op };
    let (mut refused, mut first, mut best): (Option<String>, Option<(Applied, At, String)>, Option<(Applied, At, f64)>) = (None, None, None);
    let mut squeezed = false;
    for at in &order {
        if matches!(at, At::Tabs { .. }) && b.tab && !squeezed { continue }
        let mut d = match attempt(s, &with_at(at), ctx) { Ok(d) => d, Err(Refusal(why)) => { refused.get_or_insert(why); continue } };
        let placed = d.layout.unzoomed().rects(ctx.area, &holds);
        let (size, kept) = (find(&placed, &tile.id), find(&placed, &b.target));
        let keeps = (b.keeps.0.unwrap_or(0.0).min(was.map_or(f64::INFINITY, |w| w.cols)), b.keeps.1.unwrap_or(0.0).min(was.map_or(f64::INFINITY, |w| w.rows)));
        let short = kept.is_some_and(|k| k.cols < keeps.0 || k.rows < keeps.1);
        let Some(size) = size.filter(|size| short || size.cols < needs.0 || size.rows < needs.1) else {
            d.answer.insert("where".into(), json!(where_word(at)));
            if let Some((_, _, why)) = &first {
                let went = match at { At::Split { dir: Dir::Down, .. } => "below it".to_string(), At::Edge { dir } => format!("along the screen's {} edge", dir.word()), At::Tabs { .. } => format!("into a tab behind {name}"), At::Split { dir, .. } => format!("{} {name}", place_words(*dir)), _ => String::new() };
                d.answer.insert("why".into(), json!(format!("{why}, so it went {went}")));
            }
            return Ok(d);
        };
        squeezed = squeezed || (short && was.is_some_and(|w| w.cols >= b.keeps.0.unwrap_or(0.0) && w.rows >= b.keeps.1.unwrap_or(0.0)));
        let fit = (size.cols / needs.0).min(size.rows / needs.1);
        if best.as_ref().is_none_or(|(.., was)| fit > *was) { best = Some((d.clone(), at.clone(), fit)) }
        if first.is_none() {
            let why = match kept.filter(|_| short) { Some(kept) => format!("{name} would keep {}×{}, under the {}×{} it reads at", kept.cols, kept.rows, keeps.0, keeps.1), None => format!("beside {name} it is {}×{}, under the {}×{} a tile reads at", size.cols, size.rows, needs.0, needs.1) };
            first = Some((d, at.clone(), why));
        }
    }
    let floats = |why: &str| -> Result<Applied, Refusal> {
        let mut d = attempt(s, &with_at(&At::Float { rect: None, near: None }), ctx)?;
        d.answer.insert("where".into(), json!("float"));
        d.answer.insert("why".into(), json!(format!("{why}, so it floats (layout.move tile=<it> to=<a tile> places it)")));
        Ok(d)
    };
    let typing_there = ctx.protect_typing && ctx.typing_in.as_ref() == Some(&b.target);
    let Some((first_d, first_at, narrow)) = first else {
        let why = refused.unwrap_or_else(|| format!("there's no place beside {name}"));
        if b.prefers != "beside" || typing_there { return Err(Refusal(why)) }
        return floats(&format!("beside {name}: {why}")).map_err(|_| Refusal(why));
    };
    if b.strict { return Err(Refusal(narrow)) }
    let (mut took, took_at) = match best { Some((d, at, _)) => (d, at), None => (first_d, first_at) };
    let place = match &took_at { At::Split { dir, .. } => format!("{} {name}", place_words(*dir)), At::Edge { dir } => format!("along the screen's {} edge", dir.word()), _ => String::new() };
    if b.prefers == "beside" {
        if !typing_there { return floats(&narrow) }
        took.answer.insert("where".into(), json!(where_word(&took_at)));
        took.answer.insert("why".into(), json!(format!("{narrow}, so it went {place}: floating, it would cover the tile being typed in")));
        return Ok(took);
    }
    took.answer.insert("where".into(), json!(where_word(&took_at)));
    took.answer.insert("why".into(), json!(format!("{narrow}, and it went {place}{}", if b.prefers == "there" { ", as asked" } else { "" })));
    Ok(took)
}
