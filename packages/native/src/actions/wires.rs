//! What opens where, by hand: a tile's wires set and cleared, a preview joined to its list in one step, a reader
//! pinned, a list about a note held on its subject or let go to follow its home, and aimed at a note again. The
//! names and arguments are the door's (`tile.link`, `tile.preview`, `reader.pin`, `reader.follow`, `tile.hold`),
//! so a line reads in both doors. Nothing here decides where an open lands: a wire is the layout's (`Op::Link`,
//! through `reshape`), a landing is `layout::place`'s, and what a tile says of its wires is that same placement
//! asked without opening anything (`App::wire_words`).
//!
//! - **A wire is set on screen** (`tile.link ask=true`, a press on a title's wire control): while one is
//!   (`State.linking`) every tile says what a press on it does, the keys are that mode's (`Layer::Linking`), and
//!   the foot of the tiles says where the wire lands now. A press on a tile, its number, or the neighbour a letter
//!   names is `tile.link to=`; the tile itself is an open in place, and again (or for another verb) an unlink.
//! - **A list about a note has a subject and a home.** Held, it keeps its subject until it is aimed again
//!   (`tile.aim`); following, it lists what its home shows as that changes. `tile.hold` is the control.
use serde_json::{Value, json};

use super::app::{Arrival, Linking};
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{About, Action, Actor, App, Notice, Outcome};
use crate::actline::Args;
use crate::layout::tree::neighbour;
use crate::layout::{self, At, Beside, Destination, Dir, Id, Op, Route, TileSpec};

/// The verbs a wire has, in the order a title says them (the door's `WIRE_VERBS`, less hover: nothing here hovers).
pub const VERBS: &[&str] = &["select", "open", "alt"];

static LINK: ActionRow = ActionRow::new("tile.link", Touches::Shape, "set a wire from a tile (tile=, else the one with the keys) to another: verb=select shows what its cursor is on in to=<tile>, verb=open (default) sends what Return and a double click open there, verb=alt sends an open fresh there (rule=beside, tab, tile or first-unheld says how). Each verb has one destination: setting it replaces the wire before. No to= takes that verb's wire away; remove=true only when it names that tile. to= the tile itself, for open, is an open in place: the note is read in the list's own tile, and back returns to the list. ask=true picks the tile on screen and ask=false lets go (wire.pick, the person's)")
    .args(&[
        ("to", ArgSpec::text("the tile it lands in, as tile= names one; left out, that verb's wire is taken away").optional().kind("tile")),
        ("verb", ArgSpec::text("select, open (default), alt or hover").optional().choices(&["select", "open", "alt", "hover"])),
        ("rule", ArgSpec::text("with verb=alt: beside, tab, tile or first-unheld").optional().choices(&["beside", "tab", "tile", "first-unheld"])),
        ("remove", ArgSpec::flag("take the wire away only if it names to=").optional()),
        ("ask", ArgSpec::flag("true picks the tile on screen (wire.pick); false lets go with no wire changed").optional()),
    ])
    .keys(&[KeyRow::via("a press on a wire on a tile's title, then a press on the tile it lands in (wire.pick)")])
    .examples(&[
        Example { act: "tile.link to=reader tile=tree", does: "makes the reader where the tree's opens (Return, a double click) land", safe: None },
        Example { act: "tile.link verb=open tile=tree", does: "takes the tree's open wire away, so its opens land where they did before", safe: None },
        Example { act: "tile.link to=reader verb=select tile=tree", does: "the reader shows the note the tree's cursor is on", safe: None },
        Example { act: "tile.link to=links tile=links", does: "opens in place: a row opened in the links tile shows its note there, and back returns to the list", safe: None },
    ]);

