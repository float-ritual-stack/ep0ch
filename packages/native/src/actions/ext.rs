//! Extensions: install one, remove one, change its settings, run one of its actions. Each is the service's to do
//! (`extensions.install`, `extensions.uninstall`, `extensions.configure`, `extensions.act`), asked as whoever acts;
//! what it did is said in the service's own words. The rows a person picks these from are the service's list
//! (`lists.read from=extensions`, in the bar), each carrying the act line it runs: nothing here lists an extension.
//!
//! An extension's settings are a form drawn from its own schema (`ext::Settings`, as `extensions.list` says them):
//! `extensions.configure id=<it>` with nothing to set opens the form for the person, and answers an agent the
//! settings as they are. The form holds what is typed and nothing else; saving it is `extensions.configure` with
//! the fields that changed, so a form, a line typed in the bar and an agent's act are one write.
use serde_json::{Map, Value, json};

use super::app::{FormField, FormUi};
use super::row::{ActionRow, ArgSpec, Example, KeyRow, MenuRow, Touches};
use super::{About, Action, Actor, App, Notice, Outcome};
use crate::actline::{self, Args, FREE};
use crate::keys::Text;
use crate::store::{Ask, Reply};
use crate::tiles;

static INSTALL: ActionRow = ActionRow::new("extensions.install", Touches::Nothing, "install one of the repo's extensions on this outline's host (as ep0ch ext add <id>): the service copies it in, loads it and writes its page, with its demo notes under it, in the outline. What it adds (screens, tile kinds, actions, settings) is here once the service has listed it again")
    .args(&[("id", ArgSpec::text("the extension's id, as the bar's Extensions lists the ones not installed"))])
    .keys(&[KeyRow::via("a press on its install row in the bar's Extensions")])
    .examples(&[Example { act: "extensions.install id=waiting", does: "installs the waiting extension and writes its page", safe: None }]);

static UNINSTALL: ActionRow = ActionRow::new("extensions.uninstall", Touches::Nothing, "remove an installed extension (as ep0ch ext remove <id>): its folder goes, and its screens, tile kinds and actions with it. demo= says what becomes of its demo notes and has no default: they never go silently. Its settings are kept for a reinstall")
    .args(&[("id", ArgSpec::text("the installed extension's id")), ("demo", ArgSpec::text("keep: its demo notes stay under its page; remove: to the Trash, except the ones someone changed").choices(&["keep", "remove"]))])
    .keys(&[KeyRow::via("a press on one of its remove rows in the bar's Extensions, once its name is typed")])
    .examples(&[Example { act: "extensions.uninstall demo=keep id=waiting", does: "removes the waiting extension and leaves its demo notes in place", safe: None }]);

static CONFIGURE: ActionRow = ActionRow::new("extensions.configure", Touches::Nothing, "change an installed extension's settings: every other key=value sets the field of that name, as the extension's own schema declares it (a number is a number, true or false a flag), and unset= takes fields out, back to their defaults. The service checks the values against the schema and writes them on the outline's host. With nothing to set, the person's opens the form (a field each, as the schema says them) and an agent's answers the settings as they are")
    .args(&[
        ("id", ArgSpec::text("the installed extension's id")),
        ("unset", ArgSpec::text("the fields to take out, by name (several with commas)").optional()),
        (FREE, ArgSpec::text("any other key=value sets that field of its settings").optional()),
    ])
    .keys(&[KeyRow::via("a press on its settings row in the bar's Extensions")])
    .menu(&[MenuRow::new("Settings", "Extensions", None)])
    .examples(&[Example { act: "extensions.configure id=waiting warn-days=7", does: "waits are drawn as a warning after seven days", safe: None }]);

static ACT: ActionRow = ActionRow::new("extensions.act", Touches::Nothing, "run one of an installed extension's own actions (action=, as the extension names it), about the note a reader shows when it acts on one. Every other key=value is an argument of that action. The service runs it and records what it writes as the extension's, with who asked beside it")
    .args(&[
        ("id", ArgSpec::text("the installed extension's id")),
        ("action", ArgSpec::text("the action, by the id the extension gives it")),
        (FREE, ArgSpec::text("any other key=value is an argument of that action").optional()),
    ])
    .keys(&[KeyRow::via("a line typed in the bar, or a press on its row in the bar's Extensions once its name is typed")])
    .examples(&[Example { act: "extensions.act action=turn id=compost", does: "runs the compost extension's turn", safe: None }]);

