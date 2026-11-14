//! The arrangement's own actions, and the one way it changes: `reshape` hands an operation to `layout::apply`
//! with who acts and where the person is, keeps what it answers, and writes the arrangement to its file. Every
//! action that moves, splits, closes or resizes a tile ends here; none changes the layout itself.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Notice, Outcome, About};
use crate::actline::Args;
use crate::layout::tree::{self, Node};
use crate::layout::{self, Ctx, Dir, Id, Kinds, Layout, Op, Place};
use crate::tiles;
use crate::screen::{From, Screen};

static DOCK: ActionRow = ActionRow::new("dock.toggle", Touches::Screen, "slide a dock open or shut: side= the first dock on that edge of the screen; left out, the dock the tile with the keys is in")
    .args(&[("side", ArgSpec::text("the edge the dock is on (default: the dock the tile with the keys is in)").optional().choices(&["left", "right", "up", "down"]))])
    .keys(&[
        KeyRow::on("escape q", "docked", "shut the dock the keys are in"),
        KeyRow::with("mod+shift+b", None, "show or hide the dock on the left", &[("side", Scalar::Text("left"))]),
        KeyRow::with("mod+i", None, "show or hide the dock on the right", &[("side", Scalar::Text("right"))]),
    ])
    .menu(&[
        MenuRow::with("Left dock", "Window", Some("mod+shift+b"), &[("side", Scalar::Text("left"))]),
        MenuRow::with("Details", "Window", Some("mod+i"), &[("side", Scalar::Text("right"))]),
    ])
    .examples(&[Example { act: "dock.toggle side=right", does: "shows or hides the dock on the right", safe: Some(true) }]);

/// The read that names every container. One namer of a split's id: `layout.resize`'s row points here, and so does
/// the layout's refusal about a split nothing has (its way out is this act, by this row's name).
static GET: ActionRow = ActionRow::new("layout.get", Touches::Nothing, "the arrangement as data: its revision (rev), and the tile tree in the saved form, each split, tab set and dock with its id (s2, g3, d1) and each tile by its name. Nothing changes")
    .keys(&[KeyRow::via("its row in the command bar: it reads the arrangement and changes nothing, so no key is kept for it")])
    .examples(&[Example { act: "layout.get", does: "answers the arrangement: each container's id, each tile's name and kind, and the revision", safe: Some(true) }]);

static RESIZE: ActionRow = ActionRow::new("layout.resize", Touches::Shape, "move the border between two tiles of a split: share is the part of the two the first one gets. The split is named by its id (layout.get gives each one's)")
    .args(&[("split", ArgSpec::text("the split's id, as layout.get gives it (s2)")), ("border", ArgSpec::number("which border, from 0")), ("share", ArgSpec::number("the first side's part of the two, 0.08 to 0.92"))])
    .keys(&[KeyRow::via("a drag on the border between two tiles; Escape while it is held puts the border back where it was")])
    .examples(&[Example { act: "layout.resize border=0 share=0.3 split=s1", does: "gives the first tile of split s1 three tenths of it and its neighbour", safe: Some(true) }]);

static UNDO: ActionRow = ActionRow::new("layout.undo", Touches::Shape, "put the arrangement back as it was before the last change to it (a split, a move, a close, a resize, a screen opened), a step at a time")
    .keys(&[KeyRow::keys("mod+alt+z", "undo the last change to the arrangement")])
    .menu(&[MenuRow::new("Undo arrangement", "Window", Some("mod+alt+z"))]);

static MOVE: ActionRow = ActionRow::new("layout.move", Touches::Shape, "move a tile (tile=, else the one with the keys) beside another (to=<tile> where=left, right, up, down), into its tabs (where=tabs, at index=<n> among them), or along an outer edge of the whole window (where=edge-left, edge-right, edge-up, edge-down: a column the whole height or a row the whole width). A docked tile moved this way is undocked; a tab moved beside its own set leaves it. The person's keys stay where they are")
    .args(&[
        ("to", ArgSpec::text("the tile it goes beside or into, as tile= names one (not needed for an edge)").optional().kind("tile")),
        ("where", ArgSpec::text("left, right, up, down, tabs, or edge-left, edge-right, edge-up, edge-down (default right)").optional().choices(&["left", "right", "up", "down", "tabs", "edge-left", "edge-right", "edge-up", "edge-down"])),
        ("index", ArgSpec::number("with where=tabs: its place among the tabs (0 first)").optional()),
    ])
    .keys(&[KeyRow::via("a tile's title, or its tab, dragged and let go: the places it can land in are drawn while it is held (layout.carry), and the one under the pointer is lit")])
    .examples(&[
        Example { act: "layout.move to=backlinks where=tabs tile=tree", does: "puts the tree in a tab with the backlinks, in their dock", safe: None },
        Example { act: "layout.move where=edge-down tile=tree", does: "lays the tree along the bottom of the window, the whole width", safe: None },
    ]);