static PICK: ActionRow = ActionRow::new("wire.pick", Touches::Screen, "set a wire by picking its tile on screen. verb= begins it from a tile (tile=, else the one with the keys): select, open (default) or alt. While one is being set every tile says what a press on it does, and to=<tile>, n=<the number on its title> or dir=<a side> links to that tile: the tile itself, for open, is an open in place, and again (or for another verb) an unlink. unlink=true takes the wire away; on=false lets go with no wire changed. What it sets is tile.link, by the layout's rule. The person's: it holds their keys and draws over their tiles")
    .person("picking a tile on screen is the person's: an agent names the tile · tile.link to=<tile> verb=<select, open, alt>")
    .args(&[
        ("verb", ArgSpec::text("the wire to set: select, open (default) or alt").optional().choices(&["select", "open", "alt"])),
        ("to", ArgSpec::text("the tile picked, as tile= names one").optional().kind("tile")),
        ("n", ArgSpec::number("the tile picked, by the number on its title").optional()),
        ("dir", ArgSpec::text("the tile picked: the next one that way from the tile the wire is from").optional().choices(&["left", "right", "up", "down"])),
        ("unlink", ArgSpec::flag("take the wire being set away").optional()),
        ("on", ArgSpec::flag("false lets go: no wire changes").optional()),
    ])
    .keys(&[
        KeyRow::with("alt+l then o", Some("tile"), "choose where this tile's opens land", &[("verb", Scalar::Text("open"))]),
        KeyRow::with("alt+l then s", Some("tile"), "choose where what its cursor is on shows", &[("verb", Scalar::Text("select"))]),
        KeyRow::with("alt+l then a", Some("tile"), "choose where its open fresh lands", &[("verb", Scalar::Text("alt"))]),
        KeyRow::with("escape q", Some("linking"), "lets go: no wire changes", &[("on", Scalar::Flag(false))]),
        KeyRow::with("o", Some("linking"), "the wire for where an open lands", &[("verb", Scalar::Text("open"))]),
        KeyRow::with("s", Some("linking"), "the wire for where a select shows", &[("verb", Scalar::Text("select"))]),
        KeyRow::with("a", Some("linking"), "the wire for where an open fresh lands", &[("verb", Scalar::Text("alt"))]),
        KeyRow::with("x", Some("linking"), "unlink: take this wire away", &[("unlink", Scalar::Flag(true))]),
        KeyRow::with("h left", Some("linking"), "link to the tile on the left", &[("dir", Scalar::Text("left"))]),
        KeyRow::with("l right", Some("linking"), "link to the tile on the right", &[("dir", Scalar::Text("right"))]),
        KeyRow::with("k up", Some("linking"), "link to the tile above", &[("dir", Scalar::Text("up"))]),
        KeyRow::with("j down", Some("linking"), "link to the tile below", &[("dir", Scalar::Text("down"))]),
        KeyRow::with("1", Some("linking"), "link to tile 1", &[("n", Scalar::Whole(1))]), KeyRow::with("2", Some("linking"), "link to tile 2", &[("n", Scalar::Whole(2))]),
        KeyRow::with("3", Some("linking"), "link to tile 3", &[("n", Scalar::Whole(3))]), KeyRow::with("4", Some("linking"), "link to tile 4", &[("n", Scalar::Whole(4))]),
        KeyRow::with("5", Some("linking"), "link to tile 5", &[("n", Scalar::Whole(5))]), KeyRow::with("6", Some("linking"), "link to tile 6", &[("n", Scalar::Whole(6))]),
        KeyRow::with("7", Some("linking"), "link to tile 7", &[("n", Scalar::Whole(7))]), KeyRow::with("8", Some("linking"), "link to tile 8", &[("n", Scalar::Whole(8))]),
        KeyRow::with("9", Some("linking"), "link to tile 9", &[("n", Scalar::Whole(9))]),
        KeyRow::via("a press on a wire on a tile's title, then a press on the tile it lands in"),
    ])
    .menu(&[
        MenuRow::with("Open lands in\u{2026}", "Tile", Some("alt+l then o"), &[("verb", Scalar::Text("open"))]),
        MenuRow::with("Select shows in\u{2026}", "Tile", Some("alt+l then s"), &[("verb", Scalar::Text("select"))]),
        MenuRow::with("Open fresh lands in\u{2026}", "Tile", Some("alt+l then a"), &[("verb", Scalar::Text("alt"))]),
    ])
    .examples(&[Example { act: "wire.pick verb=select tile=tree", does: "begins the tree's select wire: the next tile pressed is where its cursor shows", safe: Some(true) }, Example { act: "wire.pick to=reader", does: "links the wire being set to the reader", safe: None }]);

static PREVIEW: ActionRow = ActionRow::new("tile.preview", Touches::Shape, "open a reader beside a list (tile=, else the tile with the keys), joined by a select wire: what the list's cursor is on shows there. On a reader, a second reader where its opens land, joined by an open wire. Run again it shows the one that is there, and says how to unlink it. where=right, down, left or up; left out, the longer side")
    .args(&[("where", ArgSpec::text("right, down, left or up (default: the tile's longer side)").optional().choices(&["right", "down", "left", "up"]))])
    .keys(&[
        KeyRow::on("shift+o", "tile", "a preview beside this tile, wired to it"),
        KeyRow::with("alt+shift+o", Some("tile"), "a preview below this tile, wired to it", &[("where", Scalar::Text("down"))]),
    ])
    .menu(&[MenuRow::new("Preview beside", "Tile", Some("shift+o")), MenuRow::with("Preview below", "Tile", Some("alt+shift+o"), &[("where", Scalar::Text("down"))])])
    .examples(&[
        Example { act: "tile.preview where=right tile=tree", does: "opens a reader right of the tree that shows what its cursor is on", safe: None },
        Example { act: "tile.preview where=down tile=reader", does: "opens a reader below the reader and links its opens to it", safe: None },
    ]);

