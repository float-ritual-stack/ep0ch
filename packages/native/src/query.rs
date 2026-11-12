//! A question in the views' grammar, narrowed by picked values: the one writer here of a picked value as a term.
//! The rule is outline-core's (`clauseText` and `selectionQuery`, query-clauses.ts: the door's facets write a
//! selection with it, and the service a property's question): `fixtures/core-contract.json` holds what those answer
//! and `tests/contract.rs` asks every row here. Pure: no window, no socket.

/// A value as the grammar writes one: as it is when it is plain (`[\w./@*-]+`), else quoted, a backslash and a
/// quote escaped.
fn value(value: &str) -> String {
    let plain = !value.is_empty() && value.chars().all(|c| c.is_ascii_alphanumeric() || "_./@*-".contains(c));
    if plain { value.to_string() } else { format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\"")) }
}

/// One picked value as a term: `key=value`, a tag as `#tag`.
pub fn term(key: &str, picked: &str) -> String { if key == "tag" { format!("#{picked}") } else { format!("{key}={}", value(picked)) } }

/// `raw` says OR, AND or NOT as a word of its own: it is grouped before terms follow it.
fn connects(raw: &str) -> bool { raw.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).any(|word| matches!(word, "OR" | "AND" | "NOT")) }

/// `raw` narrowed by `picks` (a property and one of its values each): the values picked of one property are any of
/// them (ORed in a group), the properties all of them, and a question typed by hand stays in front, grouped when it
/// has connectives of its own.
pub fn narrowed(raw: &str, picks: &[(String, String)]) -> String {
    let mut keys: Vec<&str> = Vec::new();
    for (key, _) in picks { if !keys.contains(&key.as_str()) { keys.push(key) } }
    let terms: Vec<String> = keys.iter().map(|key| {
        let mine: Vec<String> = picks.iter().filter(|(k, _)| k == key).map(|(k, v)| term(k, v)).collect();
        if mine.len() > 1 { format!("({})", mine.join(" OR ")) } else { mine.concat() }
    }).collect();
    let raw = raw.trim();
    let front = if raw.is_empty() { None } else if !terms.is_empty() && connects(raw) { Some(format!("({raw})")) } else { Some(raw.to_string()) };
    front.into_iter().chain(terms).collect::<Vec<_>>().join(" ")
}
