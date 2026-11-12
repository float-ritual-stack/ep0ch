//! Every read and every write the window makes, in one place.
//!
//! - **An `Ask` is a question**: an outline (and its machine), a wire action, its parameters, and whether the
//!   service should say when the answer moves. Equal asks share one slot, whoever wants them: two tiles on one
//!   note read it once.
//! - **A slot only ever holds the answer to its own ask.** There is no "is this answer still for what's on
//!   screen?": what a tile shows is the slot of what it wants now, and `last` is the answer it showed before,
//!   kept so the tile never blanks while the next one is on its way.
//! - **Tiles are a slot's users.** `want` is told everything wanted now; a slot nobody wants keeps its answer and
//!   gives up its watch for the next ask that needs one.
//! - **The budget is the service's**: 64 watched answers a connection (`WATCH_LIMITS`). A watch is a key the
//!   service keeps an answer under, and asking another question under a key replaces it, so the store owns 64
//!   keys a link and hands them out. Past the budget an ask is read unwatched and registered when a key is free;
//!   one the service dropped is asked again when next wanted.
//! - **A write is a request with a continuation**: `write` stamps who it is recorded as, and the answer comes back
//!   from `take` with the function that goes on from it.
use std::any::Any;
use std::cell::OnceCell;
use std::collections::{BTreeSet, HashMap};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::actions::{Actor, Then};
use crate::client::Link;

/// How many watched answers the service keeps for one connection (outline-core's `WATCH_LIMITS.perConnection`).
pub const WATCH_BUDGET: usize = 64;
/// The event a script's act arrives as (outline-core's `ScriptActionCall`, the service's `scripts.act`).
const SCRIPT_ACT: &str = "scripts.act";
/// The event a script run's end arrives as (outline-core's `ScriptEnded`).
const SCRIPT_ENDED: &str = "scripts.ended";
/// How many answers nobody shows are kept for `last` and a quick return.
const IDLE_KEPT: usize = 128;

/// Which outline, by the name it was reached under: on this machine's host (`machine` empty) or another's.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct OutlineAt {
    pub outline: String,
    pub machine: String,
}

/// A question for the service.
#[derive(Clone, Debug, PartialEq)]
pub struct Ask {
    pub at: OutlineAt,
    pub action: String,
    pub params: Value,
    pub watch: bool,
}

/// An ask's identity: equal asks have equal keys.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct AskKey(String);

