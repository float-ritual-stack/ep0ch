//! A list in its tile, whatever it is of: picking a row, and what the person chooses for it here (what it is
//! sorted and grouped by, how it is arranged, what its question is narrowed by). A choice names a property by its
//! NAME, as the tile's spec would: nothing here knows which properties there are. The names are the door's
//! (`list.pick`, `list.sort`, `list.group`, `list.layout`, `facets.set`), so a row's act line reads in both doors.
use serde_json::json;

use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;

static PICK: ActionRow = ActionRow::new("list.pick", Touches::Nothing, "pick a row of a list tile (tile=, else the one with the keys): id= the row's id, or n= its number from 1. It runs the row's own act line (a note's row opens it where the tile's opens land, a screen's row opens the screen), as whoever picks; a row that only folds (a revision, a component) shows what is under it, or puts it away")
    .args(&[("id", ArgSpec::text("the row's id, as the list gives it").optional()), ("n", ArgSpec::number("the row, from 1").optional())])
    .keys(&[KeyRow::via("a press on a row of a list")])
    .examples(&[Example { act: "list.pick n=1 tile=beds", does: "opens the first bed where the tile's opens land", safe: None }]);

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

pub static ACTIONS: &[Action] = &[Action { row: &PICK, run: pick, about: About::Lists }, Action { row: &SORT, run: sort, about: About::Lists }, Action { row: &GROUP, run: group, about: About::Lists }, Action { row: &LAYOUT, run: layout, about: About::Lists }, Action { row: &NARROW, run: narrow, about: About::Lists }];

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
        (None, None) => return Outcome::refused("a pick names a row: id= or n="),
    };
    let Some(row) = row.cloned() else { return Outcome::refused(format!("{} lists no such row", app.layout.name(&tile))) };
    let Some(line) = row.act.clone() else {
        // A row that runs nothing and folds, in a list whose rows open: a pick shows what is under it, or puts it
        // away (a revision's change, a component's example). The tile's own state, whoever picks.
        if !unfolds(app, &tile, &row) { return Outcome::refused(format!("the row {} runs nothing when picked", row.label)) }
        fold(app, &tile, &row.id, None);
        return Outcome::answer(json!({ "tile": app.layout.name(&tile), "row": row.id, "open": app.ui(&tile).unfolded.contains(&row.id) }));
    };
    let folder = by.is_person() && unfolds(app, &tile, &row);
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