static PIN: ActionRow = ActionRow::new("reader.pin", Touches::Tile, "pin a reader (tile=, else the reader with the keys) or let it go: pinned, it keeps the note it shows, a select wire into it waits, every open aimed at it lands in a reader beside it, and it comes back pinned after a restart. on=true pins, on=false lets go; left out, the other of the two. Said on screen when an agent does it")
    .args(&[("on", ArgSpec::flag("true pins, false lets go; left out, the other of the two").optional())])
    .keys(&[KeyRow::on("p", "page", "pin this reader on its note, or let it go"), KeyRow::via("the pin on a reader's title")])
    .menu(&[MenuRow::new("Pin", "Note", Some("p"))])
    .examples(&[Example { act: "reader.pin tile=reader", does: "pins the reader on its note: opens aimed at it land beside it", safe: None }, Example { act: "reader.pin on=false tile=reader", does: "lets the reader go: opens land in it again", safe: None }]);

static FOLLOW: ActionRow = ActionRow::new("reader.follow", Touches::Shape, "which tile's cursor a reader (tile=, else the reader with the keys) shows: source=<tile> (a list: a select wire from it into the reader, saved with the arrangement) or source=none (no select wire into it: it keeps what it shows)")
    .args(&[("source", ArgSpec::text("a list tile's name, or none").kind("tile"))])
    .keys(&[KeyRow::via("its row in the command bar, with the tile typed (reader.follow source=tree)")])
    .examples(&[
        Example { act: "reader.follow source=tree tile=reader", does: "the reader shows whatever the tree's cursor is on", safe: None },
        Example { act: "reader.follow source=none tile=reader", does: "takes the select wires into the reader away: it keeps the note it shows", safe: None },
    ]);

static HOLD: ActionRow = ActionRow::new("tile.hold", Touches::Tile, "hold a list about a note (tile=, else the one with the keys) on the note it lists (on=true): it keeps that subject while its reader moves on, until it is aimed again (tile.aim). on=false lets it go: it follows the note its home shows. Left out, the other of the two. Kept with the arrangement, and written with a screen that is saved")
    .args(&[("on", ArgSpec::flag("true holds it on its subject, false lets it follow its home; left out, the other of the two").optional())])
    .keys(&[KeyRow::on("shift+b", "rows", "hold this list on its note, or let it follow its reader"), KeyRow::via("the held or follows control on its title")])
    .examples(&[
        Example { act: "tile.hold on=true tile=backlinks", does: "keeps the backlinks on the note they list while the reader moves on", safe: None },
        Example { act: "tile.hold on=false tile=backlinks", does: "lets them follow whatever the reader shows", safe: None },
    ]);

static AIM: ActionRow = ActionRow::new("tile.aim", Touches::Tile, "aim the lists about a note at one. In a reader (tile=, else the one with the keys): every list about a note on this screen lists that reader's note, the reader becomes their home, and the first of them comes forward and takes the person's keys. In a list about a note: it lists its home's note again. id= names another note (an ancestor's, a link's). A list aimed is held on what it was aimed at; tile.hold on=false lets it follow again. An agent's aim never takes the person's keys, and never moves a list they hold")
    .args(&[("id", ArgSpec::text("the note to list; left out, the note the reader shows").optional().kind("note"))])
    .keys(&[KeyRow::on("b", "page", "aim the lists about a note at this reader's"), KeyRow::on("b", "rows", "aim this list at its reader's note again")])
    .menu(&[MenuRow::new("List what is about this note", "Note", Some("b"))])
    .examples(&[
        Example { act: "tile.aim tile=reader", does: "the backlinks, comments and revisions list the reader's note, and the first of them takes the keys", safe: None },
        Example { act: "tile.aim tile=backlinks", does: "the backlinks list the note their reader shows now", safe: None },
    ]);

pub static ACTIONS: &[Action] = &[
    Action { row: &LINK, run: link, about: About::Any }, Action { row: &PICK, run: pick, about: About::Any }, Action { row: &PREVIEW, run: preview, about: About::Any },
    Action { row: &PIN, run: pin, about: About::Notes }, Action { row: &FOLLOW, run: follow, about: About::Notes },
    Action { row: &HOLD, run: hold, about: About::Lists }, Action { row: &AIM, run: aim, about: About::Any },
];

impl App {
    /// A reader is pinned: somebody pinned it here, else its spec says so (`mode: pinned`, as a screen saves one).
    pub fn pinned(&self, tile: &str) -> bool {
        self.reads_notes(tile) && self.ui(tile).pinned.unwrap_or_else(|| self.spec(tile).and_then(|spec| spec.fields.get("mode")).and_then(Value::as_str) == Some("pinned"))
    }

    /// A reader shows what a list's cursor is on: a select wire feeds it from a tile that lists (the door's
    /// `listFed`). It is that list's reader, whose note an open replaces; any other keeps its old note as a spine.
    pub fn list_fed(&self, tile: &str) -> bool {
        self.layout.wires.iter().any(|wire| wire.to == tile && wire.verb == "select" && wire.from != tile && self.is_a(&wire.from, About::Lists))
    }