/// JSON with every object's keys in order, so two spellings of one question are one key.
fn canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 { out.push(',') }
                out.push_str(&json!(k).to_string());
                out.push(':');
                canonical(&map[k], out);
            }
            out.push('}');
        }
        Value::Array(list) => {
            out.push('[');
            for (i, x) in list.iter().enumerate() { if i > 0 { out.push(',') } canonical(x, out) }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

impl Ask {
    /// A read answered once.
    pub fn read(at: &OutlineAt, action: &str, params: Value) -> Ask { Ask { at: at.clone(), action: action.to_string(), params, watch: false } }
    /// A read the service says moved.
    pub fn watched(at: &OutlineAt, action: &str, params: Value) -> Ask { Ask { watch: true, ..Ask::read(at, action, params) } }

    pub fn key(&self) -> AskKey {
        let mut key = format!("{}\u{0}{}\u{0}{}\u{0}{}\u{0}", self.at.outline, self.at.machine, self.action, if self.watch { "w" } else { "" });
        canonical(&self.params, &mut key);
        AskKey(key)
    }

    fn json(&self) -> Value { json!({ "outline": self.at.outline, "machine": self.at.machine, "action": self.action, "params": self.params, "watch": self.watch }) }
}

/// A tile that shows an answer, and what the answer is to it (`page`, `level`, `rows`): `last` is kept by both.
pub type User = (String, &'static str);

/// One thing wanted now: `tile` shows the answer to `ask` as its `role`.
#[derive(Clone, Debug)]
pub struct Want {
    pub tile: String,
    pub role: &'static str,
    pub ask: Ask,
}

/// The service's no, in its words.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub kind: String,
    pub error: String,
}

#[derive(Clone, Debug, PartialEq)]
enum Fresh {
    /// The answer held is the service's newest, as far as it has said.
    Yes,
    /// It moved to this generation while nobody showed it: read by that generation when next wanted.
    Moved(Value),
    /// Nothing says it is still true (never asked, the link was made again, its watch went to another ask).
    No,
}

struct Slot {
    ask: Ask,
    users: BTreeSet<User>,
    /// The newest answer the service gave.
    answer: Option<Value>,
    /// Its no to the newest read, when that was refused: an answer from before stays to be shown.
    refused: Option<Refusal>,
    /// The answer read as the type its drawer wants, once.
    typed: OnceCell<Option<Box<dyn Any>>>,
    /// Counts the answers that landed: what a tile's memo will be versioned by, and what `peek` says of it.
    epoch: u64,
    /// The request out for it.
    out: Option<String>,
    /// The key the service keeps it under.
    watch: Option<usize>,
    fresh: Fresh,
    /// When it was last wanted, in wants.
    touched: u64,
}

/// What a request out was.
enum Out {
    Read(AskKey),
    Reply { at: OutlineAt, then: Then, ctx: Value, by: Actor },
}

/// A write's or a one-off read's answer, with what goes on from it.
pub struct Reply {
    pub then: Then,
    /// What the asker kept for its continuation (the note, its parent).
    pub ctx: Value,
    pub by: Actor,
    pub result: Result<Value, Refusal>,
}

/// What `take` landed.
pub enum Landed {
    /// A slot has a new answer.
    Answer(AskKey),
    Reply(Reply),
    /// A link ended; `detail` says how.
    Lost { detail: String },
    /// The service asks this window to run an action for a script (a `script` event aimed at this client): the
    /// dispatcher runs it and `answer` says how it went.
    Call { at: OutlineAt, call: Call },
    /// A script run ended (the service's `scripts.ended`): which, how, and its last word.
    Ended { run: String, reason: String, message: String },
}

/// An action a script asks this window to run (outline-core's `ScriptActionCall`), as the wire said it.
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    /// What `answer` names it by.
    pub request: String,
    pub action: String,
    pub args: Map<String, Value>,
    /// Who the call is: the script, by the id the service records it under.
    pub script: String,
    /// The run is the person's own press: its acts are theirs.
    pub pressed: bool,
    /// The tile an agent's press was asked from, when it named one.
    pub tile: Option<String>,
}

impl Call {
    fn read(call: &Value) -> Option<Call> {
        Some(Call {
            request: call["requestId"].as_str()?.to_string(),
            action: call["action"].as_str().unwrap_or("").to_string(),
            args: call["args"].as_object().cloned().unwrap_or_default(),
            script: call["actor"]["actorId"].as_str().unwrap_or("script").to_string(),
            pressed: call["requestedBy"]["author"] == "user",
            tile: call["at"]["tile"].as_str().map(str::to_string),
        })
    }
}

struct Wire {
    link: Box<dyn Link>,
    /// The watch keys of this connection: which slot each is registered for.
    keys: Vec<Option<AskKey>>,
}

#[derive(Default)]
pub struct Store {
    wires: HashMap<OutlineAt, Wire>,
    slots: HashMap<AskKey, Slot>,
    /// What is wanted now, in the order it was said: asks go out in it.
    order: Vec<AskKey>,
    /// The answer each user showed last.
    shown: HashMap<User, AskKey>,
    out: HashMap<String, Out>,
    next: u64,
    tick: u64,
    /// A headless render steps a virtual clock: each ask waits for its answer, so a frame shows what it asked for.
    pub blocking: bool,
    /// Who the person's writes are recorded as.
    person: String,
    /// The name this window is registered under on each link: what a script's act is aimed at.
    client: String,
}

impl Store {
    pub fn new() -> Store {
        static WINDOWS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = WINDOWS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Store { person: "ep0ch-native".into(), client: format!("native-{}-{n}", std::process::id()), ..Store::default() }
    }

    /// The name this window is registered under: a press names it, so a script's acts come back here.
    pub fn client(&self) -> &str { &self.client }