static SWAP: ActionRow = ActionRow::new("layout.swap", Touches::Shape, "a tile (tile=, else the one with the keys) and the tile to= names trade places")
    .args(&[("to", ArgSpec::text("the tile it trades places with, as tile= names one").kind("tile"))])
    .keys(&[KeyRow::via("a tile's title dragged onto the lower middle of another tile, where the drag says swap")])
    .examples(&[Example { act: "layout.swap to=reader tile=tree", does: "trades the places of the tree and the reader", safe: None }]);

static LOCK: ActionRow = ActionRow::new("layout.lock", Touches::Shape, "lock this window's arrangement (on=true): its shape is fixed (no moves, drops, new tiles, closes, resizes, docks in or out) and what its tiles show stays live (reading, writing, docks sliding, tabs shown, zoom); on=false unlocks; left out, the other way. Kept with the arrangement, and saved with a screen")
    .args(&[("on", ArgSpec::flag("true locks, false unlocks; left out, the other way").optional())])
    .keys(&[KeyRow::keys("mod+shift+l", "lock or unlock the arrangement"), KeyRow::via("the lock on the toolbar")])
    .menu(&[MenuRow::new("Lock the arrangement", "Window", Some("mod+shift+l"))])
    .examples(&[Example { act: "layout.lock on=true", does: "fixes the window's shape while its tiles stay live", safe: None }, Example { act: "layout.lock on=false", does: "unlocks it, so tiles can be moved and closed again", safe: None }]);

/// The fields of a policy an act sets, by how each is written: a flag, a number of cells (-1 takes it away), a word.
/// The names are the layout's own (`tree::POLICY_KEYS`, the screen spec's), each by the door's name and type for it.
const POLICY_FLAGS: &[&str] = &["draggable", "droppable", "closable", "resizable", "collapsible", "overlay", "stays", "locked"];
const POLICY_CELLS: &[&str] = &["min", "max", "fixed", "readable", "min-width", "gap", "inset"];
const POLICY_WORDS: &[&str] = &["opensInto", "opens", "altOpens", "host", "agents", "spines"];

