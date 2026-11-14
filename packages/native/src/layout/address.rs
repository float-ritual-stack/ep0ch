//! Which tile an address names: `tile=`, `to=`, a follower's `source: tile:`. One resolver, the door's
//! (outline-core's `resolveAddress`, `resolveRelative` and `whyNone`, screen-spec.ts), rule for rule and word for
//! word: the door's answers are written down in `outline-core/fixtures/address-contract.json`, and
//! `tests/contract.rs` runs every row against `named`. The grammar itself is `actline::Address`.
use super::Id;
use crate::actline::Address;

/// A tile as the resolver reads it: what it is, never how it is shown.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Candidate {
    pub id: Id,
    pub name: String,
    /// Its role: set on the tile, else its kind.
    pub role: String,
    /// The slots it fills on its screen: its own name, and the key of each container it is in.
    pub slots: Vec<String>,
    pub screen: String,
    /// The tile that opened it: what `^` follows.
    pub from: Option<Id>,
    pub copied_from: Option<Id>,
    /// When the person last used it: of several agent tabs, `role:agent` is the one used last.
    pub used_at: Option<f64>,
    /// Where to find it, for a refusal that lists several.
    pub where_: String,
}

/// What an address names among the tiles there are.
#[derive(Clone, Debug, PartialEq)]
pub enum Named {
    /// One tile, by its place in the list.
    Tile(usize),
    /// None, and why (with what to type instead).
    None(String),
    /// A plain name: the caller's own to read, after every address.
    Name(String),
}

fn unique(words: impl Iterator<Item = String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in words { if !out.contains(&word) { out.push(word) } }
    out
}

/// The tile `sel` names among `cs`, acting from `from` (for `^`). Several is a refusal that lists them with the ids
/// to type.
pub fn named(sel: &str, cs: &[Candidate], from: Option<&str>) -> Result<Named, String> {
    let how = "role:<role>, t-<id> or <slot>@<screen>";
    let hits: Vec<usize> = match Address::parse(sel) {
        Address::Name(name) => return Ok(Named::Name(name)),
        Address::Relative(up) => {
            let Some(mut at) = from.and_then(|origin| cs.iter().position(|c| c.id == origin)) else { return Err(format!("{sel} is relative to the tile you act from, and none has your keys here; name it: {how}")) };
            for _ in 0..up {
                let Some(opener) = &cs[at].from else { return Err(format!("{sel} names the tile that opened {}, and nothing recorded opening it (a layout made it); name it: {how}", cs[at].name)) };
                let Some(next) = cs.iter().position(|c| c.id == *opener) else { return Err(format!("{sel}: the tile that opened {} ({opener}) was closed; name another: {how}", cs[at].name)) };
                at = next;
            }
            return Ok(Named::Tile(at));
        }
        Address::Id(id) => (0..cs.len()).filter(|i| cs[*i].id.starts_with(&id)).collect(),
        Address::Role { role, scope } => (0..cs.len()).filter(|i| cs[*i].role == role && scope.as_ref().is_none_or(|s| cs[*i].screen == *s)).collect(),
        Address::Slot { slot, screen } => (0..cs.len()).filter(|i| cs[*i].screen == screen && cs[*i].slots.contains(&slot)).collect(),
    };
    let address = Address::parse(sel);
    if hits.len() > 1 {
        // Several agent tabs: the one the person used last.
        if matches!(&address, Address::Role { role, .. } if role == "agent") && hits.iter().all(|i| cs[*i].used_at.is_some()) {
            return Ok(Named::Tile(hits.iter().copied().reduce(|best, i| if cs[i].used_at > cs[best].used_at { i } else { best }).expect("several")));
        }
        let list = hits.iter().map(|i| format!("{} ({})", cs[*i].where_, cs[*i].id)).collect::<Vec<_>>().join(", ");
        let or = if matches!(&address, Address::Role { scope: None, .. }) { format!(" or {sel}@<screen>") } else { String::new() };
        return Err(format!("{sel} names {} tiles: {list}; use tile=<id>{or}", hits.len()));
    }
    if let Some(hit) = hits.first() { return Ok(Named::Tile(*hit)) }
    let screens = || unique(cs.iter().map(|c| c.screen.clone())).join(", ");
    Ok(Named::None(match address {
        Address::Id(id) => {
            if let Some(copy) = cs.iter().find(|c| c.copied_from.as_ref().is_some_and(|was| was.starts_with(&id))) { return Ok(Named::None(format!("no tile has the id {sel}: it was copied to {} ({}); tile.list shows the ids", copy.where_, copy.id))) }
            let stem: String = id.chars().take(6).collect();
            let near: Vec<&str> = cs.iter().filter(|c| c.id.starts_with(&stem)).take(3).map(|c| c.id.as_str()).collect();
            format!("no tile has the id {sel}{}", if near.is_empty() { "; tile.list shows the ids".to_string() } else { format!("; did you mean {}?", near.join(", ")) })
        }
        Address::Role { role, scope } => {
            if let Some(scope) = scope.as_ref().filter(|s| !cs.iter().any(|c| c.screen == **s)) { return Ok(Named::None(format!("no screen {scope} is on show to look for role:{role} in; screens: {}", screens()))) }
            let mut roles = unique(cs.iter().map(|c| c.role.clone()));
            roles.sort();
            format!("no tile has the role {role}{}; roles here: {}", scope.map_or(String::new(), |s| format!(" on {s}")), roles.join(", "))
        }
        Address::Slot { slot, screen } => {
            let on: Vec<&Candidate> = cs.iter().filter(|c| c.screen == screen).collect();
            if on.is_empty() { return Ok(Named::None(format!("no screen {screen} is on show or mounted here; screens: {}", screens()))) }
            let slots = unique(on.iter().flat_map(|c| c.slots.iter().cloned()));
            format!("{screen} has no slot {slot}; its slots: {}", if slots.is_empty() { "none".to_string() } else { slots.join(", ") })
        }
        Address::Relative(_) | Address::Name(_) => format!("{sel} names no tile"),
    }))
}
