//! An act line, read: `note.trash`, `open id=north-bed tile=reader --as seedling-agent`. The grammar is
//! outline-core's (`lineWords`, `actRequestOf` in action-line.ts; the door's `coerceActionArgs`; `parseTileAddress`
//! in screen-spec.ts), and `fixtures/act-lines.json` holds what those answer: this file is tested against it line by
//! line, so the two readers stay one grammar. Pure: no window, no socket.
use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use crate::actions::row::{ActionRow, ArgSpec, ArgType};

/// An action refused before anything happened, in plain words.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused(pub String);

fn refused<T>(why: impl Into<String>) -> Result<T, Refused> { Err(Refused(why.into())) }

/// What a line asks: an action, in one of the screen's tiles (`tile=`), as someone, with its `key=value` words as written.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Request {
    pub action: String,
    pub tile: Option<String>,
    pub by: Option<String>,
    /// Every value as written; a word written twice is a list only when `repeats` asked for one.
    pub args: Map<String, Value>,
}

const fn closes(open: char) -> Option<char> {
    match open { '"' => Some('"'), '\'' => Some('\''), '\u{201c}' => Some('\u{201d}'), '\u{2018}' => Some('\u{2019}'), _ => None }
}

/// A line's words, quotes taken out: a quoted stretch is part of its word, a backslash keeps the next character.
pub fn line_words(line: &str) -> Vec<String> {
    let (mut out, mut word, mut in_word, mut close, mut escaped): (Vec<String>, String, bool, Option<char>, bool) = (Vec::new(), String::new(), false, None, false);
    // Inside a `{{ placeholder }}`: part of its word, spaces and quotes as written.
    let mut brace = false;
    for c in line.chars() {
        if brace && c == '\n' { brace = false }
        if brace { word.push(c); if c == '}' && word.ends_with("}}") { brace = false } continue }
        if c == '{' && close.is_none() && !escaped && word.ends_with('{') && !word.ends_with("\\{") { word.push(c); brace = true; continue }
        if escaped {
            if close.is_some_and(|q| c != q && c != '\\') || c == '{' { word.push('\\') }
            word.push(c);
            escaped = false;
            continue;
        }
        if c == '\\' && close != Some('\'') && close != Some('\u{2019}') { escaped = true; in_word = true; continue }
        if let Some(q) = close { if c == q { close = None } else { word.push(c) } continue }
        if let Some(q) = closes(c) { close = Some(q); in_word = true; continue }
        if c.is_whitespace() { if in_word { out.push(std::mem::take(&mut word)); in_word = false } continue }
        word.push(c);
        in_word = true;
    }
    if in_word { out.push(word) }
    out
}

/// The request a line's words are. `repeats`: a key written twice becomes a list (a script's slots); otherwise the last wins.
pub fn request_of(words: &[String], repeats: bool) -> Result<Request, Refused> {
    let mut rest: Vec<&str> = words.iter().map(String::as_str).collect();
    let mut leading: Vec<&str> = Vec::new();
    while matches!(rest.first(), Some(&"--as") | Some(&"--tile")) {
        let flag = rest.remove(0);
        if rest.is_empty() { return refused(format!("{flag} needs a value")) }
        leading.push(flag);
        leading.push(rest.remove(0));
    }
    if rest.is_empty() { return refused("act needs an action name; `actions` lists them") }
    let mut req = Request { action: rest.remove(0).to_string(), ..Request::default() };
    let rest: Vec<&str> = leading.into_iter().chain(rest).collect();
    let mut i = 0;
    while i < rest.len() {
        let w = rest[i];
        i += 1;
        if w == "--as" || w == "--tile" {
            let Some(v) = rest.get(i) else { return refused(format!("{w} needs a value")) };
            i += 1;
            if w == "--as" { req.by = Some(v.to_string()) } else { req.tile = Some(v.to_string()) }
            continue;
        }
        let Some(eq) = w.find('=').filter(|eq| *eq > 0) else { return refused(format!("arguments are key=value, not {}", json!(w))) };
        let (k, v) = (&w[..eq], &w[eq + 1..]);
        match k {
            "tile" => req.tile = Some(v.to_string()),
            "as" => req.by = Some(v.to_string()),
            _ if repeats && req.args.contains_key(k) => {
                let had = req.args.remove(k).unwrap();
                let mut list = match had { Value::Array(list) => list, one => vec![one] };
                list.push(json!(v));
                req.args.insert(k.to_string(), Value::Array(list));
            }
            _ => { req.args.insert(k.to_string(), json!(v)); }
        }
    }
    Ok(req)
}

