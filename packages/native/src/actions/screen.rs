//! Screens: open one, save the arrangement as one, put the arrangement back as the screen has it. A screen is
//! data the service serves (`screens.list`) or this window ships; saving one is the service's write
//! (`screens.save`), so the note's form has one writer.
use serde_json::{Value, json};

use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{Action, Actor, App, Notice, Outcome};
use crate::actline::Args;
use crate::screen::{From, Screen};
use crate::store::Reply;

static OPEN: ActionRow = ActionRow::new("screen.open", Touches::Screen, "lay the window out as a screen: one the outline has as a note, an extension's, or one this window ships. What the service says is wrong with a tile of it is drawn on that tile")
    .args(&[("name", ArgSpec::text("the screen's name").kind("screen"))])
    .keys(&[KeyRow::via("a screen's row in the bar")])
    .examples(&[Example { act: "screen.open name=desk", does: "lays the window out as the screen it ships: the tree, a reader and the open note's details in a dock", safe: None }]);

static SAVE: ActionRow = ActionRow::new("screen.save", Touches::Nothing, "save the arrangement as a screen note in the outline, so every door on it opens it: under the name it has, or name= (kept as typed for its title; its name is that, lowercase, spaces as -). The screen this window ships is saved under a name of your own")
    .args(&[("name", ArgSpec::text("the screen's name, as its note is headed (Garden work is garden-work)").optional().kind("screen"))])
    .keys(&[KeyRow::keys("mod+shift+s", "save the arrangement as its screen")])
    .menu(&[MenuRow::new("Save screen", "Window", Some("mod+shift+s"))])
    .examples(&[Example { act: "screen.save name=\"Garden work\"", does: "writes the arrangement as the screen note garden-work", safe: None }]);

static RESET: ActionRow = ActionRow::new("screen.reset", Touches::Screen, "put the arrangement back as its screen has it now: every split, move and close since is undone at once (layout.undo takes this back too)")
    .keys(&[KeyRow::keys("mod+shift+r", "put the arrangement back as its screen has it")])
    .menu(&[MenuRow::new("Reset screen", "Window", Some("mod+shift+r"))]);

pub static ACTIONS: &[Action] = &[Action { row: &OPEN, run: open }, Action { row: &SAVE, run: save }, Action { row: &RESET, run: reset }];

/// The window is laid out as `screen`: the layout's rules are asked first whether another arrangement may take this one's place.
fn lay_out(app: &mut App, screen: Screen, by: &Actor) -> Outcome {
    let Some(next) = screen.layout().filter(|l| !l.all().is_empty()) else {
        let why = screen.problems.iter().map(|p| p.said.as_str()).collect::<Vec<_>>().join(" · ");
        return Outcome::refused(if why.is_empty() { format!("the screen {} has no layout to open", screen.name) } else { why });
    };
    let said = screen.problems.iter().filter(|p| p.tile.is_none()).map(|p| p.said.clone()).collect::<Vec<_>>().join(" · ");
    // The layout's rules say whether it may take this arrangement's place: a tile that would go and holds an edit
    // keeps the screen as it is, and an agent's never takes or moves the person's keys.
    let was_laid = match app.replace(&screen.name, next, true, by) { Ok(before) => before, Err(why) => return Outcome::refused(why) };
    // What was there is one step back: the arrangement, and the screen it was of when this opens another (a reset
    // is the same screen, read again).
    let was = std::mem::replace(&mut app.st.screen, screen);
    let left = Some(was).filter(|was| was.name != app.st.screen.name);
    if left.is_some() || !super::layout::same_shape(&was_laid, &app.st.layout) { app.stepped((was_laid, left)) }
    app.keep();
    if !said.is_empty() { app.st.notice = Some(Notice::problem(said.clone())) }
    Outcome { said, ..Outcome::answer(json!({ "screen": app.screen.name, "tiles": app.layout.names.0.iter().map(|(_, name)| name.clone()).collect::<Vec<_>>() })) }
}

fn open(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let name = args.text("name").unwrap_or("");
    let screens = app.screens();
    let Some(screen) = screens.iter().find(|s| s.name == name).cloned() else {
        return Outcome::refused(format!("no screen named {name} · the screens here: {}", screens.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(", ")));
    };
    lay_out(app, screen, by)
}

fn reset(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    // The screen as it is served now: a note changed since it was opened is read again.
    let screen = app.screens().into_iter().find(|s| s.name == app.screen.name).unwrap_or_else(|| app.screen.clone());
    lay_out(app, screen, by)
}

fn save(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let shipped = matches!(app.screen.from, From::Shipped);
    // A name given is kept as typed for the title; the service makes the screen's name of it, by the one rule.
    let named = args.text("name").map(str::to_string).filter(|typed| *typed != app.screen.name && *typed != app.screen.title);
    if named.is_none() && shipped { return Outcome::refused(format!("{} ships with this window: a screen you make takes a name of its own · screen.save name=<a name>", app.screen.name)) }
    // The screen's own fields stay; its layout is the arrangement as it stands.
    let mut spec = app.screen.spec.clone().filter(Value::is_object).unwrap_or_else(|| json!({}));
    match &named { Some(typed) => { spec["name"] = json!(typed); spec["title"] = json!(typed) } None => { spec["name"] = json!(app.screen.name); spec["title"] = json!(app.screen.title) } }
    spec["layout"] = app.layout.save();
    let base = app.screen.note().filter(|_| named.is_none()).map(|(id, revision)| json!({ "id": id, "revision": revision }));
    let at = app.at.clone();
    app.store.write(&at, "screens.save", json!({ "spec": spec, "base": base }), by, saved, json!({ "spec": spec }));
    Outcome::done()
}

fn saved(app: &mut App, reply: Reply) {
    let result = match reply.result { Ok(result) => result, Err(refusal) => { app.st.notice = Some(Notice::problem(format!("The screen wasn't saved: {}", refusal.error))); return } };
    let (name, id) = (result["name"].as_str().unwrap_or_default().to_string(), result["id"].as_str().unwrap_or_default().to_string());
    // The arrangement is this screen's now: saved again, it is the same note at the revision written.
    if reply.by.is_person() {
        let mut spec = reply.ctx["spec"].clone();
        spec["name"] = json!(name);
        spec["title"] = result["title"].clone();
        app.st.screen = Screen { name: name.clone(), title: result["title"].as_str().unwrap_or(&name).to_string(), from: From::Note { id: id.clone(), revision: result["revision"].as_u64().unwrap_or(0) }, spec: Some(spec), problems: Vec::new() };
        app.keep();
    }
    let ask = app.screens_ask();
    app.store.refresh(&ask);
    app.st.notice = Some(Notice::info(format!("{} the screen {name} as a note: every door on this outline opens it.", if result["created"] == true { "Saved" } else { "Saved over" })));
}
