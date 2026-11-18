//! What placement remembers between opens: the door's `PlacementMemory` (desk/placement-memory.ts). The tile each
//! tile's next open goes beside, and the tiles opened into each keyed container with the one an open there lands
//! in now. `place` reads it (`Ctx.beside`, `Ctx.opened`); whoever lands an open says where it landed, and a tile
//! that left is forgotten. Pure: no Rune, no socket.
use super::Id;

/// A container's tiles opened into it, and the one an open there lands in now.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct OpenedInto { pub ids: Vec<Id>, pub active: Option<Id> }

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Memory {
    /// The tile an open from each tile goes beside next: the reader opened beside one that is pinned or written in.
    pub beside: Vec<(Id, Id)>,
    /// Each container's record, by its key.
    pub opened: Vec<(String, OpenedInto)>,
}

impl Memory {
    /// Opens from tile `from` go beside tile `to` from now on.
    pub fn go_beside(&mut self, from: &str, to: &str) {
        match self.beside.iter_mut().find(|(f, _)| f == from) { Some(slot) => slot.1 = to.to_string(), None => self.beside.push((from.to_string(), to.to_string())) }
    }
    /// Container `key`'s record, made on its first open.
    pub fn opened_into(&mut self, key: &str) -> &mut OpenedInto {
        let at = match self.opened.iter().position(|(k, _)| k == key) { Some(at) => at, None => { self.opened.push((key.to_string(), OpenedInto::default())); self.opened.len() - 1 } };
        &mut self.opened[at].1
    }
    /// The container tile `id` was opened into, if it was.
    pub fn into_of(&self, id: &str) -> Option<&str> { self.opened.iter().find(|(_, r)| r.ids.iter().any(|x| x == id)).map(|(k, _)| k.as_str()) }
    /// The tiles that are gone are named by nothing here any more.
    pub fn keep_only(&mut self, here: &[Id]) {
        self.beside.retain(|(from, to)| here.contains(from) && here.contains(to));
        for (_, r) in &mut self.opened { r.ids.retain(|id| here.contains(id)); if r.active.as_ref().is_some_and(|a| !here.contains(a)) { r.active = None } }
    }
    /// As the layout's rules are told it (`Ctx.opened`).
    pub fn opened_said(&self) -> Vec<(String, Vec<Id>, Option<Id>)> { self.opened.iter().map(|(k, r)| (k.clone(), r.ids.clone(), r.active.clone())).collect() }
}