/// A line read whole.
pub fn parse(line: &str) -> Result<Request, Refused> { request_of(&line_words(line), false) }

/// A request as a line again: each value quoted, so a space or a quote in one stays in it.
pub fn line_of(action: &str, args: &Map<String, Value>) -> String {
    let said = |v: &Value| match v { Value::String(s) if !s.is_empty() && !s.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') => s.clone(), Value::String(s) => json!(s).to_string(), other => other.to_string() };
    std::iter::once(action.to_string()).chain(args.iter().map(|(k, v)| format!("{k}={}", said(v)))).collect::<Vec<_>>().join(" ")
}

// ── arguments, typed by the action's row ──────────────────────────────────────────────────────────────────────

/// An action's arguments as its row types them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Args(pub BTreeMap<String, Value>);

impl Args {
    pub fn text(&self, key: &str) -> Option<&str> { self.0.get(key).and_then(Value::as_str) }
    pub fn number(&self, key: &str) -> Option<f64> { self.0.get(key).and_then(Value::as_f64) }
    pub fn flag(&self, key: &str) -> Option<bool> { self.0.get(key).and_then(Value::as_bool) }
    pub fn json(&self) -> Map<String, Value> { self.0.iter().map(|(k, v)| (k.clone(), v.clone())).collect() }
}

fn edit_distance(a: &str, b: &str) -> usize {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut last = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let now = row[j];
            row[j] = (last + usize::from(a[i - 1] != b[j - 1])).min(row[j] + 1).min(row[j - 1] + 1);
            last = now;
        }
    }
    row[b.len()]
}

/// The candidate nearest a name that isn't one, when it is near enough to be a slip (outline-core's `closest`).
pub fn closest<'a>(name: &str, candidates: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    let lower = name.to_lowercase();
    let mut best: Option<(&str, usize)> = None;
    for candidate in candidates {
        let d = edit_distance(&lower, &candidate.to_lowercase());
        if best.is_none_or(|(_, least)| d < least) { best = Some((candidate, d)) }
    }
    best.filter(|(found, d)| *d <= 2.max(name.chars().count().max(found.chars().count()) / 3)).map(|(found, _)| found)
}

fn type_label(spec: &ArgSpec) -> &'static str { match spec.ty { ArgType::String => "string", ArgType::Number => "number", ArgType::Boolean => "boolean" } }

fn placeholder(name: &str, spec: &ArgSpec) -> Value {
    match spec.ty {
        ArgType::Number => json!(1),
        ArgType::Boolean => json!(true),
        ArgType::String if name == "id" => json!("7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34"),
        ArgType::String if name == "tile" || spec.kind == Some("tile") => json!("main"),
        ArgType::String => json!("text"),
    }
}

/// A call as the refusal shows it: `ep0ch act <action> key=value…`, values as they are.
fn call_text(action: &str, args: &[(String, Value)]) -> String {
    let word = |v: &Value| match v { Value::String(s) => s.clone(), other => other.to_string() };
    format!("ep0ch act {action}{}", args.iter().map(|(k, v)| format!(" {k}={}", word(v))).collect::<String>())
}

/// A call as a correction shows it: a value with a space or a quote in it quoted.
fn shown_line(action: &str, args: &[(String, Value)]) -> String {
    let said = |v: &Value| { let s = match v { Value::String(s) => s.clone(), other => other.to_string() }; if s.is_empty() || s.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'') { json!(s).to_string() } else { s } };
    std::iter::once(action.to_string()).chain(args.iter().map(|(k, v)| format!("{k}={}", said(v)))).collect::<Vec<_>>().join(" ")
}

