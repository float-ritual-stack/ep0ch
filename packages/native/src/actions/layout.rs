//! The arrangement's own actions, and the one way it changes: `reshape` hands an operation to `layout::apply`
//! with who acts and where the person is, keeps what it answers, and writes the arrangement to its file. Every
//! action that moves, splits, closes or resizes a tile ends here; none changes the layout itself.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;
use crate::layout::tree::{self, Node};
use crate::layout::{self, Ctx, Dir, Kinds, Layout, Op, Refusal};
use crate::tiles;
use crate::screen::{From, Screen};

static DOCK: ActionRow = ActionRow::new("dock.toggle", Touches::Screen, "slide a dock open or shut: the first dock on that edge of the screen")
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
    .keys(&[KeyRow::via("a drag on the border between two tiles; Escape while it is held puts the border back where it was")])
    .examples(&[Example { act: "layout.resize border=0 share=0.3 split=s1", does: "gives the first tile of split s1 three tenths of it and its neighbour", safe: Some(true) }]);

static UNDO: ActionRow = ActionRow::new("layout.undo", Touches::Shape, "put the arrangement back as it was before the last change to it (a split, a move, a close, a resize, a screen opened), a step at a time")
    .keys(&[KeyRow::keys("mod+alt+z", "undo the last change to the arrangement")])
    .menu(&[MenuRow::new("Undo arrangement", "Window", Some("mod+alt+z"))]);

/// The action a border's drag is a run of.
pub(super) fn resizes(row: &ActionRow) -> bool { std::ptr::eq(row, &RESIZE) }

pub static ACTIONS: &[Action] = &[Action { row: &DOCK, run: dock, about: About::Nothing }, Action { row: &RESIZE, run: resize, about: About::Nothing }, Action { row: &UNDO, run: undo, about: About::Nothing }];

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
        let mut ctx = match by { Actor::Person => Ctx::person(&facts, self.area), Actor::Agent(id) => Ctx::agent(id, &facts, self.area) };
        ctx.typing_in = person.typing_in.as_deref().and_then(|name| self.layout.named(name));
        ctx.busy = person.busy;
        ctx.lands = self.spec_now().and_then(|spec| spec.lands()).map(str::to_string);
        // The kinds there are, by every name the layout's rules may meet one by: the kind a tile carries (the row's
        // own) and the names the service says that kind serves, which a policy and a tile's role are written with.
        let names = |row: &crate::screen::KindRow| std::iter::once(row.kind.clone()).chain(row.serves.iter().cloned()).collect::<Vec<_>>();
        ctx.kinds = Some(Kinds { all: self.kinds().iter().flat_map(names).collect(), notes: self.kinds().iter().filter(|row| tiles::drawer_of(row).is_some_and(|drawer| drawer.notes)).flat_map(names).collect() });
        // The tile an open makes is of the kind that reads notes here, known to the rules as a tile of it is (`App::facts`).
        ctx.sprout = self.note_kind().map(|row| row.role().unwrap_or(row.kind.as_str()).to_string());
        ask(&ctx)
    }

    /// One operation on the arrangement, as `by`: done and kept, or refused in the layout's words.
    pub(super) fn reshape(&mut self, op: &Op, by: &Actor) -> Outcome {
        match self.asked(by, |ctx| layout::apply(&self.layout, op, ctx)) {
            Ok(done) => { self.arranged(done.layout, done.changed); Outcome::answer(Value::Object(done.answer)) }
            Err(Refusal(why)) => Outcome::refused(why),
        }
    }

    /// Another arrangement takes this one's place (a screen opened, a step undone), as `by`: the layout's own rules
    /// say whether, asked of every tile that would go, and where the keys are after. The arrangement before is
    /// answered, for whoever keeps the way back; why not, in the layout's words.
    pub(super) fn replace(&mut self, with: &str, to: Layout, keys: bool, by: &Actor) -> Result<Layout, String> {
        let op = Op::Load { name: with.to_string(), to: Some(Box::new(to)), keys };
        let done = self.asked(by, |ctx| layout::apply(&self.layout, &op, ctx)).map_err(|Refusal(why)| why)?;
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

    /// What follows from the arrangement having changed: the state of tiles that are gone is let go, and a draft
    /// with nothing unsaved ends with its tile (one that holds unsaved text never goes: the layout refuses that).
    fn settled(&mut self) {
        let here = self.st.layout.all();
        self.st.tiles.retain(|tile, _| here.contains(tile));
        if self.st.editing.as_ref().is_some_and(|e| !here.contains(&e.tile)) { self.st.editing = None }
        // The editor takes what is typed only while its tile has the keys.
        let typing = self.st.editing.as_ref().is_some_and(|e| e.tile == self.st.layout.focus);
        self.st.editor.give_keys(typing);
    }

    /// The arrangement and what each tile shows, written to the file they are kept in.
    pub(super) fn keep(&self) {
        let Some(path) = &self.kept_in else { return };
        // No screen yet is nothing to keep: the file is what a window opens as next time.
        if self.screen.is_nowhere() { return }
        let tiles: serde_json::Map<String, Value> = self.tiles.iter().filter(|(tile, _)| self.layout.spec(tile).is_some()).map(|(tile, ui)| (self.layout.name(tile), json!({ "note": ui.note, "unfolded": ui.unfolded, "narrowed": ui.narrowed, "chosen": ui.chosen, "subject": ui.subject }))).collect();
        let extension = match &self.screen.from { From::Extension(id) => Some(id.clone()), _ => None };
        // The screen is kept by its name and the revision of the note it was laid out from, never as a copy of its
        // spec: what a screen says of itself is the service's row for it, read when the window opens again.
        let kept = json!({ "screen": self.screen.name, "title": self.screen.title, "note": self.screen.note().map(|(id, revision)| json!({ "id": id, "revision": revision })), "extension": extension, "layout": self.layout.save(), "tiles": tiles });
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
    if let Some(screen) = screen { app.st.screen = screen }
    app.keep();
    Outcome::done()
}