    /// Registers this window on a link as a client that runs actions (`events.subscribe`): the service then sends
    /// it the acts of the scripts it started and how each run ended, and nothing else of the event feed.
    pub fn register(&mut self, at: &OutlineAt) {
        let client = json!({ "clientId": self.client, "role": "observer", "contextId": self.client, "app": "native" });
        self.send(at, "events.subscribe", json!({ "client": client, "kinds": [SCRIPT_ACT, SCRIPT_ENDED] }));
    }

    /// Answers a script's act (`scripts.answer`): what the action answered, or why it didn't run.
    pub fn answer(&mut self, at: &OutlineAt, request: &str, result: Result<Value, String>) {
        let mut said = json!({ "requestId": request, "clientId": self.client });
        match result { Ok(result) => said["result"] = result, Err(error) => said["error"] = json!(error) }
        self.send(at, "scripts.answer", said);
    }

    /// The link to an outline's host: made, or made again (its watches and whatever was out ended with the old one).
    pub fn link(&mut self, at: &OutlineAt, link: Box<dyn Link>) {
        self.wires.insert(at.clone(), Wire { link, keys: vec![None; WATCH_BUDGET] });
        self.out.retain(|_, out| match out { Out::Read(key) => self.slots.get(key).is_none_or(|slot| slot.ask.at != *at), Out::Reply { at: theirs, .. } => theirs != at });
        for slot in self.slots.values_mut().filter(|slot| slot.ask.at == *at) {
            slot.out = None;
            slot.watch = None;
            slot.fresh = Fresh::No;
        }
    }

    pub fn set_waker(&mut self, waker: rune::Waker) { for wire in self.wires.values_mut() { wire.link.set_waker(waker.clone()) } }

    /// Who the person's writes are recorded as (`ep0ch-native:<the host's machine>`).
    pub fn set_person(&mut self, actor_id: String) { self.person = actor_id }

    // ── reading ─────────────────────────────────────────────────────────────────────────────────────────────

    /// The service's no to this ask.
    pub fn refusal(&self, ask: &Ask) -> Option<&Refusal> { self.slots.get(&ask.key()).and_then(|slot| slot.refused.as_ref()) }

    /// The answer to exactly this ask, read as `T` (once: a slot keeps it).
    pub fn read<T: DeserializeOwned + 'static>(&self, ask: &Ask) -> Option<&T> { self.decoded(&ask.key()) }