/// The names of a call, checked at once: a name the action doesn't take (with the nearest one it does) and every
/// argument it can't run without. The refusal is the whole answer: the problems, the arguments, a call that works.
fn checked_names(row: &ActionRow, given: &Map<String, Value>) -> Result<(), Refused> {
    let mut problems: Vec<String> = Vec::new();
    let mut fixes: Vec<(&str, &str)> = Vec::new();
    let unknown: Vec<&str> = given.keys().map(String::as_str).filter(|k| row.args.get(k).is_none()).collect();
    for key in &unknown {
        match closest(key, row.args.iter().map(|(name, _)| name)).filter(|target| !given.contains_key(*target)) {
            Some(target) => { problems.push(format!("`{key}` is not an argument of {}; did you mean `{target}`?", row.id)); fixes.push((key, target)) }
            None => problems.push(format!("`{key}` is not an argument of {}.", row.id)),
        }
    }
    for (name, spec) in row.args.iter().filter(|(name, spec)| !spec.is_optional() && !given.contains_key(*name)) {
        if fixes.iter().any(|(_, to)| *to == name) { continue }
        problems.push(format!("Missing required `{name}` ({}{}).", type_label(spec), if spec.about.is_empty() { String::new() } else { format!(": {}", spec.about) }));
    }
    if problems.is_empty() { return Ok(()) }
    let schema = row.args.iter().map(|(name, spec)| format!("{name} ({}{})", type_label(spec), if spec.is_optional() { "" } else { ", required" })).collect::<Vec<_>>().join(" · ");
    let mut lines = vec![format!("{} did not run.", row.id)];
    let corrected = fixes.len() == unknown.len() && problems.len() == fixes.len() && !fixes.is_empty();
    lines.extend(problems);
    lines.push(format!("Arguments: {}", if schema.is_empty() { "no arguments".to_string() } else { schema }));
    if corrected {
        let fixed: Vec<(String, Value)> = given.iter().map(|(k, v)| (fixes.iter().find(|(from, _)| from == k).map_or(k.as_str(), |(_, to)| to).to_string(), v.clone())).collect();
        lines.push(format!("Call it as: {}", call_text(row.id, &fixed)));
    } else {
        let example: Vec<(String, Value)> = row.args.iter().filter(|(_, spec)| !spec.is_optional()).map(|(name, spec)| (name.to_string(), placeholder(name, spec))).collect();
        lines.push(format!("Example: {}", call_text(row.id, &example)));
    }
    refused(lines.join("\n"))
}

/// A request's arguments checked (unknown, missing) and typed as the row declares them, or refused saying which.
pub fn coerce(row: &ActionRow, given: &Map<String, Value>) -> Result<Args, Refused> {
    // A word written twice reached here as a list: an argument that is declared takes the last, unless it takes many.
    let given: Map<String, Value> = given.iter().map(|(k, v)| (k.clone(), match (v, row.args.get(k)) { (Value::Array(list), Some(spec)) if !spec.many => list.last().cloned().unwrap_or(Value::Null), _ => v.clone() })).collect();
    checked_names(row, &given)?;
    let mut out: Vec<(String, Value)> = Vec::new();
    for (name, spec) in row.args.iter() {
        let Some(v) = given.get(name).filter(|v| !v.is_null()) else { continue };
        let typed = match (spec.ty, v) {
            (_, Value::Array(list)) if spec.many => json!(list.iter().map(|x| x.as_str().map_or_else(|| x.to_string(), str::to_string)).collect::<Vec<_>>()),
            (ArgType::String, Value::String(_)) => v.clone(),
            (ArgType::String, Value::Number(n)) => json!(n.to_string()),
            (ArgType::String, _) => return refused(format!("{}: {name} is text", row.id)),
            (ArgType::Number, Value::Number(_)) => v.clone(),
            (ArgType::Number, Value::String(s)) => match s.trim().parse::<f64>().ok().filter(|n| n.is_finite() && !s.trim().is_empty()) {
                Some(n) if n.fract() == 0.0 && n.abs() < 9e15 => json!(n as i64),
                Some(n) => json!(n),
                None => return refused(format!("{}: {name} is a number, not {v}", row.id)),
            },
            (ArgType::Number, _) => return refused(format!("{}: {name} is a number, not {v}", row.id)),
            (ArgType::Boolean, Value::Bool(_)) => v.clone(),
            (ArgType::Boolean, Value::String(s)) => match s.as_str() { "true" | "1" | "yes" => json!(true), "false" | "0" | "no" => json!(false), _ => return refused(format!("{}: {name} is true or false, not {v}", row.id)) },
            (ArgType::Boolean, _) => return refused(format!("{}: {name} is true or false, not {v}", row.id)),
        };
        out.push((name.to_string(), typed));
    }
    for (name, spec) in row.args.iter() {
        let Some((_, value)) = out.iter().find(|(k, _)| k == name) else { continue };
        if spec.choices.is_empty() || spec.kind.is_some() { continue }
        let said: Vec<String> = match value { Value::Array(list) => list.iter().map(|x| x.as_str().unwrap_or("").to_string()).collect(), Value::String(s) => vec![s.clone()], other => vec![other.to_string()] };
        if let Some(bad) = said.iter().find(|x| !spec.choices.contains(&x.as_str())) {
            let near = closest(bad, spec.choices.iter().copied());
            let fixed: Vec<(String, Value)> = out.iter().map(|(k, v)| if k == name { (k.clone(), json!(near.unwrap_or(spec.choices[0]))) } else { (k.clone(), v.clone()) }).collect();
            return refused(format!("{}: {name} is {}, not {bad}.{} Try: ep0ch act {}", row.id, spec.choices.join(", "), near.map_or(String::new(), |near| format!(" Did you mean {name}={near}?")), shown_line(row.id, &fixed)));
        }
    }
    Ok(Args(out.into_iter().collect()))
}