static POLICY: ActionRow = ActionRow::new("layout.policy", Touches::Shape, "a container's policy, kept with the arrangement: node=<id> (s<n> a split, g<n> a tab set, d<n> a dock, from layout.get) or node=screen; left out, the innermost container holding tile=<tile>, else the screen. Sets draggable (its tiles move out), droppable (it takes tiles), closable, accepts=<kind,kind> (only those kinds; any clears), resizable, min, max and fixed (cells along its parent's axis; -1 clears), collapsible, overlay and stays (a dock), locked, opensInto=<tile>, opens=<rule>, agents=<free, edit, off>; clear=<field,field> takes fields away. With nothing to set, it reads the policy there. On a locked container only locked changes")
    .args(&[
        ("node", ArgSpec::text("the container's id, or screen").optional()),
        ("draggable", ArgSpec::flag("its tiles can be dragged out").optional()), ("droppable", ArgSpec::flag("it takes tiles moved or opened into it").optional()), ("closable", ArgSpec::flag("its tiles close; false: they stay").optional()),
        ("accepts", ArgSpec::text("the tile kinds it takes, comma-separated; any clears").optional()), ("resizable", ArgSpec::flag("its borders move").optional()),
        ("min", ArgSpec::number("its least size in cells (-1 clears)").optional()), ("max", ArgSpec::number("its most size in cells (-1 clears)").optional()), ("fixed", ArgSpec::number("its size in cells, kept (-1 clears)").optional()),
        ("readable", ArgSpec::number("the width in cells a reader opened beside others still gets (-1 clears)").optional()), ("min-width", ArgSpec::number("the least width of an open page (-1 clears)").optional()),
        ("gap", ArgSpec::number("the room between tiles, in cells (node=screen)").optional()), ("inset", ArgSpec::number("the room inside the window's edge, in cells (node=screen)").optional()),
        ("collapsible", ArgSpec::flag("its tiles fold to spines, and a dock slides shut").optional()), ("overlay", ArgSpec::flag("a dock slides over the tiles beside it").optional()), ("stays", ArgSpec::flag("an open dock stays when the keys leave it").optional()),
        ("locked", ArgSpec::flag("its shape is fixed").optional()),
        ("opensInto", ArgSpec::text("the tile, or the keyed container, its tiles' opens land in").optional()), ("opens", ArgSpec::text("the rule its tiles' opens land by").optional()), ("altOpens", ArgSpec::text("the rule an open beside lands by").optional()),
        ("host", ArgSpec::text("where a layer over the screen may appear (node=screen)").optional()), ("agents", ArgSpec::text("what agents may do to its tiles: free, edit or off").optional().choices(&["free", "edit", "off"])), ("spines", ArgSpec::text("where its folded tiles gather").optional()),
        ("clear", ArgSpec::text("fields to take away, comma-separated").optional()),
    ])
    .keys(&[KeyRow::via("its row in the command bar, with the field typed (layout.policy locked=false node=s2)")])
    .examples(&[Example { act: "layout.policy closable=false node=screen", does: "keeps every tile of the window from being closed", safe: None }, Example { act: "layout.policy clear=closable node=screen", does: "takes that away again", safe: None }]);

/// The action a border's drag is a run of.
pub(super) fn resizes(row: &ActionRow) -> bool { std::ptr::eq(row, &RESIZE) }

pub static ACTIONS: &[Action] = &[
    Action { row: &DOCK, run: dock, about: About::Nothing }, Action { row: &GET, run: get, about: About::Nothing }, Action { row: &RESIZE, run: resize, about: About::Nothing }, Action { row: &UNDO, run: undo, about: About::Nothing },
    Action { row: &MOVE, run: move_, about: About::Any }, Action { row: &SWAP, run: swap, about: About::Any }, Action { row: &LOCK, run: lock, about: About::Nothing }, Action { row: &POLICY, run: policy, about: About::Nothing },
];

/// Two arrangements sit alike: the same tiles in the same places, with shares as near as a pointer can say them.
pub(super) fn same_shape(a: &Layout, b: &Layout) -> bool {
    fn near(a: &Value, b: &Value) -> bool {
        match (a, b) {
            (Value::Number(a), Value::Number(b)) => (a.as_f64().unwrap_or(0.0) - b.as_f64().unwrap_or(0.0)).abs() < 1e-4,
            (Value::Array(a), Value::Array(b)) => a.len() == b.len() && a.iter().zip(b).all(|(a, b)| near(a, b)),
            (Value::Object(a), Value::Object(b)) => a.len() == b.len() && a.iter().all(|(k, v)| k == "focus" || b.get(k).is_some_and(|w| near(v, w))),
            _ => a == b,
        }
    }
    near(&a.save(), &b.save())
}

/// How many arrangements `layout.undo` goes back through.
const JOURNAL: usize = 100;