    /// A list tile shows a note in its own place: its open is wired to itself, and one was opened. The note is read
    /// there by the drawer every reader has, with the list beneath; back past its first note puts the list back.
    pub fn in_place(&self, tile: &str) -> bool {
        self.ui(tile).note.is_some() && self.spec(tile).and_then(|spec| self.kind_row(&spec.kind)).and_then(crate::tiles::drawer_of).is_some_and(|drawer| drawer.lists)
    }

    /// Where an open from `tile` lands, in a few words: placement's own answer for it, asked without opening
    /// anything. The door's `opensOf` (its `short`), over the same decider.
    fn opens_words(&self, tile: &str) -> String {
        let plan = super::nav::planned(self, tile, false, false);
        let name = |id: &Id| self.layout.name(id);
        match (&plan.route, &plan.destination) {
            (Some(Route::Across { target, .. }), _) => target.clone(),
            (Some(Route::To { to, .. }), _) if to == tile => "in place".into(),
            (Some(Route::To { to, .. }), _) => name(to),
            (Some(Route::Into(key)), _) => key.clone(),
            (Some(Route::Next), _) => "next column".into(),
            (_, Destination::Swap { tile: to, .. }) => if to == tile { "itself".into() } else { name(to) },
            (_, Destination::New { .. }) if plan.beside_of.is_some() => format!("beside {}", plan.beside_of.as_ref().map_or("it".to_string(), |of| if of == tile { "it".into() } else { name(of) })),
            (_, Destination::New { .. }) => "a new reader".into(),
            (_, Destination::Action { action }) => action.clone(),
            _ => "nowhere".into(),
        }
    }

    /// Where a tile's verb lands, in a few words (the door's `wireWords`): `select` the tiles its cursor shows in,
    /// `open` where Return opens, `alt` where an open fresh goes. Read by the title's wire controls, the words while
    /// a wire is set, `peek` and what `tile.preview` says of a wire that is there.
    pub fn wire_words(&self, tile: &str, verb: &str) -> String {
        let name = |id: &Id| self.layout.name(id);
        match verb {
            "open" => self.opens_words(tile),
            "select" => { let to: Vec<String> = self.layout.select_targets(tile).iter().map(name).collect(); if to.is_empty() { "nowhere".into() } else { to.join(", ") } }
            _ => {
                let plan = super::nav::planned(self, tile, verb == "alt", verb == "hover");
                match (&plan.destination, &plan.route) {
                    (Destination::Across { screen: true, .. }, _) => "new on the screen".into(),
                    (Destination::Action { action }, _) => action.clone(),
                    (_, Some(Route::Across { target, rule })) => match rule.as_str() { "beside" => format!("beside {target}"), "tab" => format!("tab of {target}"), "first-unheld" => "first reader not pinned".into(), _ => target.clone() },
                    (_, Some(Route::To { to, .. })) => name(to),
                    (_, Some(Route::Beside(of))) => format!("beside {}", name(of)),
                    (_, Some(Route::Tab(of))) => format!("tab of {}", name(of)),
                    (_, Some(Route::Into(key))) => key.clone(),
                    (_, Some(Route::Next)) => "next column".into(),
                    _ if verb == "hover" => "nowhere".into(),
                    _ => self.opens_words(tile),
                }
            }
        }
    }

    /// What a tile says of where things open, as data: each wire's words, a reader's pin, whether it keeps its old
    /// note as a spine, a list's subject and whether it is held on it, the landing still marked on it. What `peek`
    /// answers for a tile, from the same answers its title draws.
    pub fn opens_said(&self, tile: &str) -> Value {
        if !self.has_wires(tile) { return Value::Null }
        let mut said = serde_json::Map::new();
        for verb in VERBS { said.insert((*verb).into(), json!(self.wire_words(tile, verb))); }
        let (from, lands) = self.wired_from(tile);
        if !from.is_empty() { said.insert("from".into(), json!(from)); }
        if lands { said.insert("lands".into(), json!(true)); }
        if self.reads_notes(tile) && !self.in_place(tile) { said.insert("pinned".into(), json!(self.pinned(tile))); said.insert("spines".into(), json!(self.facts(tile).held)); }
        if self.in_place(tile) { said.insert("inPlace".into(), json!(true)); }
        if let Some((held, title, home)) = self.held_on(tile) { said.insert("subject".into(), json!({ "held": held, "note": self.subject_of(tile), "title": title, "home": home })); }
        if let Some(arrived) = self.arrival(tile) { said.insert("arrived".into(), json!({ "note": arrived.note, "by": arrived.by.id(), "preview": arrived.preview })); }
        Value::Object(said)
    }

    /// A tile has wires to say: it lists notes or reads them (a terminal and a rendered tile open nothing).
    pub fn has_wires(&self, tile: &str) -> bool { self.drawer_of(tile).is_some_and(|drawer| drawer.lists || drawer.notes) }