static SAVE: ActionRow = ActionRow::new("form.save", Touches::Nothing, "save the open form: each field that was changed is set (one emptied is taken out, back to its default), by the same write a line would make. A value the service refuses keeps the form open, every word as typed, with why")
    .person("the form is the person's: an agent sets a field with extensions.configure id=… <field>=…")
    .keys(&[KeyRow::on("enter", "form", "save the form")])
    .menu(&[MenuRow::new("Save", "Form", Some("enter"))]);

static CLOSE: ActionRow = ActionRow::new("form.close", Touches::Nothing, "put the open form away, nothing saved")
    .person("the form is the person's: an agent never closes the form the person has open")
    .keys(&[KeyRow::on("escape", "form", "put the form away")])
    .menu(&[MenuRow::new("Cancel", "Form", Some("escape"))]);

pub static ACTIONS: &[Action] = &[
    Action { row: &INSTALL, run: install, about: About::Nothing }, Action { row: &UNINSTALL, run: uninstall, about: About::Nothing },
    Action { row: &CONFIGURE, run: configure, about: About::Nothing }, Action { row: &ACT, run: act, about: About::Nothing },
    Action { row: &SAVE, run: save, about: About::Nothing }, Action { row: &CLOSE, run: close, about: About::Nothing },
];

impl App {
    /// The name an extension goes by, as the service lists it: its own, else its id.
    fn named(&self, id: &str) -> String { self.extensions().map_or(id, |listed| listed.named(id)).to_string() }

    /// What the extensions serve changed by this window's own doing: their list, the screens and kinds they add and
    /// whatever each tile on screen shows (a tile one of them draws, a list of them) are read now, not when a watch says.
    fn extensions_moved(&mut self) {
        let shown: Vec<Ask> = self.shown_tiles().iter().filter_map(|tile| self.cx(tile)).filter_map(|cx| tiles::drawer_of(cx.row).map(|drawer| (drawer.asks)(&cx))).flatten().map(|(_, ask)| ask).collect();
        for ask in [self.extensions_ask(), self.screens_ask(), self.sources_ask()].into_iter().chain(shown).chain(crate::bar::asks(self)) { self.store.refresh(&ask) }
    }
}

/// What the service said it did, a line each, as one sentence for the notice.
fn lines(result: &Value) -> String { result["lines"].as_array().into_iter().flatten().filter_map(Value::as_str).collect::<Vec<_>>().join(" · ") }

fn install(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let at = app.at.clone();
    app.store.write(&at, "extensions.install", json!({ "extension": id }), by, installed, json!({ "id": id }));
    Outcome::answer(json!({ "installing": id }))
}

fn installed(app: &mut App, reply: Reply) {
    let name = app.named(reply.ctx["id"].as_str().unwrap_or(""));
    app.st.notice = Some(match reply.result {
        Err(refusal) => Notice::problem(format!("{name} wasn't installed: {}", refusal.error)),
        // Installed, and its folder doesn't load: said as the service says it.
        Ok(result) if result["error"].is_string() => Notice::problem(format!("{name} is installed but {}: {}", result["state"].as_str().unwrap_or("failed"), result["error"].as_str().unwrap_or(""))),
        Ok(result) => Notice::info(format!("Installed {name}. {}", lines(&result))),
    });
    app.extensions_moved();
}

fn uninstall(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (id, demo) = (args.text("id").unwrap_or("").to_string(), args.text("demo").unwrap_or(""));
    let at = app.at.clone();
    app.store.write(&at, "extensions.uninstall", json!({ "extension": id, "demo": demo }), by, uninstalled, json!({ "id": id }));
    Outcome::answer(json!({ "removing": id }))
}

