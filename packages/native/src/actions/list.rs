//! A list in its tile, whatever it is of: picking a row, and what the person chooses for it here (what it is
//! sorted and grouped by, how it is arranged, what its question is narrowed by). A choice names a property by its
//! NAME, as the tile's spec would: nothing here knows which properties there are. The names are the door's
//! (`list.pick`, `list.sort`, `list.group`, `list.layout`, `facets.set`), so a row's act line reads in both doors.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;
use crate::cursor::{self, Step};

static PICK: ActionRow = ActionRow::new("list.pick", Touches::Nothing, "pick a row of a list tile (tile=, else the one with the keys): id= the row's id, or n= its number from 1; neither, the row its cursor is on. It runs the row's own act line (a note's row opens it where the tile's opens land, a screen's row opens the screen), as whoever picks; a row that only folds (a revision, a component) shows what is under it, or puts it away")
    .args(&[("id", ArgSpec::text("the row's id, as the list gives it").optional()), ("n", ArgSpec::number("the row, from 1").optional())])
    .keys(&[KeyRow::on("enter", "list", "open the row the cursor is on"), KeyRow::via("a press on a row of a list")])
    .examples(&[Example { act: "list.pick n=1 tile=beds", does: "opens the first bed where the tile's opens land", safe: None }]);