    /// The tiles wired into `tile`, by name, and whether an open that names no tile lands here: what a target's
    /// title says of itself (the door's `← tree` and `opens land here`).
    pub fn wired_from(&self, tile: &str) -> (Vec<String>, bool) {
        let mut from: Vec<String> = Vec::new();
        for wire in self.layout.wires.iter().filter(|wire| wire.to == tile && wire.from != tile) { let name = self.layout.name(&wire.from); if !from.contains(&name) { from.push(name) } }
        (from, self.reads_notes(tile) && self.landing().as_deref() == Some(tile))
    }

    /// What a list about a note says it is on, for its title: the subject's title where a page of it is read
    /// here, and whether it is held on it or follows its home. None: the tile is no list about a note.
    pub fn held_on(&self, tile: &str) -> Option<(bool, Option<String>, Option<String>)> {
        if !self.aims(tile) { return None }
        let subject = self.subject_of(tile);
        let title = subject.as_ref().and_then(|note| self.store().read::<crate::page::Page>(&self.page_ask(note)).map(|page| page.title.clone()));
        Some((!self.follows(tile), title, self.home_name(tile)))
    }

    /// A tile is a list about one note, held or following: what `tile.aim` and `tile.hold` act on.
    pub fn aims(&self, tile: &str) -> bool { self.is_a(tile, About::Lists) && !self.in_place(tile) && (self.about_a_note(tile) || self.field_of(tile, "subject").is_some()) && self.field_of(tile, super::app::OF).is_none() }

    /// What the foot of the tiles says while a wire is being set: which wire, where it lands now, and the keys of
    /// the mode (the key table's own rows for it).
    pub fn linking_said(&self) -> Option<String> {
        let linking = self.linking.as_ref()?;
        let name = self.layout.name(&linking.from);
        let lands = self.wire_words(&linking.from, &linking.verb);
        Some(format!("{} from {name} lands in {lands} · press a tile to send it there{}", linking.verb, if linking.verb == "open" { format!(", or {name} itself to open in place") } else { String::new() }))
    }

    /// What a press on `tile` does while a wire is being set: the words its title says then.
    pub fn link_offer(&self, tile: &str) -> Option<&'static str> {
        let linking = self.linking.as_ref()?;
        if linking.from == tile { return Some(if linking.verb == "open" && !self.layout.wires.iter().any(|wire| wire.from == tile && wire.verb == "open" && wire.to == tile) { "press to open in place" } else { "press to unlink" }) }
        (self.reads_notes(tile) || self.in_place(tile)).then_some("press to link here")
    }

    /// A landing is marked on the tile that took it, and said: whose, and in which tile. The person's own open is
    /// said only when it landed somewhere they might not expect (the caller's `why`); an agent's is always said on
    /// the status line by the step itself.
    pub(super) fn arrive(&mut self, tile: &str, note: &str, by: &Actor, preview: bool) {
        if preview && self.ui(tile).arrived.as_ref().is_some_and(|arrived| arrived.note == note) { return }
        self.ui_mut(tile).arrived = Some(Arrival { note: note.to_string(), by: by.clone(), at: std::time::Instant::now(), preview });
    }

    /// The landing a tile's title still says: one not yet on screen long enough to have been seen.
    pub fn arrival(&self, tile: &str) -> Option<&Arrival> { self.ui(tile).arrived.as_ref().filter(|arrived| arrived.at.elapsed() < super::app::ARRIVAL) }

    /// What a list's cursor is on shows in every tile its select wires name (the door's `desk.follow` through
    /// `previewLanding`): no keys move, and a target that is pinned, has a block being written in it or has the
    /// person's keys keeps its note (the wire waits). Picks from one tile soon after each other are one walk: they
    /// replace each other, and the way back keeps where the walk began. The one place a select is delivered.
    pub(super) fn picked(&mut self, from: &str, note: &str, by: &Actor) -> Vec<String> {
        let mut shown = Vec::new();
        let person = self.person();
        for to in self.layout.select_targets(from) {
            if to == from || !self.reads_notes(&to) { continue }
            let facts = self.facts(&to);
            let theirs = !self.stands(by) && (person.focus == self.layout.name(&to) || person.typing_in.as_deref() == Some(self.layout.name(&to).as_str()));
            if facts.pinned || facts.editing.is_some() || theirs { continue }
            let was = self.note_of(&to);
            let now = std::time::Instant::now();
            let walking = self.ui(&to).walk.as_ref().is_some_and(|(walked, at, last)| walked == from && now.duration_since(*at) < super::app::WALK && was.as_deref() == Some(last.as_str()));
            if was.as_deref() != Some(note) {
                self.show(&to, note, !walking);
                self.arrive(&to, note, by, true);
            }
            self.ui_mut(&to).walk = Some((from.to_string(), now, note.to_string()));
            shown.push(self.layout.name(&to));
        }
        if !shown.is_empty() { self.keep() }
        shown
    }
}