fn uninstalled(app: &mut App, reply: Reply) {
    let name = app.named(reply.ctx["id"].as_str().unwrap_or(""));
    app.st.notice = Some(match reply.result {
        Err(refusal) => Notice::problem(format!("{name} wasn't removed: {}", refusal.error)),
        Ok(result) => Notice::info(format!("Removed {name}. {}", lines(&result))),
    });
    // A form of its settings has nothing to save to any more.
    if app.form.as_ref().is_some_and(|form| reply.ctx["id"] == form.extension.as_str()) { app.st.form = None }
    app.extensions_moved();
}

fn configure(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let id = args.text("id").unwrap_or("").to_string();
    let given: Vec<(String, Value)> = args.json().into_iter().filter(|(name, _)| CONFIGURE.args.get(name).is_none()).collect();
    let unset: Vec<String> = args.text("unset").map(|names| names.split(',').map(str::trim).filter(|name| !name.is_empty()).map(str::to_string).collect()).unwrap_or_default();
    let Some(listed) = app.extensions() else { return Outcome::refused("the extensions haven't come yet: ask again") };
    let Some(entry) = listed.entry(&id) else {
        return Outcome::refused(format!("no extension {id} is installed here · the bar's Extensions lists the ones that are{}", if listed.available.iter().any(|a| a.id == id) { format!(", and installs {id}") } else { String::new() }));
    };
    let Some(settings) = &entry.settings else { return Outcome::refused(format!("{} has no settings: its extension declares none", entry.named())) };
    if given.is_empty() && unset.is_empty() {
        // Nothing to set: an agent reads them; the person gets the form, a field each as the schema says them.
        let fields: Vec<Value> = settings.fields.iter().map(|field| json!({ "name": field.name, "type": field.ty, "about": field.about(), "value": field.value, "default": field.default, "state": field.state })).collect();
        let answer = json!({ "id": id, "state": settings.state, "file": settings.file, "fields": fields, "secrets": settings.secrets.iter().map(|secret| json!({ "name": secret.name, "state": secret.state, "reference": secret.reference })).collect::<Vec<_>>() });
        if !by.is_person() { return Outcome::answer(answer) }
        let fields = settings.fields.iter().enumerate().map(|(n, field)| FormField { name: field.name.clone(), edit: if n == 0 { super::draft::focused(&field.now()) } else { Text::new(&field.now()) }, was: field.now() }).collect();
        app.st.form = Some(FormUi { extension: id, fields, said: None });
        app.st.bar.open = false;
        return Outcome::answer(answer);
    }
    // Each word is the value its field's type says: a field the schema hasn't is refused with the ones it has.
    let mut set = Map::new();
    for (name, value) in &given {
        let Some(field) = settings.fields.iter().find(|field| field.name == *name) else {
            let near = actline::closest(name, settings.fields.iter().map(|field| field.name.as_str()));
            return Outcome::refused(format!("{} has no setting {name}{} · its settings: {}", entry.named(), near.map_or(String::new(), |near| format!("; did you mean {near}?")), settings.fields.iter().map(|field| field.name.as_str()).collect::<Vec<_>>().join(", ")));
        };
        match field.typed(&crate::ext::shown(value)) { Ok(typed) => { set.insert(name.clone(), typed); } Err(why) => return Outcome::refused(why) }
    }
    let at = app.at.clone();
    app.store.write(&at, "extensions.configure", json!({ "extension": id, "set": set, "unset": unset }), by, configured, json!({ "id": id }));
    Outcome::answer(json!({ "configuring": id, "set": set, "unset": unset }))
}