impl App {
    /// Asks the layout's rules something as `by`: who acts and how they stand, where the person is, what each tile is.
    pub(super) fn asked<T>(&self, by: &Actor, ask: impl FnOnce(&Ctx) -> T) -> T {
        let facts = |id: &str| self.facts(id);
        let person = self.person();
        // How they stand is the one answer (`App::stands`): an agent the person's press invited acts as them for the
        // arrangement too (its opens take their keys, their typing is not guarded from their own press), and the
        // layout still knows it is an agent that did it (the door's `layoutStanding`).
        let mut ctx = match by {
            Actor::Person => Ctx::person(&facts, self.area),
            Actor::Agent(id) if self.stands(by) => Ctx { by: layout::By::Agent(id.clone()), ..Ctx::person(&facts, self.area) },
            Actor::Agent(id) => Ctx::agent(id, &facts, self.area),
        };
        ctx.typing_in = person.typing_in.as_deref().and_then(|name| self.layout.named(name));
        ctx.busy = person.busy;
        // A window has one arrangement and the person's keys are on it, or in the bar over it: they are never away
        // from it on another layout (the door's drawer, a mount), so the guards about their tile always hold here.
        ctx.here = Some(true);
        // How this arrangement is named in a refusal: the screen it is of, by its title (several windows each have
        // one). No lock chip is drawn here, and nothing covers a layout: the way out of a lock is said by its act.
        ctx.own = (!self.screen.is_nowhere()).then(|| (format!("the {} screen", self.screen.title), None, None));
        let spec = self.spec_now();
        ctx.lands = spec.as_ref().and_then(|spec| spec.lands()).map(str::to_string);
        // The screen's own action for an open fresh, when its spec names one this window has.
        ctx.fresh_action = spec.as_ref().and_then(|spec| spec.fresh()).filter(|action| super::find(action).is_some()).map(str::to_string);
        // Where the keys go back to when their tile goes: the screen's `home`, a tile by its name or the first tile
        // of the container keyed so (`Layout::lands` reads either word).
        ctx.home = self.home();
        // What placement remembers: the reader each tile opened beside itself, and what was opened into a container.
        ctx.beside = self.memory.beside.clone();
        ctx.opened = self.memory.opened_said();
        // What an agent does here to get the person's attention, where a rule holds it back: this window's own act.
        ctx.attention = Some(super::attention());
        // The kinds there are, by every name the layout's rules may meet one by: the kind a tile carries (the row's
        // own) and the names the service says that kind serves, which a policy and a tile's role are written with.
        let names = |row: &crate::screen::KindRow| std::iter::once(row.kind.clone()).chain(row.serves.iter().cloned()).collect::<Vec<_>>();
        ctx.kinds = Some(Kinds { all: self.kinds().iter().flat_map(names).collect(), notes: self.kinds().iter().filter(|row| tiles::drawer_of(row).is_some_and(|drawer| drawer.notes)).flat_map(names).collect() });
        // The tile an open makes is of the kind that reads notes here, known to the rules as a tile of it is (`App::facts`).
        ctx.sprout = self.note_kind().map(|row| row.role().unwrap_or(row.kind.as_str()).to_string());
        ask(&ctx)
    }

    /// Asks the layout's rules something for what is drawn, where nobody acts: as the person at the window, whose
    /// view a title's words and `peek` are (where their open from a tile would land).
    pub(super) fn asked_shown<T>(&self, ask: impl FnOnce(&Ctx) -> T) -> T { self.asked(&Actor::Person, ask) }

    /// Where the keys go back to when their tile goes, and on the last step back: the screen's `home`, a tile by its
    /// name or the first tile of the container keyed so (`Layout::lands` reads either word). The one reading: the
    /// layout's rules are told it (`asked`), and `keys.home` goes there.
    pub(super) fn home(&self) -> Option<Id> {
        self.spec_now().as_ref().and_then(|spec| spec.home()).and_then(|home| match self.layout.lands(home)? { layout::Lands::Tile(tile) => Some(tile), layout::Lands::Container(key) => self.layout.within(&key).into_iter().next() })
    }

    /// Where Tab stops, in reading order (`cursor::tab_stops`, the rule both doors ask): the tiles shown, each with
    /// the set of columns or the dock it is in, then the floats; the one tile that fills the window while one does.
    /// (Which tile of a set of columns was used last is not kept here: its lanes stop on their first.)
    pub fn tab_stops(&self) -> Vec<Id> {
        if let Some(zoom) = &self.layout.zoom { return vec![zoom.clone()] }
        let root = self.layout.tree();
        let shown: Vec<crate::cursor::Shown> = root.visible().into_iter().map(|id| {
            let held = tree::chain_of(root, &id).into_iter().filter_map(|path| root.at(&path)).find(|node| matches!(node, Node::Columns { .. } | Node::Dock { .. }));
            crate::cursor::Shown { within: held.map(|node| node.id().unwrap_or("").to_string()), columns: held.is_some_and(|node| matches!(node, Node::Columns { .. })), id }
        }).collect();
        crate::cursor::tab_stops(&shown, &self.layout.focus, |_| None, &self.layout.floats.iter().map(|float| float.spec.id.clone()).collect::<Vec<_>>())
    }

