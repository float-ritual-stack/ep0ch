//! A tree in its tile (a list arranged as a tree): picking a row, folding one. A row is the service's; what a
//! pick runs is the row's own act line, and where its note opens is the layout's to say.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;

static PICK: ActionRow = ActionRow::new("tree.pick", Touches::Nothing, "pick a row of the outline tree by id (the door's name for list.pick in a tree: the same pick). The person's opens its note and unfolds what is under it; on the note already open it folds or unfolds instead. An agent's runs the row's act line as itself, as `open` does, and folds nothing. A row the tree doesn't list is refused, as any list's is")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it").kind("note").optional()), ("n", ArgSpec::number("the row, from 1").optional())])
    .keys(&[KeyRow::via("a press on a row of the tree")])
    .examples(&[Example { act: "tree.pick id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens that row's note and unfolds what is under it", safe: None }]);

static FOLD: ActionRow = ActionRow::new("tree.fold", Touches::Nothing, "open (open=true) or fold (open=false) a row of the outline tree, else the other way: id= the row, else the one the tree's cursor is on. Folding the cursor's row when it is folded already, or folds nothing, moves the cursor to the row it is under. An agent's never folds away the row of the note the person has open")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it (default: the row the cursor is on)").kind("note").optional()), ("open", ArgSpec::flag("true opens, false folds; left out, the other way").optional())])
    .keys(&[
        KeyRow::with("l right", Some("tree"), "unfold the row", &[("open", Scalar::Flag(true))]),
        KeyRow::with("h left", Some("tree"), "fold the row, or go to the row it is under", &[("open", Scalar::Flag(false))]),
        KeyRow::on("space", "tree", "fold or unfold the row"),
        KeyRow::via("a press on the open note's row in the tree"),
    ])
    .examples(&[Example { act: "tree.fold id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 open=true", does: "shows the notes under that row", safe: Some(true) }]);

// `tree.pick` is the door's name for a pick in a tree: the one pick (`list::pick`), asked of a list that is a tree.
pub static ACTIONS: &[Action] = &[Action { row: &PICK, run: super::list::pick, about: About::Tree }, Action { row: &FOLD, run: fold, about: About::Tree }];

fn fold(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let open = args.flag("open");
    let Some(tree) = app.about() else { return Outcome::refused("this screen has no tree to fold a row of") };
    let id = match args.text("id") {
        Some(id) => id.to_string(),
        // The row the cursor is on, as the keys fold one (the door's tree): a row that folds opens and folds; folded
        // already, or one that folds nothing, a fold goes to the row it is under, and an unfold leaves it be.
        None => {
            let Some(at) = super::list::cursor_at(app, &tree) else { return Outcome::refused("the tree's cursor is on no row: name one with id=") };
            let rows = app.rows_of(&tree);
            let (id, folds) = (rows[at].id.clone(), rows[at].folds);
            let is_open = app.ui(&tree).unfolded.contains(&id);
            if open == Some(false) && !(folds && is_open) {
                let depths: Vec<usize> = rows.iter().map(|row| row.depth).collect();
                return match crate::cursor::parent_row(&depths, at) { Some(parent) => super::list::cursor_to(app, &tree, parent), None => Outcome::done() };
            }
            if !folds { return Outcome::done() }
            app.ui_mut(&tree).cursor = Some(id.clone());
            id
        }
    };
    if !app.stands(by) && open != Some(true) && app.shown().is_some_and(|page| page.ancestors.iter().any(|a| a.id == id)) {
        return Outcome::refused("the person's note is under that row: an agent doesn't fold it away");
    }
    super::list::fold(app, &tree, &id, open);
    Outcome::done()
}