fn link(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let from = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&from);
    let verb = args.text("verb").unwrap_or("open").to_string();
    // Picking on screen is another act, the person's own (`wire.pick`): its row says whose it is, and the one rule refuses.
    if let Some(ask) = args.flag("ask") {
        let mut asked = serde_json::Map::new();
        if ask { asked.insert("verb".into(), json!(verb)); } else { asked.insert("on".into(), json!(false)); }
        return app.act_request(crate::actline::Request { action: PICK.id.to_string(), tile: Some(name), by: None, args: asked }, by.clone());
    }
    let to = match args.text("to") { Some(to) => match app.tile_named(to, by) { Ok(to) => Some(to), Err(why) => return Outcome::refused(why) }, None => None };
    let done = app.reshape(&Op::Link { tile: from.clone(), to: to.clone(), verb: Some(verb.clone()), remove: args.flag("remove") == Some(true), rule: args.text("rule").map(str::to_string), across: None }, by);
    if !done.ok { return done }
    // A wire set is no longer being picked.
    if app.linking.as_ref().is_some_and(|linking| linking.from == from) { app.st.linking = None }
    // A list wired to itself and showing a note in place goes back to its list when that wire goes.
    if !app.layout.wires.iter().any(|wire| wire.from == from && wire.verb == "open" && wire.to == from) && app.in_place(&from) { super::nav::list_again(app, &from) }
    app.keep();
    let lands = app.wire_words(&from, &verb);
    let said = match &to { Some(to) if args.flag("remove") != Some(true) => format!("{name}: {verb} \u{2192} {}", if *to == from { "in place".to_string() } else { app.layout.name(to) }), _ => format!("unlinked {name}'s {verb}: it lands in {lands}") };
    if app.stands(by) { app.st.notice = Some(Notice::info(said.clone())) }
    Outcome { said, ..Outcome::answer(json!({ "tile": name, "verb": verb, "wire": done.answer["wire"], "lands": lands })) }
}

/// A wire picked on screen: begun from a tile, its verb changed, a tile picked for it, taken away, or let go. What
/// it sets is `tile.link`, run as the act it is.
fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    if args.flag("on") == Some(false) {
        let was = app.st.linking.take();
        return Outcome::answer(json!({ "picking": false, "changed": false, "was": was.map(|linking| linking.verb) }));
    }
    let picks = args.text("to").is_some() || args.number("n").is_some() || args.text("dir").is_some() || args.flag("unlink") == Some(true);
    if !picks {
        // Begun, or its verb changed: from the tile named, else the one a wire is being set from, else the one with the keys.
        // (The tile the act is about is the one named, else the one with the keys: while a wire is being set, a key
        // that changes its verb names none and is about that wire's own tile.)
        let about = app.about().unwrap_or_else(|| app.layout.focus.clone());
        let from = match &app.linking { Some(linking) if about == app.layout.focus => linking.from.clone(), _ => about };
        let name = app.layout.name(&from);
        if !app.has_wires(&from) { return Outcome::refused(format!("{name} opens nothing and lists nothing: it has no wire to set")) }
        let verb = args.text("verb").map(str::to_string).or_else(|| app.linking.as_ref().map(|linking| linking.verb.clone())).unwrap_or_else(|| "open".into());
        app.st.linking = Some(Linking { from: from.clone(), verb: verb.clone() });
        return Outcome::answer(json!({ "picking": true, "tile": name, "verb": verb, "lands": app.wire_words(&from, &verb) }));
    }
    let Some(Linking { from, verb }) = app.linking.clone() else { return Outcome::refused("no wire is being set: wire.pick verb=<select, open, alt> begins one from the tile with the keys") };
    let name = app.layout.name(&from);
    let to = match (args.text("to"), args.number("n"), args.text("dir").and_then(Dir::read)) {
        _ if args.flag("unlink") == Some(true) => None,
        (Some(to), ..) => match app.tile_named(to, by) { Ok(to) => Some(to), Err(why) => return Outcome::refused(why) },
        (None, Some(n), _) => match app.tab_stops().get((n.max(1.0) as usize) - 1).cloned() { Some(to) => Some(to), None => return Outcome::refused(format!("there is no tile {n} here")) },
        (None, None, Some(dir)) => match neighbour(&app.layout.rects(app.area, &|_| false), &from, dir) { Some(to) => Some(to), None => return Outcome::refused(format!("there is no tile that way from {name}")) },
        (None, None, None) => None,
    };
    // The tile itself: an open in place; again, or for another verb, it unlinks (the door's `linkToPane`).
    let in_place = app.layout.wires.iter().any(|wire| wire.from == from && wire.verb == "open" && wire.to == from);
    let to = to.filter(|to| !(*to == from && (verb != "open" || in_place)));
    let mut asked = serde_json::Map::new();
    asked.insert("verb".into(), json!(verb));
    if let Some(to) = &to { asked.insert("to".into(), json!(app.layout.name(to))); }
    app.act_request(crate::actline::Request { action: LINK.id.to_string(), tile: Some(name), by: None, args: asked }, by.clone())
}