    /// One operation on the arrangement, as `by`: done and kept, or refused in the layout's words.
    pub(super) fn reshape(&mut self, op: &Op, by: &Actor) -> Outcome {
        match self.asked(by, |ctx| layout::apply(&self.layout, op, ctx)) {
            Ok(done) => { self.arranged(done.layout, done.changed); Outcome::answer(Value::Object(done.answer)) }
            // Refused: said as this window words it (`actions::says`), and put in front of the person when the act
            // was theirs, so the way out is something they read where they are. (An agent's is on the status line.)
            Err(why) => { let said = super::says(&why, by); if self.stands(by) { self.st.notice = Some(Notice::problem(said.clone())) } Outcome::refused(said) }
        }
    }

    /// Why the layout would refuse an operation as `by`, asked without changing anything (a held tile's zones each
    /// say theirs), in this window's words.
    pub(super) fn refusal(&self, op: &Op, by: &Actor) -> Option<String> { self.asked(by, |ctx| layout::apply(&self.layout, op, ctx)).err().map(|why| super::says(&why, by)) }

    /// Another arrangement takes this one's place (a screen opened, a step undone), as `by`: the layout's own rules
    /// say whether, asked of every tile that would go, and where the keys are after. The arrangement before is
    /// answered, for whoever keeps the way back; why not, in the layout's words.
    pub(super) fn replace(&mut self, with: &str, to: Layout, keys: bool, by: &Actor) -> Result<Layout, String> {
        let op = Op::Load { name: with.to_string(), to: Some(Box::new(to)), keys };
        let done = self.asked(by, |ctx| layout::apply(&self.layout, &op, ctx)).map_err(|why| super::says(&why, by))?;
        let before = std::mem::replace(&mut self.st.layout, done.layout);
        self.settled();
        Ok(before)
    }

    /// The arrangement is `next`: the one before is somewhere to go back to, the state of tiles that are gone is
    /// let go, and the file it is kept in is written.
    pub(super) fn arranged(&mut self, next: Layout, changed: bool) {
        if next == self.st.layout { return }
        // The keys moving is no change to go back through; a border dragged is one change, however many moves it took.
        if changed && next.shape() != self.st.layout.shape() { self.stepped((self.st.layout.clone(), None)) }
        self.st.layout = next;
        self.settled();
        self.keep();
    }

    /// An arrangement to go back to, the newest last.
    pub(super) fn stepped(&mut self, before: (Layout, Option<crate::screen::Screen>)) {
        if self.st.journal.len() >= JOURNAL { self.st.journal.remove(0); }
        self.st.journal.push(before);
    }

    /// What follows from the arrangement having changed: the state of tiles that are gone is let go, a draft with
    /// nothing unsaved ends with its tile (a tile a block is being written in never goes: the layout refuses that),
    /// and a draft's field takes what is typed only while its tile has the keys.
    fn settled(&mut self) {
        let here = self.st.layout.all();
        self.st.tiles.retain(|tile, _| here.contains(tile));
        // A tile that left is named by nothing placement remembers; a tile opened into a container that has the
        // keys is where the next open there lands (the door's desk notes the same as focus moves).
        self.st.memory.keep_only(&here);
        let focus = self.st.layout.focus.clone();
        if !self.st.layout.is_float(&focus) && let Some(key) = self.st.memory.into_of(&focus).map(str::to_string) { self.st.memory.opened_into(&key).active = Some(focus) }
        self.end_gone(&here);
        self.held_gone();
        let focus = self.st.layout.focus.clone();
        for draft in &mut self.st.drafts { draft.buf.give_keys(draft.tile == focus) }
        // The terminal the person stepped out of is one they step into again once their keys have been elsewhere.
        if self.st.out_of.as_ref().is_some_and(|tile| *tile != focus) { self.st.out_of = None }
    }

    /// The whole arrangement leaves the window with its outline (which is parked as it stands: nothing of it goes,
    /// so nothing is asked of the layout's rules), and the window has none until another is put or laid out.
    pub(super) fn arrangement_taken(&mut self) -> Layout { std::mem::take(&mut self.st.layout) }

