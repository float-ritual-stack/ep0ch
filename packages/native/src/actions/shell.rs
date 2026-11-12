//! The window's own parts: its two docks, and the notice above the note.
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Scalar, Touches};
use super::{Action, Actor, App, Outcome};
use crate::actline::Args;

static DOCK: ActionRow = ActionRow::new("dock.toggle", Touches::Screen, "show or hide a dock: the outline's tree on the left, what the service knows about the open note on the right")
    .args(&[("side", ArgSpec::text("left (the tree) or right (the details)").choices(&["left", "right"]))])
    .keys(&[
        KeyRow::with("mod+shift+b", None, "show or hide the tree", &[("side", Scalar::Text("left"))]),
        KeyRow::with("mod+i", None, "show or hide the details", &[("side", Scalar::Text("right"))]),
    ])
    .menu(&[
        MenuRow::with("Outline", "Window", Some("mod+shift+b"), &[("side", Scalar::Text("left"))]),
        MenuRow::with("Details", "Window", Some("mod+i"), &[("side", Scalar::Text("right"))]),
    ])
    .examples(&[Example { act: "dock.toggle side=right", does: "shows or hides the details", safe: Some(true) }]);

static DISMISS: ActionRow = ActionRow::new("notice.dismiss", Touches::Nothing, "take away the notice above the note. The person's: an agent's own notices go when the person has read them")
    .keys(&[KeyRow::on("escape", "tile", "dismiss the notice")])
    .menu(&[MenuRow::new("Dismiss", "Window", Some("escape"))]);

pub static ACTIONS: &[Action] = &[Action { row: &DOCK, run: dock }, Action { row: &DISMISS, run: dismiss }];

fn dock(app: &mut App, args: &Args, _: &Actor) -> Outcome {
    if args.text("side") == Some("left") { app.st.sidebar.toggle() } else { app.st.inspector.toggle() }
    Outcome::done()
}

fn dismiss(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    if !by.is_person() { return Outcome::refused("the notice is the person's to dismiss") }
    if app.notice.is_none() { return Outcome::refused("there is no notice to dismiss") }
    app.st.notice = None;
    Outcome::done()
}