fn configured(app: &mut App, reply: Reply) {
    let id = reply.ctx["id"].as_str().unwrap_or("").to_string();
    let name = app.named(&id);
    let form = app.form.as_ref().is_some_and(|form| form.extension == id);
    match reply.result {
        // Refused: a form keeps every word as typed, with why; a line's refusal is the window's to say.
        Err(refusal) => match (&mut app.st.form, form) { (Some(open), true) => open.said = Some(refusal.error), _ => app.st.notice = Some(Notice::problem(format!("{name}'s settings weren't changed: {}", refusal.error))) },
        Ok(result) => {
            if form { app.st.form = None }
            // The settings as the service has them now, each field in its own words.
            let now = result["settings"]["fields"].as_array().into_iter().flatten().map(|field| format!("{}={}", field["name"].as_str().unwrap_or(""), match (field.get("value"), field.get("default")) { (Some(value), _) => crate::ext::shown(value), (None, Some(default)) => format!("{} (its default)", crate::ext::shown(default)), (None, None) => "unset".to_string() })).collect::<Vec<_>>().join(", ");
            app.st.notice = Some(match result["error"].as_str() { Some(error) => Notice::problem(format!("{name}'s settings are saved, and it is {}: {error}", result["state"].as_str().unwrap_or("failing"))), None => Notice::info(format!("Saved {name}'s settings: {now}.")) });
            app.extensions_moved();
        }
    }
}

fn act(app: &mut App, args: &Args, by: &Actor) -> Outcome {
    let (id, action) = (args.text("id").unwrap_or("").to_string(), args.text("action").unwrap_or("").to_string());
    let Some(listed) = app.extensions() else { return Outcome::refused("the extensions haven't come yet: ask again") };
    let Some(entry) = listed.entry(&id) else { return Outcome::refused(format!("no extension {id} is installed here · the bar's Extensions lists the ones that are")) };
    let Some(found) = entry.actions.iter().find(|a| a.id == action) else {
        return Outcome::refused(format!("{} has no action {action} · its actions: {}", entry.named(), entry.actions.iter().map(|a| a.id.as_str()).collect::<Vec<_>>().join(", ")));
    };
    let own: Map<String, Value> = args.json().into_iter().filter(|(name, _)| ACT.args.get(name).is_none()).collect();
    let (label, running) = (found.label.clone().unwrap_or_else(|| found.name.clone()), found.name.clone());
    let mut request = json!({ "extension": id, "extensionAction": action, "args": own });
    // One that acts on a note acts on the one a reader shows; the service says when it needs one and has none.
    if let Some(note) = app.subject() { request["blockId"] = json!(note) }
    let at = app.at.clone();
    app.store.write(&at, "extensions.act", request, by, acted, json!({ "label": label }));
    Outcome::answer(json!({ "running": running }))
}

fn acted(app: &mut App, reply: Reply) {
    let label = reply.ctx["label"].as_str().unwrap_or("the action").to_string();
    app.st.notice = Some(match reply.result {
        Err(refusal) => Notice::problem(format!("{label}: {}", refusal.error)),
        Ok(result) => Notice::info(match result["message"].as_str().or(result["answer"].as_str()) { Some(said) => format!("{label}: {said}"), None => format!("{label}: done.") }),
    });
    app.wrote(&[None]);
}

fn save(app: &mut App, _: &Args, by: &Actor) -> Outcome {
    let Some(form) = &app.form else { return Outcome::refused("no form is open") };
    let changed: Vec<(&str, &str)> = form.fields.iter().filter(|field| field.edit.words() != field.was).map(|field| (field.name.as_str(), field.edit.words())).collect();
    if changed.is_empty() { app.st.form = None; return Outcome { said: "nothing was changed".into(), ..Outcome::done() } }
    // One emptied goes back to its default; the rest are set, by the same action a line runs.
    let (unset, set): (Vec<_>, Vec<_>) = changed.into_iter().partition(|(_, words)| words.trim().is_empty());
    let mut args: Map<String, Value> = set.into_iter().map(|(name, words)| (name.to_string(), json!(words))).collect();
    args.insert("id".into(), json!(form.extension));
    if !unset.is_empty() { args.insert("unset".into(), json!(unset.iter().map(|(name, _)| *name).collect::<Vec<_>>().join(","))); }
    let outcome = app.act_request(actline::Request { action: CONFIGURE.id.to_string(), tile: None, by: None, args }, by.clone());
    // Words that are no value of their field never left: the form says why, and keeps them.
    if !outcome.ok && let Some(form) = &mut app.st.form { form.said = Some(outcome.said.clone()) }
    outcome
}

fn close(app: &mut App, _: &Args, _: &Actor) -> Outcome {
    if app.st.form.take().is_none() { return Outcome::refused("no form is open") }
    Outcome::done()
}