    /// An arrangement that was parked is the window's again, as it was left; or a window just made has its first.
    pub(super) fn arrangement_put(&mut self, layout: Layout) {
        self.st.layout = layout;
        let focus = self.st.layout.focus.clone();
        for draft in &mut self.st.drafts { draft.buf.give_keys(draft.tile == focus) }
    }

    /// The arrangement as a screen saves it: the layout's own form, with what somebody set on a tile here written
    /// on its leaf in the words a screen is written in (the door's): a reader's `mode: pinned`, a list's `subject`
    /// (`follows`, or held) and the reader it was aimed at (`source: tile:<name>`). So a screen saved here opens
    /// the same way in every door, and here again.
    pub(super) fn saved_layout(&self) -> Value {
        fn stamp(app: &App, node: &mut Value) {
            if node["t"] == "leaf" {
                let Some(tile) = node["name"].as_str().and_then(|name| app.layout.named(name)) else { return };
                let ui = app.ui(&tile);
                if let Some(pinned) = ui.pinned { node["mode"] = json!(if pinned { "pinned" } else { "held" }) }
                if let Some(follows) = ui.follows { if follows { node["subject"] = json!("follows") } else if let Some(fields) = node.as_object_mut() { fields.remove("subject"); } }
                if let Some(home) = ui.home.as_ref().filter(|home| app.layout.spec(home).is_some()) { node["source"] = json!(format!("tile:{}", app.layout.name(home))) }
                return;
            }
            for key in ["kids", "tabs"] { for kid in node.get_mut(key).and_then(Value::as_array_mut).into_iter().flatten() { stamp(app, kid) } }
            for key in ["kid", "a", "b"] { if let Some(kid) = node.get_mut(key).filter(|kid| kid.is_object()) { stamp(app, kid) } }
        }
        let mut saved = self.layout.save();
        if let Some(root) = saved.get_mut("root") { stamp(self, root) }
        for float in saved.get_mut("floats").and_then(Value::as_array_mut).into_iter().flatten() { if let Some(tile) = float.get_mut("tile").filter(|tile| tile.is_object()) { stamp(self, tile) } }
        saved
    }

    /// The arrangement and what each tile shows, written to the file they are kept in.
    pub(super) fn keep(&self) {
        let Some(path) = &self.kept_in else { return };
        // No screen yet is nothing to keep: the file is what a window opens as next time.
        if self.screen.is_nowhere() { return }
        let tiles: serde_json::Map<String, Value> = self.tiles.iter().filter(|(tile, _)| self.layout.spec(tile).is_some()).map(|(tile, ui)| (self.layout.name(tile), json!({ "note": ui.note, "unfolded": ui.unfolded, "narrowed": ui.narrowed, "chosen": ui.chosen, "subject": ui.subject, "program": ui.program,
            // What opens where, as the person left it: a reader's pin and its way back, a list held or following, the reader it was aimed at.
            "history": ui.history, "pinned": ui.pinned, "follows": ui.follows, "home": ui.home.as_ref().filter(|home| self.layout.spec(home).is_some()).map(|home| self.layout.name(home)), "trail": ui.trail, "deliberate": ui.deliberate }))).collect();
        let extension = match &self.screen.from { From::Extension(id) => Some(id.clone()), _ => None };
        // The screen is kept by its name and the revision of the note it was laid out from, never as a copy of its
        // spec: what a screen says of itself is the service's row for it, read when the window opens again.
        let kept = json!({ "screen": self.screen.name, "title": self.screen.title, "note": self.screen.note().map(|(id, revision)| json!({ "id": id, "revision": revision })), "extension": extension, "seen": self.screen_seen.as_ref().map(|(_, mark)| mark), "layout": self.layout.save(), "tiles": tiles,
            // What each program still running was started as: a tile made for one again, this launch or the next, is of its kind.
            "started": self.store.programs_known().iter().map(crate::pty::Made::json).collect::<Vec<_>>() });
        if let Some(dir) = path.parent() { let _ = std::fs::create_dir_all(dir); }
        if let Err(e) = std::fs::write(path, serde_json::to_vec_pretty(&kept).unwrap_or_default()) { eprintln!("ep0ch-native: can't keep the arrangement in {}: {e}", path.display()) }
    }