/// A reader beside a tile, wired to it in the one step: a list's select, a reader's open (the door's `previewTile`).
/// One that is there already is shown, and said with the way to unlink it.
fn preview(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let from = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&from);
    if !app.has_wires(&from) { return Outcome::refused(format!("{name} opens nothing and lists nothing: there is nothing to preview beside it")) }
    let verb = if app.reads_notes(&from) { "open" } else { "select" };
    let had = if verb == "select" { app.layout.select_targets(&from).into_iter().next() } else { app.layout.wires.iter().find(|wire| wire.from == from && wire.verb == "open").map(|wire| wire.to.clone()) };
    if let Some(had) = had.filter(|had| *had != from) {
        let there = app.layout.name(&had);
        let shown = app.reshape(&Op::Reveal { tile: had.clone() }, by);
        if !shown.ok { return shown }
        // The way to unlink it is an act, worded by the one sayer: the person's keys for it (the wire picked again
        // on screen, then unlinked), an agent's line.
        let ways = if app.stands(by) { vec![layout::Way::new(PICK.id, "picks that wire again").arg("verb", verb).at(format!("in {name}")), layout::Way::new(PICK.id, "unlinks it").arg("unlink", true).then()] } else { vec![layout::Way::new(LINK.id, "unlinks it").arg("verb", verb).tile(&name)] };
        let said = super::says(&layout::Refusal::new(format!("{name} already {} into {there}: showed it", if verb == "open" { "opens" } else { "selects" })).ways(ways), by);
        if app.stands(by) { app.st.notice = Some(Notice::info(said.clone())) }
        return Outcome { said, ..Outcome::answer(json!({ "tile": there, "from": name, "existing": true, "verb": verb })) };
    }
    let Some(kind) = app.note_kind().map(|row| row.written().to_string()) else { return Outcome::refused("no tile kind here reads notes: the service lists none") };
    let made = app.layout.auto_name(&format!("{name}-preview"), &[]);
    let dir = args.text("where").and_then(Dir::read);
    let beside = Beside { target: from.clone(), prefers: if dir.is_some() { "there".into() } else { "axis".into() }, dir, needs: (Some(layout::tree::MIN_COLS), Some(layout::tree::MIN_ROWS)), strict: false, pair: false, weight: None, keeps: (None, None), tab: false };
    let done = app.reshape(&Op::Open { tile: TileSpec::new(made.clone(), kind), name: Some(made.clone()), loose: false, alt: false, deliberate: None, at: At::Beside(beside), keys: false, link: Some(from.clone()), verb: Some(verb.to_string()), select_from: Vec::new() }, by);
    if !done.ok { return done }
    if let Some(tile) = app.layout.named(&made) {
        app.ui_mut(&tile).deliberate = true;
        // A list's preview shows what its cursor is on from the start.
        if verb == "select" && let Some(note) = super::list::cursor_note(app, &from) { app.picked(&from, &note, by); }
    }
    app.keep();
    let said = format!("opened {made} {}", if verb == "open" { format!("where {name}'s opens land") } else { format!("for what {name}'s cursor is on") });
    if app.stands(by) { app.st.notice = Some(Notice::info(said.clone())) }
    Outcome { said, ..Outcome::answer(json!({ "tile": made, "from": name, "existing": false, "verb": verb, "where": done.answer["where"] })) }
}

fn pin(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to pin") };
    let name = app.layout.name(&reader);
    if app.in_place(&reader) { return Outcome::refused(format!("{name} is a list showing a note in place: back returns to the list, and nothing pins it")) }
    let on = args.flag("on").unwrap_or(!app.pinned(&reader));
    if on == app.pinned(&reader) { return Outcome::answer(json!({ "tile": name, "pinned": on, "changed": false })) }
    app.ui_mut(&reader).pinned = Some(on);
    app.keep();
    let said = if on { format!("pinned {name}: opens aimed at it land beside it") } else { format!("unpinned {name}: opens land in it again") };
    if app.stands(by) { app.st.notice = Some(Notice::info(said.clone())) }
    Outcome { said, ..Outcome::answer(json!({ "tile": name, "pinned": on, "changed": true })) }
}

/// Which list's cursor a reader shows: a select wire from it, set or cleared by the layout's own step.
fn follow(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(reader) = app.about() else { return Outcome::refused("there is no reader to wire") };
    let name = app.layout.name(&reader);
    let source = args.text("source").unwrap_or("none");
    if source == "none" {
        let feeding: Vec<Id> = app.layout.wires.iter().filter(|wire| wire.to == reader && wire.verb == "select").map(|wire| wire.from.clone()).collect();
        for from in feeding { let done = app.reshape(&Op::Link { tile: from, to: Some(reader.clone()), verb: Some("select".into()), remove: true, rule: None, across: None }, by); if !done.ok { return done } }
        return Outcome { said: format!("unwired {name}: it keeps the note it shows"), ..Outcome::answer(json!({ "tile": name, "source": "none" })) };
    }
    let from = match app.tile_named(source, by) { Ok(from) => from, Err(why) => return Outcome::refused(why) };
    if !app.is_a(&from, About::Lists) { return Outcome::refused(format!("{} lists nothing: a reader follows a list's cursor (a tree, a list of matches, a note's links)", app.layout.name(&from))) }
    let done = app.reshape(&Op::Link { tile: from.clone(), to: Some(reader), verb: Some("select".into()), remove: false, rule: None, across: None }, by);
    if !done.ok { return done }
    Outcome { said: format!("wired {}'s cursor to {name}", app.layout.name(&from)), ..Outcome::answer(json!({ "tile": name, "source": app.layout.name(&from) })) }
}