// ── tile= ─────────────────────────────────────────────────────────────────────────────────────────────────────

/// What a `tile=` is an address of (outline-core's `parseTileAddress`). A bare name, a number or a path is a name.
#[derive(Clone, Debug, PartialEq)]
pub enum Address {
    Id(String),
    Name(String),
    Role { role: String, scope: Option<String> },
    Slot { slot: String, screen: String },
    Relative(usize),
}

impl Address {
    pub fn parse(sel: &str) -> Address {
        if sel == "drawer.agent" { return Address::Role { role: "agent".into(), scope: None } }
        if !sel.is_empty() && sel.chars().all(|c| c == '^') { return Address::Relative(sel.len()) }
        let lower = sel.to_lowercase();
        if let Some(rest) = lower.strip_prefix("t-") {
            let mut chars = rest.chars();
            if chars.next().is_some_and(|c| c.is_ascii_hexdigit()) && rest.len() >= 8 && chars.all(|c| c.is_ascii_hexdigit() || c == '-') { return Address::Id(lower) }
        }
        if let Some(role) = sel.strip_prefix("role:") {
            let (role, scope) = role.split_once('@').map_or((role, None), |(role, scope)| (role, Some(scope).filter(|s| !s.is_empty())));
            // `split("@", 2)` in the door keeps only what is before a second `@`.
            let scope = scope.map(|s| s.split('@').next().unwrap_or(s).to_string());
            return Address::Role { role: role.to_string(), scope };
        }
        if let Some(at) = sel.find('@').filter(|at| *at > 0 && *at < sel.len() - 1) && !sel.contains('/') {
            return Address::Slot { slot: sel[..at].to_string(), screen: sel[at + 1..].to_string() };
        }
        Address::Name(sel.to_string())
    }

    /// As the fixture writes one (`{kind, …, text}`).
    #[cfg(test)]
    pub fn json(&self, text: &str) -> Value {
        match self {
            Address::Id(id) => json!({ "kind": "id", "id": id, "text": text }),
            Address::Name(name) => json!({ "kind": "name", "name": name, "text": text }),
            Address::Role { role, scope: Some(scope) } => json!({ "kind": "role", "role": role, "scope": scope, "text": text }),
            Address::Role { role, scope: None } => json!({ "kind": "role", "role": role, "text": text }),
            Address::Slot { slot, screen } => json!({ "kind": "slot", "slot": slot, "screen": screen, "text": text }),
            Address::Relative(up) => json!({ "kind": "relative", "up": up, "text": text }),
        }
    }
}