    /// The arrangement as its file holds it, when the file is there and reads.
    pub(super) fn restore(&mut self) {
        let Some(kept) = self.kept_in.as_ref().and_then(|path| std::fs::read(path).ok()).and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok()) else { return };
        let Some(saved) = kept.get("layout").filter(|l| l.get("root").is_some()) else { return };
        let layout = Layout::read(saved);
        if layout.all().is_empty() { return }
        if let Some(name) = kept["screen"].as_str() {
            // The screen the arrangement is of, by name and where it came from: its spec is the service's to say
            // (`App::spec_now`), once it has listed the screens.
            let from = match kept["note"]["id"].as_str() { Some(id) => From::Note { id: id.to_string(), revision: kept["note"]["revision"].as_u64().unwrap_or(0) }, None => From::Extension(kept["extension"].as_str().unwrap_or_default().to_string()) };
            self.st.screen = Screen { name: name.to_string(), title: kept["title"].as_str().unwrap_or(name).to_string(), from, spec: None, problems: Vec::new() };
            // What the screen was when the arrangement was laid out: a note changed while the window was shut is said when it opens.
            self.st.screen_seen = kept["seen"].as_str().map(|mark| (name.to_string(), mark.to_string()));
        }
        self.st.tiles.clear();
        for (name, ui) in kept["tiles"].as_object().into_iter().flatten() {
            let Some(tile) = layout.named(name) else { continue };
            let slot = self.st.tiles.entry(tile).or_default();
            slot.note = ui["note"].as_str().map(str::to_string);
            slot.unfolded = ui["unfolded"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            slot.narrowed = ui["narrowed"].as_array().into_iter().flatten().filter_map(|pair| Some((pair[0].as_str()?.to_string(), pair[1].as_str()?.to_string()))).collect();
            slot.chosen = ui["chosen"].as_object().into_iter().flatten().filter_map(|(name, value)| Some((name.clone(), value.as_str()?.to_string()))).collect();
            slot.subject = ui["subject"].as_str().map(str::to_string);
            slot.program = ui["program"].as_str().map(str::to_string);
            slot.history = ui["history"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            slot.pinned = ui["pinned"].as_bool();
            slot.follows = ui["follows"].as_bool();
            slot.home = ui["home"].as_str().and_then(|home| layout.named(home));
            slot.trail = ui["trail"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
            slot.deliberate = ui["deliberate"] == true;
        }
        self.st.layout = layout;
        for made in kept["started"].as_array().into_iter().flatten().filter_map(crate::pty::Made::read) { self.store.program_remember(made) }
    }
}

fn dock(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(side) = args.text("side").and_then(Dir::read) else {
        // No edge named: the dock the tile with the keys is in.
        let tile = app.layout.focus.clone();
        let Some(container) = tree::dock_of(app.layout.tree(), &tile).and_then(|path| app.layout.tree().at(&path)).map(|dock| dock.id().map(str::to_string)) else { return Outcome::refused("the tile with the keys is in no dock: name an edge with side= (left, right, up or down)") };
        return app.reshape(&Op::Slide { tile, open: None, container, beside: false }, by);
    };
    let found = tree::docks(app.layout.tree()).into_iter().filter_map(|path| app.layout.tree().at(&path).cloned()).find(|dock| matches!(dock, Node::Dock { side: s, .. } if *s == side));
    let Some(dock) = found else { return Outcome::refused(super::says(&layout::Refusal::new(format!("this screen has no dock on the {} edge", side.word())).way(layout::Way::new("tile.dock", "puts a tile in one").arg("edge", side.word())), by)) };
    let Some(tile) = dock.leaves().into_iter().next() else { return Outcome::refused("that dock holds no tile") };
    app.reshape(&Op::Slide { tile, open: None, container: dock.id().map(str::to_string), beside: false }, by)
}

/// A read: the arrangement as it stands, in the form a screen saves, with the revision an agent may hand back.
fn get(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    Outcome::answer(json!({ "rev": app.layout.rev, "screen": app.screen.name, "layout": app.layout.save() }))
}

fn resize(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (split, border) = (args.text("split").map(str::to_string), args.number("border").unwrap_or(0.0));
    // A border dragged is one change, however many moves it took: the arrangement before the first is the step back.
    let dragging = Some((split.clone().unwrap_or_default(), border as usize));
    let (again, steps) = (app.st.dragging == dragging, app.st.journal.len());
    let outcome = app.reshape(&Op::Resize { split, path: None, border, share: args.number("share").unwrap_or(0.5) }, by);
    if outcome.ok && again && app.st.journal.len() > steps { app.st.journal.pop(); }
    // A drag that came back to where it started (let go with Escape) is no change at all: it leaves no step, and it
    // is over. The next move of that border starts a change of its own, with its own step back.
    let back = outcome.ok && again && app.st.journal.last().is_some_and(|(before, screen)| screen.is_none() && same_shape(before, &app.st.layout));
    if back { app.st.journal.pop(); }
    if outcome.ok { app.st.dragging = if back { None } else { dragging } }
    outcome
}

fn undo(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let Some((before, screen)) = app.st.journal.last().cloned() else { return Outcome::refused("the arrangement is as it started: there is nothing to undo") };
    // The layout's own rules say whether the arrangement before may take this one's place, and where the keys are then.
    if let Err(why) = app.replace("the arrangement before", before, false, by) { return Outcome::refused(why) }
    app.st.journal.pop();
    // A step that opened another screen is taken back whole: the arrangement is the screen's it was of.
    if let Some(screen) = screen { app.st.screen = screen; app.seen() }
    app.keep();
    Outcome::done()
}

/// The tile an act is about: the one the dispatcher found for it (aimed at, else the one with the keys).
fn target(app: &App) -> String { app.about().unwrap_or_else(|| app.layout.focus.clone()) }

fn move_(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = target(app);
    let place = match args.text("where").unwrap_or("right") {
        edge if edge.starts_with("edge-") => match edge.strip_prefix("edge-").and_then(Dir::read) { Some(dir) => Place::Edge { dir }, None => return Outcome::refused("an edge of the window is edge-left, edge-right, edge-up or edge-down") },
        side => {
            let Some(to) = args.text("to") else { return Outcome::refused("layout.move names the tile it goes by (to=), or an edge of the window (where=edge-left, edge-right, edge-up, edge-down)") };
            let target = match app.tile_named(to, by) { Ok(target) => target, Err(why) => return Outcome::refused(why) };
            match Dir::read(side) { Some(dir) => Place::Split { target, dir, pair: false, weight: None }, None => Place::Tabs { target, index: args.number("index").map(|index| index.max(0.0) as usize), behind: false } }
        }
    };
    app.reshape(&Op::Move { tile, to: place }, by)
}

fn swap(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let with = match app.tile_named(args.text("to").unwrap_or(""), by) { Ok(with) => with, Err(why) => return Outcome::refused(why) };
    app.reshape(&Op::Swap { tile: target(app), with }, by)
}

fn lock(app: &mut App, args: &Args, by: &Actor) -> Outcome { app.reshape(&Op::Lock { on: args.flag("on") }, by) }

fn policy(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (mut set, mut clear) = (serde_json::Map::new(), args.text("clear").map(|fields| fields.split(',').map(|field| field.trim().to_string()).filter(|field| !field.is_empty()).collect::<Vec<_>>()).unwrap_or_default());
    for flag in POLICY_FLAGS { if let Some(on) = args.flag(flag) { set.insert((*flag).into(), json!(on)); } }
    // A size of -1 takes the field away, as the door's does.
    for cells in POLICY_CELLS { match args.number(cells) { Some(n) if n < 0.0 => clear.push((*cells).into()), Some(n) => { set.insert((*cells).into(), json!(n)); } None => {} } }
    for word in POLICY_WORDS { if let Some(said) = args.text(word) { set.insert((*word).into(), json!(said)); } }
    match args.text("accepts") { Some("any") => clear.push("accepts".into()), Some(kinds) => { set.insert("accepts".into(), json!(kinds.split(',').map(str::trim).filter(|kind| !kind.is_empty()).collect::<Vec<_>>())); } None => {} }
    app.reshape(&Op::Policy { tile: app.about(), node: args.text("node").map(str::to_string), set, clear }, by)
}
