//! A tree in its tile (a list arranged as a tree): picking a row, folding one. A row is the service's; what a
//! pick runs is the row's own act line, and where its note opens is the layout's to say.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, Touches};
use super::{Action, Actor, App, Outcome, About};
use crate::actline::Args;

static PICK: ActionRow = ActionRow::new("tree.pick", Touches::Nothing, "pick a row of the outline tree by id (the door's name for list.pick in a tree: the same pick). The person's opens its note and unfolds what is under it; on the note already open it folds or unfolds instead. An agent's runs the row's act line as itself, as `open` does, and folds nothing. A row the tree doesn't list is refused, as any list's is")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it").kind("note").optional()), ("n", ArgSpec::number("the row, from 1").optional())])
    .keys(&[KeyRow::via("a press on a row of the tree")])
    .examples(&[Example { act: "tree.pick id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "opens that row's note and unfolds what is under it", safe: None }]);

static FOLD: ActionRow = ActionRow::new("tree.fold", Touches::Nothing, "open (open=true) or fold (open=false) a row of the outline tree, else the other way. An agent's never folds away the row of the note the person has open")
    .args(&[("id", ArgSpec::text("a block id: the row that stands for it").kind("note")), ("open", ArgSpec::flag("true opens, false folds; left out, the other way").optional())])
    .keys(&[KeyRow::via("a press on the open note's row in the tree")])
    .examples(&[Example { act: "tree.fold id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 open=true", does: "shows the notes under that row", safe: Some(true) }]);

// `tree.pick` is the door's name for a pick in a tree: the one pick (`list::pick`), asked of a list that is a tree.
pub static ACTIONS: &[Action] = &[Action { row: &PICK, run: super::list::pick, about: About::Tree }, Action { row: &FOLD, run: fold, about: About::Tree }];

fn fold(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let open = args.flag("open");
    let Some(tree) = app.about() else { return Outcome::refused("this screen has no tree to fold a row of") };
    if !app.stands(by) && open != Some(true) && app.shown().is_some_and(|page| page.ancestors.iter().any(|a| a.id == id)) {
        return Outcome::refused("the person's note is under that row: an agent doesn't fold it away");
    }
    super::list::fold(app, &tree, &id, open);
    Outcome::done()
}
