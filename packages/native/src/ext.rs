//! The outline's extensions, as the service lists them (`extensions.list`), held in the store like any answer.
//!
//! - **What an extension is and adds is the service's word.** Its name, its state, the screens, tile kinds, actions
//!   and bar sources it serves, and its settings as its own schema says them: this file reads the answer and writes
//!   nothing of its own about any extension, and names none.
//! - **Each thing an extension adds is a row** (`Part`): what kind of thing it is, the name it goes by and what it
//!   says of itself. `peek` and `actions` over the control socket list the rows; nothing else restates them.
//! - **A setting's form is its schema.** A field's name, its type, what it means, its choices, what it has now and
//!   what it does when left out are `SettingField`'s, as outline-core's `ExtensionSettingField` says them. What is
//!   typed in a form is read back as the type its field says (`typed`), so `extensions.configure` is sent values,
//!   never words to guess at; the service checks them against the schema and says what is wrong.
//!
//! No Rune, and nothing drawn: `bar.rs` draws the form, the list drawer the bar's rows.
use serde::Deserialize;
use serde_json::{Value, json};

/// `extensions.list`'s answer, as far as this window reads it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Extensions {
    #[serde(default)]
    pub extensions: Vec<Entry>,
    /// The repo's extensions that aren't installed here.
    #[serde(default)]
    pub available: Vec<Available>,
}

/// One the repo has and this outline hasn't.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Available {
    pub id: String,
    #[serde(default)]
    pub name: String,
}

/// One extension here: what it is, how it stands, and what it adds.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Entry {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub settings: Option<Settings>,
    #[serde(default)]
    screens: Vec<Value>,
    #[serde(default)]
    tiles: Vec<Value>,
    #[serde(default)]
    pub actions: Vec<ActionEntry>,
    #[serde(default)]
    bar: Vec<Value>,
}

/// An action an extension declares, as the service names it (`ext.<extension>.<id>`).
#[derive(Clone, Debug, Default, Deserialize)]
pub struct ActionEntry {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// An extension's settings (outline-core's `ExtensionSettings`): the file they live in on the host, each field and
/// secret, and how they stand.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub fields: Vec<SettingField>,
    #[serde(default)]
    pub secrets: Vec<SettingSecret>,
    #[serde(default)]
    pub error: Option<String>,
}

/// One setting, as the schema declares it and config.json has it.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SettingField {
    pub name: String,
    /// string, number, integer, boolean, command (a command's words), or json.
    #[serde(rename = "type", default)]
    pub ty: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub choices: Vec<Value>,
    #[serde(default)]
    pub default: Option<Value>,
    #[serde(default)]
    pub value: Option<Value>,
    /// set, default, unset or missing.
    #[serde(default)]
    pub state: String,
}

/// A secret an extension declares: where its value comes from, never the value.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct SettingSecret {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub reference: Option<String>,
    #[serde(default)]
    pub state: String,
}

/// A value as a field shows it and a person types it: text as it is, anything else as JSON writes it.
pub fn shown(value: &Value) -> String { value.as_str().map_or_else(|| value.to_string(), str::to_string) }

impl SettingField {
    /// What the field shows when a form opens: what config.json has, else nothing (its default is said beside it).
    pub fn now(&self) -> String { self.value.as_ref().map(shown).unwrap_or_default() }

    /// What is said under the field: what it means, what it takes, and what it does when left out.
    pub fn about(&self) -> String {
        let takes = if self.choices.is_empty() { self.ty.clone() } else { self.choices.iter().map(shown).collect::<Vec<_>>().join(", ") };
        let left = match (&self.default, self.required) { (Some(default), _) => format!("left empty: {}", shown(default)), (None, true) => "needed".to_string(), (None, false) => "left empty: unset".to_string() };
        [self.description.clone().unwrap_or_default(), takes, left].into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join(" · ")
    }

    /// Words typed in the field, as the value its type says: a number is a number, true or false a flag, a command
    /// its words, json whatever it reads as. Words that are no such value are refused with what the field takes;
    /// whether the value is one the schema allows is the service's to say.
    pub fn typed(&self, words: &str) -> Result<Value, String> {
        let words = words.trim();
        match self.ty.as_str() {
            "number" => words.parse::<f64>().ok().filter(|n| n.is_finite()).map(|n| json!(n)).ok_or_else(|| format!("{} is a number, not {words}", self.name)),
            "integer" => words.parse::<i64>().map(|n| json!(n)).map_err(|_| format!("{} is a whole number, not {words}", self.name)),
            "boolean" => match words { "true" | "yes" | "1" => Ok(json!(true)), "false" | "no" | "0" => Ok(json!(false)), _ => Err(format!("{} is true or false, not {words}", self.name)) },
            "command" | "json" => serde_json::from_str::<Value>(words).or_else(|e| if self.ty == "command" { Ok(json!(words.split_whitespace().collect::<Vec<_>>())) } else { Err(format!("{} is JSON, and {words} doesn't read as it: {e}", self.name)) }),
            _ => Ok(json!(words)),
        }
    }
}

/// One thing an extension adds, as a row: what kind of thing, the name it goes by, and what it says of itself.
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub extension: String,
    /// `screen`, `kind`, `action`, `bar source` or `setting`.
    pub part: &'static str,
    pub name: String,
    pub about: String,
}

impl Part {
    pub fn json(&self) -> Value { json!({ "extension": self.extension, "part": self.part, "name": self.name, "about": self.about }) }
}

impl Entry {
    /// The name it goes by: its own, else its id.
    pub fn named(&self) -> &str { self.name.as_deref().unwrap_or(&self.id) }

    /// Everything it adds, a row each, in the order it lists them: its screens, its tile kinds, its actions, its
    /// bar sources, its settings.
    pub fn parts(&self) -> Vec<Part> {
        let text = |v: &Value, key: &str| v[key].as_str().unwrap_or_default().to_string();
        let part = |part: &'static str, name: String, about: String| Part { extension: self.id.clone(), part, name, about };
        let mut parts: Vec<Part> = Vec::new();
        parts.extend(self.screens.iter().map(|screen| part("screen", text(screen, "name"), text(screen, "title"))));
        parts.extend(self.tiles.iter().map(|tile| part("kind", text(tile, "kind"), text(tile, "description"))));
        parts.extend(self.actions.iter().map(|action| part("action", action.name.clone(), action.description.clone().or_else(|| action.label.clone()).unwrap_or_default())));
        parts.extend(self.bar.iter().map(|source| part("bar source", text(source, "name"), text(source, "description"))));
        if let Some(settings) = &self.settings {
            parts.extend(settings.fields.iter().map(|field| part("setting", field.name.clone(), field.about())));
            parts.extend(settings.secrets.iter().map(|secret| part("setting", secret.name.clone(), secret.description.clone().unwrap_or_default())));
        }
        parts
    }
}

impl Extensions {
    /// An installed extension, by its id.
    pub fn entry(&self, id: &str) -> Option<&Entry> { self.extensions.iter().find(|entry| entry.id == id && entry.state != "shadowed") }
    /// The name an extension goes by, installed or not: its own, else the id asked.
    pub fn named<'a>(&'a self, id: &'a str) -> &'a str { self.entry(id).map(Entry::named).or_else(|| self.available.iter().find(|a| a.id == id).map(|a| a.name.as_str()).filter(|name| !name.is_empty())).unwrap_or(id) }
    /// Everything the installed extensions add, a row each.
    pub fn parts(&self) -> Vec<Part> { self.extensions.iter().filter(|entry| entry.state != "shadowed").flat_map(Entry::parts).collect() }
}