static STEP: ActionRow = ActionRow::new("list.step", Touches::Tile, "move a list tile's cursor (tile=, else the one with the keys) by= rows (1 the next, -1 the one before), as j and k do; page=true counts pages (the rows in view, less one); axis=column moves across a board's lanes to the same place in the next one, axis=group to the first row of the next group. The cursor is one row, kept by its id as the rows change under it; it is no pointer's hover, and a first step starts from the row of the note the list's reader shows. A cursor is the person's: an agent moves the one of a tile they are not on")
    .args(&[
        ("by", ArgSpec::number("1 forward, -1 back (default 1)").optional()),
        ("axis", ArgSpec::text("row (default): down or up the rows; column: across a board's lanes; group: the next or previous group").optional().choices(&["row", "column", "group"])),
        ("page", ArgSpec::flag("by= counts pages, not rows: a page is the rows in view, less one").optional()),
    ])
    .keys(&[
        KeyRow::with("j down", Some("list"), "the next row", &[("by", Scalar::Whole(1))]),
        KeyRow::with("k up", Some("list"), "the row before", &[("by", Scalar::Whole(-1))]),
        KeyRow::with("pagedown", Some("list"), "a page of rows down", &[("by", Scalar::Whole(1)), ("page", Scalar::Flag(true))]),
        KeyRow::with("pageup", Some("list"), "a page of rows up", &[("by", Scalar::Whole(-1)), ("page", Scalar::Flag(true))]),
        KeyRow::with("l right", Some("list"), "the next lane of a board", &[("axis", Scalar::Text("column")), ("by", Scalar::Whole(1))]),
        KeyRow::with("h left", Some("list"), "the lane before", &[("axis", Scalar::Text("column")), ("by", Scalar::Whole(-1))]),
        KeyRow::with("shift+l", Some("list"), "the next group", &[("axis", Scalar::Text("group")), ("by", Scalar::Whole(1))]),
        KeyRow::with("shift+h", Some("list"), "the group before", &[("axis", Scalar::Text("group")), ("by", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "list.step by=1 tile=beds", does: "moves the beds' cursor to the next row", safe: Some(true) }]);

static SELECT: ActionRow = ActionRow::new("list.select", Touches::Tile, "put a list tile's cursor (tile=, else the one with the keys) on row n, counted as the rows are drawn: from 1, or from the end when negative (-1 the last). It opens nothing. A cursor is the person's: an agent moves the one of a tile they are not on")
    .args(&[("n", ArgSpec::number("the row, from 1; negative, from the end (-1 the last)"))])
    .keys(&[
        KeyRow::with("home", Some("list"), "the first row", &[("n", Scalar::Whole(1))]),
        KeyRow::with("end", Some("list"), "the last row", &[("n", Scalar::Whole(-1))]),
    ])
    .examples(&[Example { act: "list.select n=1 tile=beds", does: "puts the beds' cursor on their first row", safe: Some(true) }]);

static SORT: ActionRow = ActionRow::new("list.sort", Touches::Nothing, "sort a list tile by a property: by= its name (or created, updated, title), order= asc or desc. An empty by= puts it back as its spec has it")
    .args(&[("by", ArgSpec::text("a property name, or created, updated, title; empty clears it").optional()), ("order", ArgSpec::text("asc or desc").optional().choices(&["asc", "desc"]))])
    .keys(&[KeyRow::via("a press on a table's header")])
    .examples(&[Example { act: "list.sort by=crop order=asc tile=beds", does: "sorts the beds by what grows in them", safe: Some(true) }]);

static GROUP: ActionRow = ActionRow::new("list.group", Touches::Nothing, "group a list tile by a property: by= its name; its values are the list's sections, or its lanes. An empty by= puts it back as its spec has it")
    .args(&[("by", ArgSpec::text("a property name; empty clears it").optional())])
    .keys(&[KeyRow::via("a press on a property a row carries, in the list's header")])
    .examples(&[Example { act: "list.group by=stage tile=beds", does: "groups the beds by their stage", safe: Some(true) }]);

static LAYOUT: ActionRow = ActionRow::new("list.layout", Touches::Nothing, "arrange a list tile another way: layout= rows, table, lanes or grid. An empty layout= puts it back as its spec has it")
    .args(&[("layout", ArgSpec::text("rows, table, lanes or grid; empty clears it").optional())])
    .keys(&[KeyRow::via("a press on an arrangement in the list's header")])
    .examples(&[Example { act: "list.layout layout=lanes tile=beds", does: "draws the beds' groups as lanes", safe: Some(true) }]);

static NARROW: ActionRow = ActionRow::new("facets.set", Touches::Nothing, "narrow a list tile's question by a property the listed notes carry: key= and value= (the notes must carry it); mode=off, or the same pick again, drops it. The lists that follow the tile (source=tile:<it>) ask the narrowed question too")
    .args(&[("key", ArgSpec::text("the property's key").optional().kind("key")), ("value", ArgSpec::text("its value").optional()), ("mode", ArgSpec::text("include or off; left out, the other way").optional().choices(&["include", "off"]))])
    .keys(&[KeyRow::via("a press on a facet's row, or on a chip of a list")])
    .examples(&[Example { act: "facets.set key=stage value=sown tile=beds", does: "keeps the beds whose stage is sown", safe: Some(true) }]);

// (The cursor's steps first: the hint row says a tile's keys in the order their rows are listed.)
pub static ACTIONS: &[Action] = &[Action { row: &STEP, run: step, about: About::Lists }, Action { row: &PICK, run: pick, about: About::Lists }, Action { row: &SELECT, run: select, about: About::Lists }, Action { row: &SORT, run: sort, about: About::Lists }, Action { row: &GROUP, run: group, about: About::Lists }, Action { row: &LAYOUT, run: layout, about: About::Lists }, Action { row: &NARROW, run: narrow, about: About::Lists }];

/// The list tile an act is about: the one the dispatcher found for it (`App::target`: the one aimed at, else the one
/// with the keys when it lists, else the first that does).
fn target(app: &App) -> Result<String, Outcome> { app.about().ok_or_else(|| Outcome::refused("this screen has no list: name a list tile with tile=")) }

/// A folder's row, in a list whose folders unfold: what the list's own source says (it reads which are open).
fn unfolds(app: &App, tile: &str, row: &crate::page::ListRow) -> bool { row.folds && app.unfolds(tile) }

/// The one pick of a row, whatever the list is of: a press on a row, `list.pick` and the door's name for it in a
/// tree (`tree.pick`). It runs the row's own act line from the list's tile, as whoever picks. In a list whose
/// folders unfold, the person's pick of the row already open folds or unfolds it instead, and a folder they open
/// unfolds: that is the row's own word (`folds`), read here and nowhere else.
pub(super) fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let rows = app.rows_of(&tile);
    let row = match (args.text("id"), args.number("n")) {
        (Some(id), _) => rows.iter().find(|row| row.id == id),
        (None, Some(n)) => rows.get((n.max(1.0) as usize) - 1),
        // Neither: the row the tile's cursor is on.
        (None, None) => match app.ui(&tile).cursor.as_deref() { Some(id) => rows.iter().find(|row| row.id == id), None => return Outcome::refused(format!("the cursor is on no row of {}: a pick names one with id= or n=", app.layout.name(&tile))) },
    };
    let Some(row) = row.cloned() else { return Outcome::refused(format!("{} lists no such row", app.layout.name(&tile))) };
    // The row the person picks is where their cursor is from then: a press and the keys speak of one row.
    if app.stands(by) { app.ui_mut(&tile).cursor = Some(row.id.clone()) }
    let Some(line) = row.act.clone() else {
        // A row that runs nothing and folds, in a list whose rows open: a pick shows what is under it, or puts it
        // away (a revision's change, a component's example). The tile's own state, whoever picks.
        if !unfolds(app, &tile, &row) { return Outcome::refused(format!("the row {} runs nothing when picked", row.label)) }
        fold(app, &tile, &row.id, None);
        return Outcome::answer(json!({ "tile": app.layout.name(&tile), "row": row.id, "open": app.ui(&tile).unfolded.contains(&row.id) }));
    };
    let folder = app.stands(by) && unfolds(app, &tile, &row);
    if folder && app.home_note(&tile).as_deref() == Some(row.id.as_str()) {
        fold(app, &tile, &row.id, None);
        return Outcome::done();
    }
    // The row's own act line, as the request it reads as, from this tile: where a note lands is the layout's to
    // say, and who may run it the dispatcher's.
    let request = match crate::actline::parse(&line) { Ok(request) => request, Err(why) => return Outcome::refused(format!("the row {} runs a line that doesn't read: {}", row.label, why.0)) };
    let ran = app.act_from(request, &app.layout.name(&tile), by.clone());
    if ran.ok && folder { fold(app, &tile, &row.id, Some(true)) }
    Outcome { answer: json!({ "ran": line, "answer": ran.answer }), ..ran }
}

/// Where a list tile's cursor is among its rows now: its row by its id; on no row yet, the row of the note the
/// list's reader shows (a first step starts from the open note); else none.
pub(super) fn cursor_at(app: &App, tile: &str) -> Option<usize> {
    let rows = app.rows_of(tile);
    let at = |id: &str| rows.iter().position(|row| row.id == id);
    app.ui(tile).cursor.as_deref().and_then(at).or_else(|| app.home_note(tile).as_deref().and_then(at))
}

/// A list tile's cursor put on the row at `at`, and that row brought into view.
pub(super) fn cursor_to(app: &mut App, tile: &str, at: usize) -> Outcome {
    let Some(id) = app.rows_of(tile).get(at).map(|row| row.id.clone()) else { return Outcome::refused(format!("{} lists no such row", app.layout.name(tile))) };
    let name = app.layout.name(tile);
    app.st.reveal = Some(format!("tile/{name}/row/{id}"));
    app.ui_mut(tile).cursor = Some(id.clone());
    Outcome::answer(json!({ "tile": name, "cursor": id, "n": at + 1 }))
}

/// A list's rows as the keys move through them: the sections they are drawn in, in order (the list's own:
/// `ListView::sections`), each the places of its rows; and whether they are lanes, side by side.
fn drawn(app: &App, tile: &str) -> Option<(bool, Vec<Vec<usize>>)> {
    app.list_of(tile).map(|answer| (answer.list.arrange == crate::page::LANES, answer.list.sections().into_iter().map(|section| section.rows).filter(|rows| !rows.is_empty()).collect::<Vec<_>>())).filter(|(_, sections)| !sections.is_empty())
}

/// The cursor of a list moved by rows or by pages of the rows its view shows (`cursor::stepped`, the rule every
/// door's lists ask), across to the same place in the next lane, or to the next group's first row. It moves through
/// the rows in the order they are drawn, and in lanes it stays in its lane: a lane is a list.
fn step(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let Some((lanes, sections)) = drawn(app, &tile) else { return Outcome::refused(format!("{} lists nothing to move through", app.layout.name(&tile))) };
    let at = cursor_at(app, &tile);
    let by = args.number("by").map_or(1, |by| by as i64);
    // Where the cursor is: its lane or group, and its place in it.
    let held = at.and_then(|at| sections.iter().enumerate().find_map(|(lane, rows)| rows.iter().position(|row| *row == at).map(|place| (lane, place))));
    match args.text("axis") {
        Some(axis @ ("column" | "group")) => {
            let Some((lane, place)) = held else { return cursor_to(app, &tile, sections[0][0]) };
            // (A list that is no board has no lanes to cross: its cursor stays.)
            if axis == "column" && !lanes { return cursor_to(app, &tile, sections[lane][place]) }
            let next = &sections[cursor::stepped(Step::By(by), lane as i64, sections.len(), 0.0) as usize];
            return cursor_to(app, &tile, if axis == "column" { next[place.min(next.len() - 1)] } else { next[0] });
        }
        _ => {}
    }
    let step = if args.flag("page") == Some(true) { Step::Page(by) } else { Step::By(by) };
    let (order, place): (Vec<usize>, Option<usize>) = if lanes {
        let (lane, place) = held.map_or((0, None), |(lane, place)| (lane, Some(place)));
        (sections[lane].clone(), place)
    } else {
        let order = sections.concat();
        let place = at.and_then(|at| order.iter().position(|row| *row == at));
        (order, place)
    };
    // (A view not laid out yet has no page to say: a page is then a row.)
    let to = cursor::stepped(step, place.map_or(-1, |place| place as i64), order.len(), app.ui(&tile).room.unwrap_or(0.0));
    cursor_to(app, &tile, order[to.max(0) as usize])
}

/// The cursor put on a row by its number, as the rows are drawn: from 1, or from the end.
fn select(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let Some(order) = drawn(app, &tile).map(|(_, sections)| sections.concat()) else { return Outcome::refused(format!("{} lists nothing to move through", app.layout.name(&tile))) };
    let n = args.number("n").unwrap_or(1.0) as i64;
    let at = if n < 0 { order.len() as i64 + n } else { n - 1 };
    match usize::try_from(at).ok().and_then(|at| order.get(at)) { Some(row) => cursor_to(app, &tile, *row), None => Outcome::refused(format!("{} lists {} rows: there is no row {n}", app.layout.name(&tile), order.len())) }
}

/// A folder of a list opened (`open: true`), folded, or the other way: the tile's own state, asked of the service next.
pub(super) fn fold(app: &mut App, tile: &str, id: &str, open: Option<bool>) {
    let open = open.unwrap_or(!app.ui(tile).unfolded.contains(id));
    let ui = app.ui_mut(tile);
    if open { ui.unfolded.insert(id.to_string()); } else { ui.unfolded.remove(id); }
    app.keep();
}

/// What the person chose for a list's parameter here: kept by the parameter's name, dropped when it is empty.
fn choose(app: &mut App, name: &str, value: Option<String>) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let ui = app.ui_mut(&tile);
    match value.filter(|value| !value.trim().is_empty()) { Some(value) => { ui.chosen.insert(name.to_string(), value); } None => { ui.chosen.remove(name); } }
    app.keep();
    Outcome::answer(json!({ "tile": app.layout.name(&tile), name: app.ui(&tile).chosen.get(name) }))
}

fn sort(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let by = args.text("by").map(str::trim).filter(|by| !by.is_empty());
    choose(app, "sort", by.map(|by| match args.text("order") { Some(order) => format!("{by} {order}"), None => by.to_string() }))
}

fn group(app: &mut App, args: &Args, _: &Actor) -> Outcome { choose(app, "group", args.text("by").map(str::to_string)) }

fn layout(app: &mut App, args: &Args, _: &Actor) -> Outcome { choose(app, "arrange", args.text("layout").map(str::to_string)) }

fn narrow(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    let tile = match target(app) { Ok(tile) => tile, Err(no) => return no };
    let (Some(key), Some(value)) = (args.text("key"), args.text("value")) else { return Outcome::refused("facets.set names a property and a value: key= and value=") };
    let pair = (key.to_string(), value.to_string());
    let ui = app.ui_mut(&tile);
    let had = ui.narrowed.contains(&pair);
    let on = match args.text("mode") { Some("off") => false, Some(_) => true, None => !had };
    if on && !had { ui.narrowed.push(pair) } else if !on { ui.narrowed.retain(|kept| *kept != pair) }
    app.keep();
    Outcome::answer(json!({ "tile": app.layout.name(&tile), "query": app.question_of(&tile) }))
}
