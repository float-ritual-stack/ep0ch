//! The arrangement's own actions, and the one way it changes: `reshape` hands an operation to `layout::apply`
//! with who acts and where the person is, keeps what it answers, and writes the arrangement to its file. Every
//! action that moves, splits, closes or resizes a tile ends here; none changes the layout itself.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome};
use crate::actline::Args;
use crate::layout::tree::{self, Node};
use crate::layout::{self, Ctx, Dir, Kinds, Layout, Op, Refusal};
use crate::tiles;

static DOCK: ActionRow = ActionRow::new("dock.toggle", Touches::Screen, "slide a dock open or shut: the first dock on that edge of the screen (the default screen keeps what the service knows about the open note in one on the right)")
    .args(&[("side", ArgSpec::text("the edge the dock is on").choices(&["left", "right", "up", "down"]))])
    .keys(&[
        KeyRow::with("mod+shift+b", None, "show or hide the dock on the left", &[("side", Scalar::Text("left"))]),
        KeyRow::with("mod+i", None, "show or hide the dock on the right", &[("side", Scalar::Text("right"))]),
    ])
    .menu(&[
        MenuRow::with("Left dock", "Window", Some("mod+shift+b"), &[("side", Scalar::Text("left"))]),
        MenuRow::with("Details", "Window", Some("mod+i"), &[("side", Scalar::Text("right"))]),
    ])
    .examples(&[Example { act: "dock.toggle side=right", does: "shows or hides the dock on the right", safe: Some(true) }]);

static RESIZE: ActionRow = ActionRow::new("layout.resize", Touches::Shape, "move the border between two tiles of a split: share is the part of the two the first one gets. The split is named by its id (peek gives each one's)")
    .args(&[("split", ArgSpec::text("the split's id, as peek gives it (s2)")), ("border", ArgSpec::number("which border, from 0")), ("share", ArgSpec::number("the first side's part of the two, 0.08 to 0.92"))])
    .keys(&[KeyRow::via("a drag on the border between two tiles")])
    .examples(&[Example { act: "layout.resize border=0 share=0.3 split=s1", does: "gives the first tile of split s1 three tenths of it and its neighbour", safe: Some(true) }]);

static UNDO: ActionRow = ActionRow::new("layout.undo", Touches::Shape, "put the arrangement back as it was before the last change to it (a split, a move, a close, a resize, a screen opened), a step at a time")
    .keys(&[KeyRow::keys("mod+alt+z", "undo the last change to the arrangement")])
    .menu(&[MenuRow::new("Undo arrangement", "Window", Some("mod+alt+z"))]);

pub static ACTIONS: &[Action] = &[Action { row: &DOCK, run: dock }, Action { row: &RESIZE, run: resize }, Action { row: &UNDO, run: undo }];

/// How many arrangements `layout.undo` goes back through.
const JOURNAL: usize = 100;

impl App {
    /// Asks the layout's rules something as `by`: who acts and how they stand, where the person is, what each tile is.
    pub(super) fn asked<T>(&self, by: &Actor, ask: impl FnOnce(&Ctx) -> T) -> T {
        let facts = |id: &str| self.facts(id);
        let person = self.person();
        let mut ctx = match by { Actor::Person => Ctx::person(&facts, self.area), Actor::Agent(id) => Ctx::agent(id, &facts, self.area) };
        ctx.typing_in = person.typing_in.as_deref().and_then(|name| self.layout.named(name));
        ctx.busy = person.busy;
        ctx.kinds = Some(Kinds { all: tiles::KINDS.iter().map(|row| row.kind.to_string()).collect(), notes: tiles::KINDS.iter().filter(|row| row.notes).map(|row| row.kind.to_string()).collect() });
        ask(&ctx)
    }

    /// One operation on the arrangement, as `by`: done and kept, or refused in the layout's words.
    pub(super) fn reshape(&mut self, op: &Op, by: &Actor) -> Outcome {
        match self.asked(by, |ctx| layout::apply(&self.layout, op, ctx)) {
            Ok(done) => { self.arranged(done.layout, done.changed); Outcome::answer(Value::Object(done.answer)) }
            Err(Refusal(why)) => Outcome::refused(why),
        }
    }

