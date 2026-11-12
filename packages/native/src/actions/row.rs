//! An action's row: what it says about itself, as data. The shape is outline-core's `ActionRow` (action-row.ts),
//! field for field, so a row written here and a row the door wrote (`fixtures/action-rows.json`) are one type:
//! the bar's rows, a keycap, the key table and `actions` over the control socket all read this and nothing else.
//!
//! Rows here are statics, so their text is `&'static str`; a row read from JSON keeps its text for the life of the
//! program (`leak`), which is how long a row lives.
use serde::de::{DeserializeOwned, MapAccess, Visitor};
use serde::ser::SerializeMap;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Text a row holds. An alias, so serde's derive reads it as owned text (a `&str` field would be borrowed from the input).
pub type Str = &'static str;

mod leak {
    use super::*;
    pub fn str<'de, D: Deserializer<'de>>(d: D) -> Result<Str, D::Error> { String::deserialize(d).map(|s| &*Box::leak(s.into_boxed_str())) }
    pub fn opt_str<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Str>, D::Error> { Option::<String>::deserialize(d).map(|s| s.map(|s| &*Box::leak(s.into_boxed_str()))) }
    pub fn strs<'de, D: Deserializer<'de>>(d: D) -> Result<&'static [Str], D::Error> {
        Vec::<String>::deserialize(d).map(|v| &*Box::leak(v.into_iter().map(|s| &*Box::leak(s.into_boxed_str())).collect::<Vec<Str>>().into_boxed_slice()))
    }
    pub fn slice<'de, D: Deserializer<'de>, T: DeserializeOwned + 'static>(d: D) -> Result<&'static [T], D::Error> { Vec::<T>::deserialize(d).map(|v| &*Box::leak(v.into_boxed_slice())) }
}

/// A JSON object whose keys are names (an action's arguments, a key row's arguments), in the order written.
pub struct Pairs<V: 'static>(pub &'static [(Str, V)]);

impl<V> Clone for Pairs<V> { fn clone(&self) -> Self { *self } }
impl<V> Copy for Pairs<V> {}
impl<V> Default for Pairs<V> { fn default() -> Self { Pairs(&[]) } }
impl<V: std::fmt::Debug> std::fmt::Debug for Pairs<V> { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.debug_map().entries(self.0.iter().map(|(k, v)| (k, v))).finish() } }
impl<V: PartialEq> PartialEq for Pairs<V> { fn eq(&self, other: &Self) -> bool { self.0 == other.0 } }

impl<V> Pairs<V> {
    pub fn is_empty(&self) -> bool { self.0.is_empty() }
    pub fn get(&self, key: &str) -> Option<&'static V> { self.0.iter().find(|(k, _)| *k == key).map(|(_, v)| v) }
    pub fn iter(&self) -> impl Iterator<Item = (Str, &'static V)> { self.0.iter().map(|(k, v)| (*k, v)) }
}

impl<V: Serialize> Serialize for Pairs<V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in self.0 { map.serialize_entry(k, v)? }
        map.end()
    }
}

impl<'de, V: DeserializeOwned + 'static> Deserialize<'de> for Pairs<V> {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Read<V>(std::marker::PhantomData<V>);
        impl<'de, V: DeserializeOwned + 'static> Visitor<'de> for Read<V> {
            type Value = Pairs<V>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str("an object of name: value") }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Pairs<V>, A::Error> {
                let mut out: Vec<(Str, V)> = Vec::new();
                while let Some((k, v)) = map.next_entry::<String, V>()? { out.push((Box::leak(k.into_boxed_str()), v)) }
                Ok(Pairs(Box::leak(out.into_boxed_slice())))
            }
        }
        d.deserialize_map(Read(std::marker::PhantomData))
    }
}

/// A value an argument is pressed or shown with: what a key row, a menu row or an `implies` names.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Scalar {
    Null,
    Flag(bool),
    Whole(i64),
    Number(f64),
    Text(#[serde(deserialize_with = "leak::str")] Str),
}

