//! The outline's tree in the sidebar: picking a row, folding one.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome, nav};
use crate::actline::Args;

static PICK: ActionRow = ActionRow::new("tree.pick", Touches::Nothing, "pick a row of the outline tree by id. The person's opens its note and unfolds what is under it; on the note already open it folds or unfolds instead. An agent's shows the row's note in the reader, as `open` does, and folds nothing")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it").kind("note"))])
    .keys(&[KeyRow::via("a press on a row of the tree")])
    .examples(&[Example { act: "tree.pick id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens that row's note and unfolds what is under it", safe: None }]);

static FOLD: ActionRow = ActionRow::new("tree.fold", Touches::Nothing, "open (open=true) or fold (open=false) a row of the outline tree, else the other way. An agent's never folds away the row of the note the person has open")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it").kind("note")), ("open", ArgSpec::flag("true opens, false folds; left out, the other way").optional())])
    .keys(&[KeyRow::via("a press on the open note's row in the tree")])
    .examples(&[Example { act: "tree.fold id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 open=true", does: "shows the notes under that row", safe: Some(true) }]);

pub static ACTIONS: &[Action] = &[Action { row: &PICK, run: pick }, Action { row: &FOLD, run: fold }];

fn folds(app: &App, id: &str) -> bool { app.tree().iter().any(|line| line.row.id == id && line.row.has_children) }

fn set(app: &mut App, id: &str, open: Option<bool>) {
    let open = open.unwrap_or(!app.unfolded.contains(id));
    if open { app.st.unfolded.insert(id.to_string()); } else { app.st.unfolded.remove(id); }
}

fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    // An agent's pick is an open, by the same rule as any agent's open: asked of the dispatcher, not done round it.
    if !by.is_person() { return app.act(&format!("open id={}", super::word(&id)), by.clone()) }
    // A press opens the note; on the open note it folds or unfolds what's under it.
    if app.subject().as_deref() == Some(id.as_str()) {
        if folds(app, &id) { set(app, &id, None) }
        return Outcome::done();
    }
    let unfold = folds(app, &id);
    let outcome = nav::go(app, &id, by, true);
    if outcome.ok && unfold { set(app, &id, Some(true)) }
    outcome
}

fn fold(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let open = args.flag("open");
    if !by.is_person() && open != Some(true) && app.shown().is_some_and(|page| page.ancestors.iter().any(|a| a.id == id)) {
        return Outcome::refused("the person's note is under that row: an agent doesn't fold it away");
    }
    set(app, &id, open);
    Outcome::done()
}