    /// The answer `tile` showed last as `role`, whatever it answered: what stays, dimmed, while the wanted one is on its way.
    pub fn last<T: DeserializeOwned + 'static>(&self, tile: &str, role: &'static str) -> Option<&T> { self.decoded(self.shown.get(&(tile.to_string(), role))?) }

    fn decoded<T: DeserializeOwned + 'static>(&self, key: &AskKey) -> Option<&T> {
        let slot = self.slots.get(key)?;
        let value = slot.answer.as_ref()?;
        slot.typed.get_or_init(|| serde_json::from_value::<T>(value.clone()).ok().map(|t| Box::new(t) as Box<dyn Any>)).as_ref()?.downcast_ref::<T>()
    }

    /// How many answers have landed for this ask: what follows from an answer is done once for each.
    pub fn epoch(&self, ask: &Ask) -> u64 { self.slots.get(&ask.key()).map_or(0, |slot| slot.epoch) }

    /// Nothing has answered this ask yet, with an answer or a no.
    pub fn waiting(&self, ask: &Ask) -> bool { self.slots.get(&ask.key()).is_none_or(|slot| slot.answer.is_none() && slot.refused.is_none()) }

    // ── wanting ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Everything wanted now. A slot nobody names any more keeps its answer and frees its watch for the next ask;
    /// whatever is wanted and not yet asked (or asked before something changed) is asked.
    pub fn want(&mut self, wants: Vec<Want>) {
        self.tick += 1;
        for slot in self.slots.values_mut() { slot.users.clear() }
        self.order.clear();
        for want in wants {
            let key = want.ask.key();
            let slot = self.slots.entry(key.clone()).or_insert_with(|| Slot { ask: want.ask, users: BTreeSet::new(), answer: None, refused: None, typed: OnceCell::new(), epoch: 0, out: None, watch: None, fresh: Fresh::No, touched: 0 });
            let user = (want.tile, want.role);
            if slot.answer.is_some() { self.shown.insert(user.clone(), key.clone()); }
            slot.users.insert(user);
            slot.touched = self.tick;
            if !self.order.contains(&key) { self.order.push(key) }
        }
        self.pump();
        self.forget();
    }

    fn pump(&mut self) {
        for key in self.order.clone() {
            let Some(slot) = self.slots.get(&key) else { continue };
            if slot.out.is_some() { continue }
            // Answered but not kept by the service (read past the budget, or dropped): registered when a key is free.
            // A question the service refused is not asked again until something changes.
            let unregistered = slot.ask.watch && slot.watch.is_none() && slot.refused.is_none() && self.free_key(&slot.ask.at).is_some();
            let unanswered = slot.answer.is_none() && slot.refused.is_none();
            if unanswered || slot.fresh != Fresh::Yes || unregistered { self.send_read(&key, true) }
        }
    }

    /// A watch key of `at`'s connection nobody shows the answer of: one never used, else the one wanted longest ago.
    fn free_key(&self, at: &OutlineAt) -> Option<usize> {
        let wire = self.wires.get(at)?;
        wire.keys.iter().position(Option::is_none).or_else(|| {
            wire.keys.iter().enumerate().filter_map(|(i, held)| self.slots.get(held.as_ref()?).filter(|slot| slot.users.is_empty()).map(|slot| (slot.touched, i))).min().map(|(_, i)| i)
        })
    }

    /// Sends the read of a slot. `kept`: as the watched answer the service keeps (registered, or read by the
    /// generation it moved to); otherwise read now and not kept.
    fn send_read(&mut self, key: &AskKey, kept: bool) {
        let Some(slot) = self.slots.get(key) else { return };
        let (at, mut request) = (slot.ask.at.clone(), slot.ask.params.clone());
        if !request.is_object() { request = json!({}) }
        if kept && slot.ask.watch {
            let held = slot.watch.or_else(|| self.free_key(&at));
            if let Some(index) = held {
                // The key's last ask loses its watch: the service keeps one question a key.
                if let Some(wire) = self.wires.get_mut(&at) && let Some(before) = wire.keys[index].replace(key.clone()).filter(|before| before != key) && let Some(old) = self.slots.get_mut(&before) {
                    old.watch = None;
                    old.fresh = Fresh::No;
                }
                request["watch"] = json!(format!("w{index}"));
                let slot = self.slots.get_mut(key).unwrap();
                if slot.watch == Some(index) && let Fresh::Moved(generation) = &slot.fresh { request["generation"] = generation.clone() }
                slot.watch = Some(index);
            }
        }
        let action = self.slots[key].ask.action.clone();
        let id = self.send(&at, &action, request);
        self.out.insert(id.clone(), Out::Read(key.clone()));
        if kept && let Some(slot) = self.slots.get_mut(key) { slot.out = Some(id) }
    }

    /// Reads an ask's answer now, unwatched: after this window's own write, when the kept answer is the one from before it.
    pub fn refresh(&mut self, ask: &Ask) {
        let key = ask.key();
        if self.slots.contains_key(&key) { self.send_read(&key, false) }
    }

    /// Idle answers past the number kept are forgotten, oldest first; one a tile showed last stays.
    fn forget(&mut self) {
        let mut idle: Vec<(u64, AskKey)> = self.slots.iter().filter(|(_, slot)| slot.users.is_empty() && slot.out.is_none()).map(|(key, slot)| (slot.touched, key.clone())).collect();
        if idle.len() <= IDLE_KEPT { return }
        idle.sort();
        let shown: BTreeSet<&AskKey> = self.shown.values().collect();
        let gone: Vec<AskKey> = idle[..idle.len() - IDLE_KEPT].iter().map(|(_, key)| key.clone()).filter(|key| !shown.contains(key)).collect();
        for key in gone {
            if let Some(slot) = self.slots.remove(&key) && let (Some(index), Some(wire)) = (slot.watch, self.wires.get_mut(&slot.ask.at)) { wire.keys[index] = None }
        }
    }

    // ── asking once, and writing ────────────────────────────────────────────────────────────────────────────

    fn send(&mut self, at: &OutlineAt, action: &str, mut request: Value) -> String {
        self.next += 1;
        let id = format!("n{}", self.next);
        request["id"] = json!(id);
        request["action"] = json!(action);
        request["outline"] = json!(at.outline);
        match self.wires.get_mut(at) {
            Some(wire) => {
                wire.link.send(&request);
                if self.blocking { wire.link.wait(&id, Duration::from_secs(20)) }
            }
            None => {}
        }
        id
    }

    /// One request whose answer goes on in `then` (with `ctx`, what the asker kept for it).
    pub fn request(&mut self, at: &OutlineAt, action: &str, params: Value, by: &Actor, then: Then, ctx: Value) {
        let id = self.send(at, action, params);
        self.out.insert(id, Out::Reply { at: at.clone(), then, ctx, by: by.clone() });
    }

    /// A write, recorded as whoever acts: the person as this window (`author: user`), an agent as itself.
    pub fn write(&mut self, at: &OutlineAt, action: &str, mut params: Value, by: &Actor, then: Then, ctx: Value) {
        let (author, actor_id) = match by { Actor::Person => ("user", self.person.clone()), Actor::Agent(id) => ("agent", id.clone()) };
        if action == "create" {
            // The store records who made a block: a person's names no client, an agent's names the agent.
            params["author"] = json!(author);
            if let Actor::Agent(id) = by { params["provenance"] = json!({ "actorId": id }) }
        } else {
            params["mutation"] = json!({ "author": author, "actorId": actor_id });
        }
        self.request(at, action, params, by, then, ctx);
    }

    /// A write of `action` is out.
    pub fn out_for(&self, then: Then) -> bool { self.out.values().any(|out| matches!(out, Out::Reply { then: theirs, .. } if std::ptr::fn_addr_eq(*theirs, then))) }

    // ── landing ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Lands whatever the hosts have said, in the order they said it.
    pub fn take(&mut self) -> Vec<Landed> {
        let mut landed = Vec::new();
        let mut ats: Vec<OutlineAt> = self.wires.keys().cloned().collect();
        ats.sort();
        for at in ats {
            let said = self.wires.get_mut(&at).map(|wire| wire.link.take()).unwrap_or_default();
            for line in said {
                if let Some(id) = line["id"].as_str() {
                    let result = if line["ok"] == true { Ok(line["result"].clone()) } else { Err(Refusal { kind: line["kind"].as_str().unwrap_or("failed").to_string(), error: line["error"].as_str().unwrap_or("refused").to_string() }) };
                    match self.out.remove(id) {
                        Some(Out::Read(key)) => if self.land(&key, id, result) { landed.push(Landed::Answer(key)) },
                        Some(Out::Reply { then, ctx, by, .. }) => landed.push(Landed::Reply(Reply { then, ctx, by, result })),
                        None => {}
                    }
                } else if line["event"]["action"] == "queries.changed" {
                    for change in line["event"]["changes"].as_array().into_iter().flatten() { self.changed(&at, change) }
                } else if line["event"]["action"] == SCRIPT_ACT {
                    let call = &line["event"]["script"];
                    if call["targetClientId"] == self.client.as_str() && let Some(call) = Call::read(call) { landed.push(Landed::Call { at: at.clone(), call }) }
                } else if line["event"]["action"] == SCRIPT_ENDED {
                    let ended = &line["event"]["ended"];
                    let text = |key: &str| ended[key].as_str().unwrap_or("").to_string();
                    landed.push(Landed::Ended { run: text("run"), reason: text("reason"), message: text("message") });
                } else if line["link"] == "lost" {
                    self.out.retain(|_, out| match out { Out::Read(key) => self.slots.get(key).is_none_or(|slot| slot.ask.at != at), Out::Reply { at: theirs, .. } => *theirs != at });
                    for slot in self.slots.values_mut().filter(|slot| slot.ask.at == at) { slot.out = None }
                    landed.push(Landed::Lost { detail: line["detail"].as_str().unwrap_or("the connection ended").to_string() });
                }
            }
        }
        landed
    }

    fn land(&mut self, key: &AskKey, id: &str, result: Result<Value, Refusal>) -> bool {
        let Some(slot) = self.slots.get_mut(key) else { return false };
        if slot.out.as_deref() == Some(id) {
            slot.out = None;
            slot.fresh = Fresh::Yes;
            // A question the service refused is not one it watches: its key is free again.
            if result.is_err() && let (Some(index), Some(wire)) = (slot.watch.take(), self.wires.get_mut(&slot.ask.at)) { wire.keys[index] = None }
        }
        match result {
            Ok(value) => { slot.answer = Some(value); slot.refused = None; slot.typed = OnceCell::new() }
            Err(refusal) => slot.refused = Some(refusal),
        }
        slot.epoch += 1;
        if slot.answer.is_some() { for user in &slot.users { self.shown.insert(user.clone(), key.clone()); } }
        true
    }

    /// A watched answer moved (the next `want` reads it by the generation named), or the service dropped it past its
    /// bounds (the next `want` registers it again).
    fn changed(&mut self, at: &OutlineAt, change: &Value) {
        let Some(index) = change["key"].as_str().and_then(|key| key.strip_prefix('w')).and_then(|n| n.parse::<usize>().ok()) else { return };
        let Some(wire) = self.wires.get_mut(at) else { return };
        let Some(key) = wire.keys.get(index).cloned().flatten() else { return };
        let Some(slot) = self.slots.get_mut(&key).filter(|slot| slot.watch == Some(index)) else { return };
        if change["dropped"] == true {
            wire.keys[index] = None;
            slot.watch = None;
            slot.fresh = Fresh::No;
        } else if slot.fresh != Fresh::No {
            slot.fresh = Fresh::Moved(change["generation"].clone());
        }
    }

    // ── describing itself ───────────────────────────────────────────────────────────────────────────────────

    /// How many of a connection's watch keys hold an answer somebody shows, and how many the store holds at all.
    pub fn watching(&self, at: &OutlineAt) -> (usize, usize) {
        let Some(wire) = self.wires.get(at) else { return (0, 0) };
        let held: Vec<&Slot> = wire.keys.iter().flatten().filter_map(|key| self.slots.get(key)).collect();
        (held.iter().filter(|slot| !slot.users.is_empty()).count(), held.len())
    }

    /// The asks a tile shows now.
    pub fn asks_of(&self, tile: &str) -> Vec<Value> {
        self.order.iter().filter_map(|key| self.slots.get(key)).filter(|slot| slot.users.iter().any(|(user, _)| user == tile)).map(|slot| slot.ask.json()).collect()
    }

    /// What `peek` says of the store: each slot, who shows it, how it stands, and the budget of each connection.
    pub fn peek(&self) -> Value {
        let mut slots: Vec<(&AskKey, &Slot)> = self.slots.iter().collect();
        slots.sort_by(|a, b| a.0.cmp(b.0));
        let state = |slot: &Slot| match (&slot.answer, slot.out.is_some(), &slot.fresh) {
            _ if slot.refused.is_some() => "refused",
            (None, _, _) => "asking",
            (Some(_), true, _) => "reading",
            (Some(_), false, Fresh::Yes) if slot.ask.watch && slot.watch.is_none() => "unwatched",
            (Some(_), false, Fresh::Yes) => "held",
            (Some(_), false, _) => "stale",
        };
        let mut links: Vec<&OutlineAt> = self.wires.keys().collect();
        links.sort();
        json!({
            "budget": links.iter().map(|at| { let (shown, held) = self.watching(at); json!({ "outline": at.outline, "machine": at.machine, "shown": shown, "held": held, "of": WATCH_BUDGET, "said": format!("{held}/{WATCH_BUDGET}") }) }).collect::<Vec<_>>(),
            "slots": slots.iter().map(|(_, slot)| {
                let mut row: Map<String, Value> = Map::new();
                row.insert("ask".into(), slot.ask.json());
                row.insert("tiles".into(), json!(slot.users.iter().map(|(tile, role)| format!("{tile}:{role}")).collect::<Vec<_>>()));
                row.insert("state".into(), json!(state(slot)));
                row.insert("answers".into(), json!(slot.epoch));
                if let Some(index) = slot.watch { row.insert("watch".into(), json!(format!("w{index}"))); }
                Value::Object(row)
            }).collect::<Vec<_>>(),
        })
    }
}