impl Scalar {
    /// As a word of an act line.
    pub fn word(&self) -> String {
        match self { Scalar::Null => String::new(), Scalar::Flag(b) => b.to_string(), Scalar::Whole(n) => n.to_string(), Scalar::Number(n) => n.to_string(), Scalar::Text(s) => s.to_string() }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArgType { String, Number, Boolean }

/// One argument (outline-core's `ArgSpec`): its type, whether it may be left out, what it means.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ArgSpec {
    #[serde(rename = "type")]
    pub ty: ArgType,
    /// Whether it may be left out. A row may say `false` outright; left unsaid is the same.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub optional: Option<bool>,
    #[serde(deserialize_with = "leak::str")]
    pub about: Str,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub kind: Option<Str>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub program: bool,
    #[serde(default, skip_serializing_if = "<[_]>::is_empty", deserialize_with = "leak::strs")]
    pub choices: &'static [Str],
    #[serde(default, skip_serializing_if = "<[_]>::is_empty", deserialize_with = "leak::slice")]
    pub implies: &'static [Pairs<Scalar>],
    #[serde(default, skip_serializing_if = "<[_]>::is_empty", deserialize_with = "leak::strs")]
    pub conflicts: &'static [Str],
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub of: Option<Str>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub default: Option<Str>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub context: bool,
    #[serde(rename = "doorWord", default, skip_serializing_if = "is_false")]
    pub door_word: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub many: bool,
}

fn is_false(b: &bool) -> bool { !*b }

impl ArgSpec {
    pub const fn new(ty: ArgType, about: Str) -> ArgSpec {
        ArgSpec { ty, optional: None, about, kind: None, program: false, choices: &[], implies: &[], conflicts: &[], of: None, default: None, context: false, door_word: false, many: false }
    }
    pub const fn text(about: Str) -> ArgSpec { ArgSpec::new(ArgType::String, about) }
    pub const fn number(about: Str) -> ArgSpec { ArgSpec::new(ArgType::Number, about) }
    pub const fn flag(about: Str) -> ArgSpec { ArgSpec::new(ArgType::Boolean, about) }
    pub const fn optional(mut self) -> ArgSpec { self.optional = Some(true); self }
    pub fn is_optional(&self) -> bool { self.optional == Some(true) }
    pub const fn kind(mut self, kind: Str) -> ArgSpec { self.kind = Some(kind); self }
    pub const fn choices(mut self, choices: &'static [Str]) -> ArgSpec { self.choices = choices; self }
}

/// What an action touches of the person's: the one actor rule, checked by the dispatcher before the action runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Touches { Nothing, Tile, Shape, Draft, Screen }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum While { Focused, Typing }

/// One way to press an action: its keys and what they do, or a way that is no key at all.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum KeyRow {
    Keys {
        #[serde(deserialize_with = "leak::str")]
        keys: Str,
        #[serde(deserialize_with = "leak::str")]
        does: Str,
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
        says: Option<Str>,
        /// The place these keys are that place's own. Here: the whereabouts layer (`bar`, `draft`, `tile`).
        #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
        on: Option<Str>,
        #[serde(default, skip_serializing_if = "Pairs::is_empty")]
        args: Pairs<Scalar>,
    },
    Via {
        #[serde(deserialize_with = "leak::str")]
        via: Str,
    },
}

impl KeyRow {
    pub const fn keys(keys: Str, does: Str) -> KeyRow { KeyRow::Keys { keys, does, says: None, on: None, args: Pairs(&[]) } }
    pub const fn on(keys: Str, on: Str, does: Str) -> KeyRow { KeyRow::Keys { keys, does, says: None, on: Some(on), args: Pairs(&[]) } }
    pub const fn with(keys: Str, on: Option<Str>, does: Str, args: &'static [(Str, Scalar)]) -> KeyRow { KeyRow::Keys { keys, does, says: None, on, args: Pairs(args) } }
    pub const fn via(via: Str) -> KeyRow { KeyRow::Via { via } }
}

/// An action's keys: rows, or one line that reads cleanly as them.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Keys {
    Line(#[serde(deserialize_with = "leak::str")] Str),
    Rows(#[serde(deserialize_with = "leak::slice")] &'static [KeyRow]),
}

impl Keys {
    pub fn rows(&self) -> &'static [KeyRow] { match self { Keys::Rows(rows) => rows, Keys::Line(_) => &[] } }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct MenuRow {
    #[serde(deserialize_with = "leak::str")]
    pub label: Str,
    #[serde(deserialize_with = "leak::str")]
    pub group: Str,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub key: Option<Str>,
    /// The arguments the row runs the action with, when it has any to say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Pairs<Scalar>>,
}

impl MenuRow {
    /// A row that runs the action as it is.
    pub const fn new(label: Str, group: Str, key: Option<Str>) -> MenuRow { MenuRow { label, group, key, args: None } }
    /// A row that runs it with arguments.
    pub const fn with(label: Str, group: Str, key: Option<Str>, args: &'static [(Str, Scalar)]) -> MenuRow { MenuRow { label, group, key, args: Some(Pairs(args)) } }
    pub fn args(&self) -> Pairs<Scalar> { self.args.unwrap_or_default() }
}

/// A real call of an action and what it does.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Example {
    #[serde(deserialize_with = "leak::str")]
    pub act: Str,
    #[serde(deserialize_with = "leak::str")]
    pub does: Str,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub safe: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct AnswerField {
    #[serde(rename = "type", deserialize_with = "leak::str")]
    pub ty: Str,
    #[serde(deserialize_with = "leak::str")]
    pub about: Str,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub kind: Option<Str>,
}

/// An action as data, under the id `act` runs it by.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ActionRow {
    /// The set it belongs to, where a listing says one (the door's fixture does).
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "leak::opt_str")]
    pub scope: Option<Str>,
    #[serde(deserialize_with = "leak::str")]
    pub id: Str,
    #[serde(deserialize_with = "leak::str")]
    pub summary: Str,
    pub args: Pairs<ArgSpec>,
    pub touches: Touches,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keys: Option<Keys>,
    #[serde(rename = "while", default, skip_serializing_if = "Option::is_none")]
    pub while_: Option<While>,
    #[serde(default, skip_serializing_if = "<[_]>::is_empty", deserialize_with = "leak::slice")]
    pub menu: &'static [MenuRow],
    #[serde(default, skip_serializing_if = "<[_]>::is_empty", deserialize_with = "leak::slice")]
    pub examples: &'static [Example],
    #[serde(default, skip_serializing_if = "Pairs::is_empty")]
    pub answer: Pairs<AnswerField>,
}

impl ActionRow {
    /// A row with nothing but its name, what it does and what it touches: the rest is added by field.
    pub const fn new(id: Str, touches: Touches, summary: Str) -> ActionRow {
        ActionRow { scope: None, id, summary, args: Pairs(&[]), touches, keys: None, while_: None, menu: &[], examples: &[], answer: Pairs(&[]) }
    }
    pub const fn args(mut self, args: &'static [(Str, ArgSpec)]) -> ActionRow { self.args = Pairs(args); self }
    pub const fn keys(mut self, keys: &'static [KeyRow]) -> ActionRow { self.keys = Some(Keys::Rows(keys)); self }
    pub const fn typing(mut self) -> ActionRow { self.while_ = Some(While::Typing); self }
    pub const fn menu(mut self, menu: &'static [MenuRow]) -> ActionRow { self.menu = menu; self }
    pub const fn examples(mut self, examples: &'static [Example]) -> ActionRow { self.examples = examples; self }

    pub fn key_rows(&self) -> &'static [KeyRow] { self.keys.map_or(&[], |keys| keys.rows()) }
    /// The arguments it can't run without.
    pub fn required(&self) -> impl Iterator<Item = Str> { self.args.iter().filter(|(_, spec)| !spec.is_optional()).map(|(name, _)| name) }
}
