//! The window's own notice, above its tiles.
use super::row::{ActionRow, KeyRow, MenuRow, Touches};
use super::{Action, Actor, App, Outcome};
use crate::actline::Args;

static DISMISS: ActionRow = ActionRow::new("notice.dismiss", Touches::Nothing, "take away the notice above the tiles. The person's: an agent's own notices go when the person has read them")
    .person("the notice is the person's to dismiss")
    .keys(&[KeyRow::on("escape", "tile", "dismiss the notice")])
    .menu(&[MenuRow::new("Dismiss", "Window", Some("escape"))]);

pub static ACTIONS: &[Action] = &[Action { row: &DISMISS, run: dismiss }];

fn dismiss(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    if app.notice.is_none() { return Outcome::refused("there is no notice to dismiss") }
    app.st.notice = None;
    Outcome::done()
}