    /// The arrangement is `next`: the one before is somewhere to go back to, the state of tiles that are gone is
    /// let go, and the file it is kept in is written.
    pub(super) fn arranged(&mut self, next: Layout, changed: bool) {
        if next == self.st.layout { return }
        // The keys moving is no change to go back through; a border dragged is one change, however many moves it took.
        let shape = |l: &Layout| { let mut l = l.clone(); l.focus = String::new(); l.touched = Vec::new(); l };
        if changed && shape(&next) != shape(&self.st.layout) {
            if self.st.journal.len() >= JOURNAL { self.st.journal.remove(0); }
            self.st.journal.push(self.st.layout.clone());
        }
        self.st.layout = next;
        let here = self.st.layout.all();
        self.st.tiles.retain(|tile, _| here.contains(tile));
        self.keep();
    }

    /// The arrangement and what each tile shows, written to the file they are kept in.
    pub(super) fn keep(&self) {
        let Some(path) = &self.kept_in else { return };
        let tiles: serde_json::Map<String, Value> = self.tiles.iter().filter(|(tile, _)| self.layout.spec(tile).is_some()).map(|(tile, ui)| (self.layout.name(tile), json!({ "note": ui.note, "unfolded": ui.unfolded }))).collect();
        let kept = json!({ "screen": self.screen.name, "title": self.screen.title, "note": self.screen.note().map(|(id, revision)| json!({ "id": id, "revision": revision })), "spec": self.screen.spec, "layout": self.layout.save(), "tiles": tiles });
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
            let shipped = crate::screen::shipped().into_iter().find(|s| s.name == name);
            let from = match kept["note"]["id"].as_str() { Some(id) => crate::screen::From::Note { id: id.to_string(), revision: kept["note"]["revision"].as_u64().unwrap_or(0) }, None => crate::screen::From::Shipped };
            self.st.screen = shipped.unwrap_or_else(|| crate::screen::Screen { name: name.to_string(), title: kept["title"].as_str().unwrap_or(name).to_string(), from, spec: kept.get("spec").filter(|s| s.is_object()).cloned(), problems: Vec::new() });
        }
        self.st.tiles.clear();
        for (name, ui) in kept["tiles"].as_object().into_iter().flatten() {
            let Some(tile) = layout.named(name) else { continue };
            let slot = self.st.tiles.entry(tile).or_default();
            slot.note = ui["note"].as_str().map(str::to_string);
            slot.unfolded = ui["unfolded"].as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect();
        }
        self.st.layout = layout;
    }
}

fn dock(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(side) = args.text("side").and_then(Dir::read) else { return Outcome::refused("a dock is on the left, right, up or down edge") };
    let found = tree::docks(app.layout.tree()).into_iter().filter_map(|path| app.layout.tree().at(&path).cloned()).find(|dock| matches!(dock, Node::Dock { side: s, .. } if *s == side));
    let Some(dock) = found else { return Outcome::refused(format!("this screen has no dock on the {} edge · tile.dock edge={} puts a tile in one", side.word(), side.word())) };
    let Some(tile) = dock.leaves().into_iter().next() else { return Outcome::refused("that dock holds no tile") };
    app.reshape(&Op::Slide { tile, open: None, container: dock.id().map(str::to_string), beside: false }, by)
}

fn resize(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    app.reshape(&Op::Resize { split: args.text("split").map(str::to_string), path: None, border: args.number("border").unwrap_or(0.0), share: args.number("share").unwrap_or(0.5) }, by)
}

fn undo(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    // The layout's own rules say whether another arrangement may take this one's place.
    if let Err(Refusal(why)) = app.asked(by, |ctx| layout::apply(&app.layout, &Op::Load { name: "the arrangement before".into() }, ctx)) { return Outcome::refused(why) }
    let Some(before) = app.st.journal.pop() else { return Outcome::refused("the arrangement is as it started: there is nothing to undo") };
    // The keys stay on a tile that is still there.
    let focus = Some(app.layout.focus.clone()).filter(|tile| before.all().contains(tile)).unwrap_or_else(|| before.focus.clone());
    let mut before = before;
    before.focus = focus;
    app.st.layout = before;
    let here = app.st.layout.all();
    app.st.tiles.retain(|tile, _| here.contains(tile));
    app.keep();
    Outcome::done()
}