fn hold(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let Some(tile) = app.about() else { return Outcome::refused("this screen has no list to hold") };
    let name = app.layout.name(&tile);
    if !app.aims(&tile) { return Outcome::refused(format!("{name} is no list about a note: it has no subject to hold")) }
    let held = args.flag("on").unwrap_or(app.follows(&tile));
    if held != app.follows(&tile) { return Outcome::answer(json!({ "tile": name, "held": held, "changed": false })) }
    // Held, it keeps the note it lists now; let go, it lists what its home shows from then.
    let subject = app.subject_of(&tile);
    let ui = app.ui_mut(&tile);
    ui.follows = Some(!held);
    if held { ui.subject = subject }
    app.keep();
    let home = app.home_name(&tile).unwrap_or_else(|| "its reader".into());
    let said = if held { format!("held {name} on its note: {home} moves on without it") } else { format!("let go of {name}: it follows {home}") };
    if app.stands(by) { app.st.notice = Some(Notice::info(said.clone())) }
    Outcome { said, ..Outcome::answer(json!({ "tile": name, "held": held, "changed": true, "subject": app.subject_of(&tile) })) }
}

/// A list aimed at a note: it is held on it, the subject it had is somewhere to go back to, and `home` (when one is
/// given) is the reader it speaks for from then.
fn aim_at(app: &mut App, tile: &str, note: &str, home: Option<&Id>) {
    let was = app.subject_of(tile);
    let ui = app.ui_mut(tile);
    if let Some(was) = was.filter(|was| was != note) { ui.trail.push(was) }
    ui.subject = Some(note.to_string());
    ui.follows = Some(false);
    if let Some(home) = home { ui.home = Some(home.clone()) }
}

fn aim(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let at = app.about().unwrap_or_else(|| app.layout.focus.clone());
    let name = app.layout.name(&at);
    let standing = app.stands(by);
    // In a list about a note: it lists its home's note again (or the one named).
    if app.aims(&at) {
        let Some(note) = args.text("id").map(str::to_string).or_else(|| app.home_note(&at)) else { return Outcome::refused(format!("{name}'s reader shows no note to aim it at: name one with id=")) };
        aim_at(app, &at, &note, None);
        app.keep();
        return Outcome { said: format!("{name} lists the note {} shows", app.home_name(&at).unwrap_or_else(|| "its reader".into())), ..Outcome::answer(json!({ "tile": name, "subject": note })) };
    }
    if !app.reads_notes(&at) { return Outcome::refused(format!("{name} reads no note and lists nothing about one: tile.aim is run in a reader, or in a list about a note")) }
    let Some(note) = args.text("id").map(str::to_string).or_else(|| app.note_of(&at)) else { return Outcome::refused(format!("{name} shows no note to list anything about")) };
    let lists: Vec<Id> = app.layout.all().into_iter().filter(|tile| app.aims(tile)).collect();
    if lists.is_empty() { return Outcome::refused("this screen has no list about a note (a note's links, its comments, its revisions) to aim · screen.open name=<one that has>") }
    // An agent never moves a list the person holds, nor one they have the keys in.
    let lists: Vec<Id> = lists.into_iter().filter(|tile| standing || (app.follows(tile) && app.layout.focus != *tile)).collect();
    if lists.is_empty() { return Outcome::refused("every list about a note here is held on its note, and stays on it · tile.hold on=false lets one follow its reader again") }
    for tile in &lists { aim_at(app, tile, &note, Some(&at)) }
    app.keep();
    // The first of them shown comes forward (its tab, its dock), and takes the person's keys when the aim is theirs.
    let first = lists.iter().find(|tile| app.shown_tiles().contains(tile)).or(lists.first()).cloned();
    if let Some(first) = first {
        let shown = app.reshape(&Op::Reveal { tile: first.clone() }, by);
        if shown.ok && standing && app.draft_on(&at).is_none() { app.reshape(&Op::Focus { tile: first, quiet: false }, by); }
    }
    let names: Vec<String> = lists.iter().map(|tile| app.layout.name(tile)).collect();
    Outcome { said: format!("aimed {} at {name}'s note", names.join(", ")), ..Outcome::answer(json!({ "tile": name, "subject": note, "aimed": names })) }
}
