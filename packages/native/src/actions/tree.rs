//! A tree in its tile (a list arranged as a tree): picking a row, folding one. A row is the service's; what a
//! pick runs is the row's own act line, and where its note opens is the layout's to say.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome};
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

/// The row of a tree stands for a folder: the service's row says so.
fn folds(app: &App, tree: &str, id: &str) -> bool { app.rows_of(tree).iter().any(|row| row.id == id && row.folds) }

fn set(app: &mut App, id: &str, open: Option<bool>) {
    let Some(tree) = app.tree_tile() else { return };
    let open = open.unwrap_or(!app.ui(&tree).unfolded.contains(id));
    let ui = app.ui_mut(&tree);
    if open { ui.unfolded.insert(id.to_string()); } else { ui.unfolded.remove(id); }
    app.keep();
}

fn pick(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let tree = app.tree_tile();
    // What the pick runs is the row's own act line; a row the tree doesn't list yet is an open of that note.
    let line = tree.as_ref().and_then(|tree| app.rows_of(tree).iter().find(|row| row.id == id).and_then(|row| row.act.clone())).unwrap_or_else(|| format!("open id={}", super::word(&id)));
    // An agent's pick is an open, by the same rule as any agent's open: asked of the dispatcher, not done round it.
    if !by.is_person() { return app.act(&line, by.clone()) }
    let Some(tree) = tree else { return Outcome::refused("this screen has no tree to pick a row of") };
    // A press opens the note; on the note the tree marks as open it folds or unfolds what's under it.
    if app.selected_in(&tree).as_deref() == Some(id.as_str()) {
        if folds(app, &tree, &id) { set(app, &id, None) }
        return Outcome::done();
    }
    let unfold = folds(app, &tree, &id);
    // The row's act comes from the tree: where its note lands is the layout's to say.
    let outcome = app.act(&format!("{line} tile={}", super::word(&app.layout.name(&tree))), by.clone());
    if outcome.ok && unfold { app.st.aimed = Some(tree); set(app, &id, Some(true)) }
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
