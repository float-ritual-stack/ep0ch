//! Every read and every write the windows make, in one place.
//!
//! - **An `Ask` is a question**: an outline (and its machine), a wire action, its parameters, and whether the
//!   service should say when the answer moves. Equal asks share one slot, whoever wants them: two tiles on one
//!   note read it once, in one window or in two.
//! - **A slot only ever holds the answer to its own ask.** There is no "is this answer still for what's on
//!   screen?": what a tile shows is the slot of what it wants now, and `last` is the answer it showed before,
//!   kept so the tile never blanks while the next one is on its way.
//! - **Tiles are a slot's users.** `want` is told everything a window wants now; a slot nobody wants keeps its
//!   answer and gives up its watch for the next ask that needs one.
//! - **The budget is the service's**: 64 watched answers a connection (`WATCH_LIMITS`). A watch is a key the
//!   service keeps an answer under, and asking another question under a key replaces it, so the store owns 64
//!   keys a link and hands them out. Past the budget an ask is read unwatched and registered when a key is free;
//!   one the service dropped is asked again when next wanted.
//! - **A write is a request with a continuation**: `write` stamps who it is recorded as, and the answer comes back
//!   from `take` with the function that goes on from it, in the window that wrote.
//! - **One store, however many windows.** The links, the slots and the budget are the `Hub`'s, which the windows
//!   of one run share; a `Store` is one window's face on it: what that window wants, the answers as it last took
//!   them (so a view reads them without reaching into what another window may be changing), and what the service
//!   said that is this window's to hear. A link is one an outline and machine: two windows on one outline share
//!   it and its 64 keys, and a window on another outline brings a second.
use std::any::Any;
use std::cell::{OnceCell, RefCell};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};

use crate::actions::{Actor, Then};
use crate::client::{Link, Waker};

/// How many watched answers the service keeps for one connection (outline-core's `WATCH_LIMITS.perConnection`).
pub const WATCH_BUDGET: usize = 64;
/// The event a script's act arrives as (outline-core's `ScriptActionCall`, the service's `scripts.act`).
const SCRIPT_ACT: &str = "scripts.act";
/// The event a script run's end arrives as (outline-core's `ScriptEnded`).
const SCRIPT_ENDED: &str = "scripts.ended";
/// What the service asks the holder of a draft, each an event aimed at this window (outline-core's
/// `DraftHolderRequest`): its draft as it is, a patch, a patch taken back, and the spans of one the service placed.
const DRAFT_ASKS: &[&str] = &["draft.read", "draft.patch", "draft.revert", "draft.place"];
/// The writes that make a block (a note, a comment, a reply): the wire records who made one as `author` and
/// `provenance`, where every other write carries `mutation`.
const AUTHORED: &[&str] = &["create", "annotations.batch", "annotations.reply"];
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

/// One answer, and the type its drawer read it as, once: shared by every window that shows it.
struct Answer {
    value: Value,
    typed: OnceCell<Option<Box<dyn Any>>>,
}

/// Which window: the hub's own number for it.
type Window = u64;

struct Slot {
    ask: Ask,
    /// Who shows it: a window's tile, as a role.
    users: BTreeSet<(Window, User)>,
    /// The newest answer the service gave.
    answer: Option<Rc<Answer>>,
    /// Its no to the newest read, when that was refused: an answer from before stays to be shown.
    refused: Option<Refusal>,
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
    Reply { at: OutlineAt, window: Window, then: Then, ctx: Value, by: Actor },
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
    Lost { at: OutlineAt, detail: String },
    /// The service asks this window to run an action for a script (a `script` event aimed at this client): the
    /// dispatcher runs it and `answer` says how it went.
    Call { at: OutlineAt, call: Call },
    /// A script run ended (the service's `scripts.ended`): which, how, and its last word.
    Ended { run: String, reason: String, message: String },
    /// The service asks about a draft this window holds (a `draft` event aimed at this client), as the wire said
    /// it, and who the change it carries is recorded as (none: it carries none): the draft's own actions answer,
    /// through `held`.
    Asked { at: OutlineAt, ask: Value, by: Option<Actor> },
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
    /// The link said it ended, and none has been made in its place yet.
    lost: bool,
    /// This run is registered on it as a client that runs actions and holds drafts.
    registered: bool,
}

/// What the windows of one run share: the links, the slots, the budget, and what is out.
#[derive(Default)]
struct Hub {
    wires: HashMap<OutlineAt, Wire>,
    slots: HashMap<AskKey, Slot>,
    /// What each window wants now, in the order it said it: asks go out in it.
    orders: BTreeMap<Window, Vec<AskKey>>,
    /// The answer each user showed last.
    shown: HashMap<(Window, User), AskKey>,
    out: HashMap<String, Out>,
    /// What the service said that is one window's to hear, until that window takes it.
    inbox: HashMap<Window, Vec<Landed>>,
    /// The windows there are, each by the name its shell gave it.
    windows: BTreeMap<Window, String>,
    next: u64,
    tick: u64,
    /// A headless render steps a virtual clock: each ask waits for its answer, so a frame shows what it asked for.
    blocking: bool,
    /// Who the person's writes are recorded as, on each host.
    persons: HashMap<OutlineAt, String>,
    /// The name this run is registered under on each link: what a script's act and a draft's ask are aimed at.
    client: String,
    /// The window a script's acts come back to on a link: the one that last pressed there.
    pressed: HashMap<OutlineAt, Window>,
    /// The window that holds the draft of a block: the one that last asked for its hold.
    holders: HashMap<(OutlineAt, String), Window>,
    /// What wakes each window; a link's line wakes them all, since any of them may show what it moved.
    wakers: Arc<Mutex<HashMap<Window, Waker>>>,
}

impl Hub {
    fn waker(&self) -> Waker {
        let wakers = self.wakers.clone();
        Arc::new(move || { let all: Vec<Waker> = wakers.lock().unwrap().values().cloned().collect(); for wake in all { wake() } })
    }

    fn link(&mut self, at: &OutlineAt, mut link: Box<dyn Link>) {
        link.set_waker(self.waker());
        self.wires.insert(at.clone(), Wire { link, keys: vec![None; WATCH_BUDGET], lost: false, registered: false });
        self.out.retain(|_, out| match out { Out::Read(key) => self.slots.get(key).is_none_or(|slot| slot.ask.at != *at), Out::Reply { at: theirs, .. } => theirs != at });
        for slot in self.slots.values_mut().filter(|slot| slot.ask.at == *at) {
            slot.out = None;
            slot.watch = None;
            slot.fresh = Fresh::No;
        }
    }

    fn want(&mut self, window: Window, wants: Vec<Want>) {
        self.tick += 1;
        for slot in self.slots.values_mut() { slot.users.retain(|(theirs, _)| *theirs != window) }
        let mut order: Vec<AskKey> = Vec::new();
        for want in wants {
            let key = want.ask.key();
            let slot = self.slots.entry(key.clone()).or_insert_with(|| Slot { ask: want.ask, users: BTreeSet::new(), answer: None, refused: None, epoch: 0, out: None, watch: None, fresh: Fresh::No, touched: 0 });
            let user = (want.tile, want.role);
            if slot.answer.is_some() { self.shown.insert((window, user.clone()), key.clone()); }
            slot.users.insert((window, user));
            slot.touched = self.tick;
            if !order.contains(&key) { order.push(key) }
        }
        self.orders.insert(window, order);
        self.pump();
        self.forget();
    }

    fn pump(&mut self) {
        let wanted: Vec<AskKey> = self.orders.values().flatten().cloned().collect();
        for key in wanted {
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

    fn send(&mut self, at: &OutlineAt, action: &str, request: Value) -> String { self.send_as(at, action, request, self.blocking) }

    /// `waited`: nothing goes on until the answer is here (a headless render's every ask).
    fn send_as(&mut self, at: &OutlineAt, action: &str, mut request: Value, waited: bool) -> String {
        self.next += 1;
        let id = format!("n{}", self.next);
        request["id"] = json!(id);
        request["action"] = json!(action);
        request["outline"] = json!(at.outline);
        if let Some(wire) = self.wires.get_mut(at) {
            wire.link.send(&request);
            if waited { wire.link.wait(&id, Duration::from_secs(20)) }
        }
        id
    }

    /// A request whose answer goes on in a window.
    fn reply(&mut self, window: Window, at: &OutlineAt, action: &str, params: Value, by: &Actor, then: Then, ctx: Value, waited: bool) {
        let id = self.send_as(at, action, params, waited);
        self.out.insert(id, Out::Reply { at: at.clone(), window, then, ctx, by: by.clone() });
    }

    fn stamped(&self, at: &OutlineAt, action: &str, mut params: Value, by: &Actor) -> Value {
        let (author, actor_id) = match by { Actor::Person => ("user", self.persons.get(at).cloned().unwrap_or_else(|| PERSON.to_string())), Actor::Agent(id) => ("agent", id.clone()) };
        if AUTHORED.contains(&action) {
            // The store records who made a block: a person's names no client, an agent's names the agent.
            params["author"] = json!(author);
            if let Actor::Agent(id) = by { params["provenance"] = json!({ "actorId": id }) }
        } else {
            params["mutation"] = json!({ "author": author, "actorId": actor_id });
        }
        params
    }

    /// The window an event with no asker is for: the one named when it is still here, else the first there is.
    fn heard_by(&self, named: Option<&Window>) -> Option<Window> { named.filter(|window| self.windows.contains_key(window)).or_else(|| self.windows.keys().next()).copied() }

    fn hear(&mut self, window: Option<Window>, landed: Landed) { if let Some(window) = window { self.inbox.entry(window).or_default().push(landed) } }

    /// Lands whatever the hosts have said, in the order they said it, each in the inbox of the window it is for.
    fn take(&mut self) {
        let mut ats: Vec<OutlineAt> = self.wires.keys().cloned().collect();
        ats.sort();
        for at in ats {
            let said = self.wires.get_mut(&at).map(|wire| wire.link.take()).unwrap_or_default();
            for line in said {
                if let Some(id) = line["id"].as_str() {
                    let result = if line["ok"] == true { Ok(line["result"].clone()) } else { Err(Refusal { kind: line["kind"].as_str().unwrap_or("failed").to_string(), error: line["error"].as_str().unwrap_or("refused").to_string() }) };
                    match self.out.remove(id) {
                        Some(Out::Read(key)) => if self.land(&key, id, result) {
                            let shows: BTreeSet<Window> = self.slots.get(&key).map(|slot| slot.users.iter().map(|(window, _)| *window).collect()).unwrap_or_default();
                            for window in shows { self.hear(Some(window), Landed::Answer(key.clone())) }
                        },
                        Some(Out::Reply { window, then, ctx, by, .. }) => self.hear(Some(window), Landed::Reply(Reply { then, ctx, by, result })),
                        None => {}
                    }
                } else if line["event"]["action"] == "queries.changed" {
                    for change in line["event"]["changes"].as_array().into_iter().flatten() { self.changed(&at, change) }
                } else if line["event"]["action"] == SCRIPT_ACT {
                    let call = &line["event"]["script"];
                    if call["targetClientId"] == self.client.as_str() && let Some(call) = Call::read(call) { self.hear(self.heard_by(self.pressed.get(&at)), Landed::Call { at: at.clone(), call }) }
                } else if line["event"]["domain"] == "draft" {
                    let ask = &line["event"]["draft"];
                    // Who a patch is recorded as, read where an attribution is written: an agent by its id, else the person.
                    let by = match (ask["mutation"]["author"].as_str(), ask["mutation"]["actorId"].as_str()) { (Some("agent"), id) => Some(Actor::Agent(id.unwrap_or("agent").to_string())), (Some(_), _) => Some(Actor::Person), (None, _) => None };
                    if ask["targetClientId"] == self.client.as_str() && ask["requestId"].is_string() {
                        let holder = self.heard_by(line["event"]["blockId"].as_str().or(ask["blockId"].as_str()).and_then(|block| self.holders.get(&(at.clone(), block.to_string()))));
                        self.hear(holder, Landed::Asked { at: at.clone(), ask: ask.clone(), by });
                    }
                } else if line["event"]["action"] == SCRIPT_ENDED {
                    let ended = &line["event"]["ended"];
                    let text = |key: &str| ended[key].as_str().unwrap_or("").to_string();
                    // Whichever window waits on the run knows it by its id: every window hears, and the rest pass it by.
                    for window in self.windows.keys().copied().collect::<Vec<_>>() { self.hear(Some(window), Landed::Ended { run: text("run"), reason: text("reason"), message: text("message") }) }
                } else if line["link"] == "lost" {
                    self.out.retain(|_, out| match out { Out::Read(key) => self.slots.get(key).is_none_or(|slot| slot.ask.at != at), Out::Reply { at: theirs, .. } => *theirs != at });
                    for slot in self.slots.values_mut().filter(|slot| slot.ask.at == at) { slot.out = None }
                    if let Some(wire) = self.wires.get_mut(&at) { wire.lost = true }
                    let detail = line["detail"].as_str().unwrap_or("the connection ended").to_string();
                    for window in self.windows.keys().copied().collect::<Vec<_>>() { self.hear(Some(window), Landed::Lost { at: at.clone(), detail: detail.clone() }) }
                }
            }
        }
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
            Ok(value) => { slot.answer = Some(Rc::new(Answer { value, typed: OnceCell::new() })); slot.refused = None }
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

    fn watching(&self, at: &OutlineAt) -> (usize, usize) {
        let Some(wire) = self.wires.get(at) else { return (0, 0) };
        let held: Vec<&Slot> = wire.keys.iter().flatten().filter_map(|key| self.slots.get(key)).collect();
        (held.iter().filter(|slot| !slot.users.is_empty()).count(), held.len())
    }
}

/// Who the person's writes are recorded as until a host has said its machine's name.
const PERSON: &str = "ep0ch-native";

/// A slot as one window last took it: what its views read.
struct Seen {
    answer: Option<Rc<Answer>>,
    refused: Option<Refusal>,
    epoch: u64,
}

/// One window's face on the store its run shares.
pub struct Store {
    hub: Rc<RefCell<Hub>>,
    window: Window,
    client: String,
    /// The slots as this window last took them, and the answer each of its users showed last.
    seen: HashMap<AskKey, Seen>,
    shown: HashMap<User, AskKey>,
}

impl Drop for Store {
    /// A window that is gone wants nothing, hears nothing and holds no key.
    fn drop(&mut self) {
        let Ok(mut hub) = self.hub.try_borrow_mut() else { return };
        let window = self.window;
        for slot in hub.slots.values_mut() { slot.users.retain(|(theirs, _)| *theirs != window) }
        hub.orders.remove(&window);
        hub.inbox.remove(&window);
        hub.windows.remove(&window);
        hub.shown.retain(|(theirs, _), _| *theirs != window);
        hub.out.retain(|_, out| !matches!(out, Out::Reply { window: theirs, .. } if *theirs == window));
        // What it held and pressed is nobody's: the next window made may be given its number.
        hub.holders.retain(|_, theirs| *theirs != window);
        hub.pressed.retain(|_, theirs| *theirs != window);
        hub.wakers.lock().unwrap().remove(&window);
    }
}

impl Store {
    /// The store of a run's first window.
    pub fn new() -> Store {
        static RUNS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let client = format!("native-{}-{n}", std::process::id());
        let hub = Hub { client: client.clone(), windows: BTreeMap::from([(0, MAIN.to_string())]), ..Hub::default() };
        Store { hub: Rc::new(RefCell::new(hub)), window: 0, client, seen: HashMap::new(), shown: HashMap::new() }
    }

    /// Another window's face on the same store, by the name its shell gives it: the same links, slots and budget.
    pub fn beside(&self, name: &str) -> Store {
        let mut hub = self.hub.borrow_mut();
        let window = hub.windows.keys().next_back().map_or(0, |last| last + 1);
        hub.windows.insert(window, name.to_string());
        let mut store = Store { hub: self.hub.clone(), window, client: self.client.clone(), seen: HashMap::new(), shown: HashMap::new() };
        drop(hub);
        store.sync();
        store
    }

    /// The name this window has among its run's.
    pub fn window(&self) -> String { self.hub.borrow().windows.get(&self.window).cloned().unwrap_or_default() }
    /// The windows there are on this store, by name, in the order they were made.
    pub fn windows(&self) -> Vec<String> { self.hub.borrow().windows.values().cloned().collect() }

    /// The answers as the hub holds them now, taken for this window's views to read.
    fn sync(&mut self) {
        let hub = self.hub.borrow();
        self.seen.retain(|key, _| hub.slots.contains_key(key));
        for (key, slot) in &hub.slots {
            if self.seen.get(key).is_some_and(|seen| seen.epoch == slot.epoch) { continue }
            self.seen.insert(key.clone(), Seen { answer: slot.answer.clone(), refused: slot.refused.clone(), epoch: slot.epoch });
        }
        self.shown = hub.shown.iter().filter(|((window, _), _)| *window == self.window).map(|((_, user), key)| (user.clone(), key.clone())).collect();
    }

    /// The name this run is registered under: a press names it, so a script's acts come back here.
    pub fn client(&self) -> &str { &self.client }

    /// Registers this run on a link as a client that runs actions and holds drafts (`events.subscribe`), once a
    /// link: the service then sends it the acts of the scripts it started, how each run ended and what it asks of a
    /// draft held here, and nothing else of the event feed.
    pub fn register(&mut self, at: &OutlineAt) {
        let mut hub = self.hub.borrow_mut();
        if hub.wires.get(at).is_none_or(|wire| wire.registered) { return }
        let client = json!({ "clientId": self.client, "role": "observer", "contextId": self.client, "app": "native" });
        let kinds: Vec<&str> = [SCRIPT_ACT, SCRIPT_ENDED].into_iter().chain(DRAFT_ASKS.iter().copied()).collect();
        hub.send(at, "events.subscribe", json!({ "client": client, "kinds": kinds }));
        if let Some(wire) = hub.wires.get_mut(at) { wire.registered = true }
    }

    /// Answers what the service asked of a draft held here (`drafts.answer`): the answer, or why there is none.
    pub fn held(&mut self, at: &OutlineAt, request: &str, answer: Result<Value, String>) {
        let mut said = json!({ "requestId": request, "clientId": self.client });
        match answer { Ok(answer) => said["answer"] = answer, Err(error) => said["error"] = json!(error) }
        self.hub.borrow_mut().send(at, "drafts.answer", said);
    }

    /// Answers a script's act (`scripts.answer`): what the action answered, or why it didn't run.
    pub fn answer(&mut self, at: &OutlineAt, request: &str, result: Result<Value, String>) {
        let mut said = json!({ "requestId": request, "clientId": self.client });
        match result { Ok(result) => said["result"] = result, Err(error) => said["error"] = json!(error) }
        self.hub.borrow_mut().send(at, "scripts.answer", said);
    }

    /// The link to an outline's host: made, or made again (its watches and whatever was out ended with the old one).
    pub fn link(&mut self, at: &OutlineAt, link: Box<dyn Link>) {
        self.hub.borrow_mut().link(at, link);
        self.sync();
    }

    /// A link to this outline's host is here and has not said it ended: another window made it, or made it again.
    pub fn linked(&self, at: &OutlineAt) -> bool { self.hub.borrow().wires.get(at).is_some_and(|wire| !wire.lost) }

    /// The outlines this store has a link to, in order.
    pub fn links(&self) -> Vec<OutlineAt> { let mut ats: Vec<OutlineAt> = self.hub.borrow().wires.keys().cloned().collect(); ats.sort(); ats }

    /// A headless render: every ask waits for its answer.
    pub fn set_blocking(&mut self, blocking: bool) { self.hub.borrow_mut().blocking = blocking }

    pub fn set_waker(&mut self, waker: Waker) {
        let mut hub = self.hub.borrow_mut();
        hub.wakers.lock().unwrap().insert(self.window, waker);
        let all = hub.waker();
        for wire in hub.wires.values_mut() { wire.link.set_waker(all.clone()) }
    }

    /// Who the person's writes are recorded as on a host (`ep0ch-native:<the host's machine>`).
    pub fn set_person(&mut self, at: &OutlineAt, actor_id: String) { self.hub.borrow_mut().persons.insert(at.clone(), actor_id); }

    /// This window pressed a button on a link: the acts of the script it runs come back here.
    pub fn pressing(&mut self, at: &OutlineAt) { self.hub.borrow_mut().pressed.insert(at.clone(), self.window); }

    /// This window holds the draft of a block from now: what the service asks of it comes here.
    pub fn holding(&mut self, at: &OutlineAt, block: &str) { self.hub.borrow_mut().holders.insert((at.clone(), block.to_string()), self.window); }

    /// The window that holds the draft of a block, when it is another than this one: a block is written in one place.
    pub fn held_elsewhere(&self, at: &OutlineAt, block: &str) -> Option<String> {
        let hub = self.hub.borrow();
        hub.holders.get(&(at.clone(), block.to_string())).filter(|window| **window != self.window).and_then(|window| hub.windows.get(window).cloned())
    }

    /// A block's draft is held by no window any more.
    pub fn let_go(&mut self, at: &OutlineAt, block: &str) {
        let mut hub = self.hub.borrow_mut();
        let key = (at.clone(), block.to_string());
        if hub.holders.get(&key) == Some(&self.window) { hub.holders.remove(&key); }
    }

    // ── reading ─────────────────────────────────────────────────────────────────────────────────────────────

    /// The service's no to this ask.
    pub fn refusal(&self, ask: &Ask) -> Option<&Refusal> { self.seen.get(&ask.key()).and_then(|seen| seen.refused.as_ref()) }

    /// The answer to exactly this ask, read as `T` (once: a slot keeps it).
    pub fn read<T: DeserializeOwned + 'static>(&self, ask: &Ask) -> Option<&T> { self.decoded(&ask.key()) }

    /// The answer `tile` showed last as `role`, whatever it answered: what stays, dimmed, while the wanted one is on its way.
    pub fn last<T: DeserializeOwned + 'static>(&self, tile: &str, role: &'static str) -> Option<&T> { self.decoded(self.shown.get(&(tile.to_string(), role))?) }

    fn decoded<T: DeserializeOwned + 'static>(&self, key: &AskKey) -> Option<&T> {
        let answer = self.seen.get(key)?.answer.as_ref()?;
        answer.typed.get_or_init(|| serde_json::from_value::<T>(answer.value.clone()).ok().map(|t| Box::new(t) as Box<dyn Any>)).as_ref()?.downcast_ref::<T>()
    }

    /// How many answers have landed for this ask: what follows from an answer is done once for each.
    pub fn epoch(&self, ask: &Ask) -> u64 { self.seen.get(&ask.key()).map_or(0, |seen| seen.epoch) }

    /// Nothing has answered this ask yet, with an answer or a no.
    pub fn waiting(&self, ask: &Ask) -> bool { self.seen.get(&ask.key()).is_none_or(|seen| seen.answer.is_none() && seen.refused.is_none()) }

    // ── wanting ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Everything this window wants now. A slot nobody names any more keeps its answer and frees its watch for the
    /// next ask; whatever is wanted and not yet asked (or asked before something changed) is asked.
    pub fn want(&mut self, wants: Vec<Want>) {
        self.hub.borrow_mut().want(self.window, wants);
        self.sync();
    }

    /// Reads an ask's answer now, unwatched: after this window's own write, when the kept answer is the one from before it.
    pub fn refresh(&mut self, ask: &Ask) {
        let key = ask.key();
        let mut hub = self.hub.borrow_mut();
        if hub.slots.contains_key(&key) { hub.send_read(&key, false) }
    }

    // ── asking once, and writing ────────────────────────────────────────────────────────────────────────────

    /// One request whose answer goes on in `then` (with `ctx`, what the asker kept for it).
    pub fn request(&mut self, at: &OutlineAt, action: &str, params: Value, by: &Actor, then: Then, ctx: Value) {
        let mut hub = self.hub.borrow_mut();
        let waited = hub.blocking;
        hub.reply(self.window, at, action, params, by, then, ctx, waited);
    }

    /// A write, recorded as whoever acts: the person as this window (`author: user`), an agent as itself.
    pub fn write(&mut self, at: &OutlineAt, action: &str, params: Value, by: &Actor, then: Then, ctx: Value) {
        let mut hub = self.hub.borrow_mut();
        let (params, waited) = (hub.stamped(at, action, params, by), hub.blocking);
        hub.reply(self.window, at, action, params, by, then, ctx, waited);
    }

    /// A write the service answers only once this window has answered it in turn (a patch to a draft held here):
    /// never waited for with the link held, even by a headless render, which lands what the host says meanwhile
    /// until the answer is in (`App::settled_for`).
    pub fn write_through(&mut self, at: &OutlineAt, action: &str, params: Value, by: &Actor, then: Then, ctx: Value) {
        let mut hub = self.hub.borrow_mut();
        let params = hub.stamped(at, action, params, by);
        hub.reply(self.window, at, action, params, by, then, ctx, false);
    }

    /// A request of this window's that goes on in `then` is out.
    pub fn out_for(&self, then: Then) -> bool { self.hub.borrow().out.values().any(|out| matches!(out, Out::Reply { then: theirs, window, .. } if *window == self.window && std::ptr::fn_addr_eq(*theirs, then))) }

    // ── landing ─────────────────────────────────────────────────────────────────────────────────────────────

    /// Lands whatever the hosts have said, in the order they said it, and answers what of it is this window's.
    pub fn take(&mut self) -> Vec<Landed> {
        let mine = {
            let mut hub = self.hub.borrow_mut();
            hub.take();
            hub.inbox.remove(&self.window).unwrap_or_default()
        };
        self.sync();
        mine
    }

    // ── describing itself ───────────────────────────────────────────────────────────────────────────────────

    /// How many of a connection's watch keys hold an answer somebody shows, and how many the store holds at all.
    pub fn watching(&self, at: &OutlineAt) -> (usize, usize) { self.hub.borrow().watching(at) }

    /// The asks a tile of this window shows now.
    pub fn asks_of(&self, tile: &str) -> Vec<Value> {
        let hub = self.hub.borrow();
        hub.orders.get(&self.window).into_iter().flatten().filter_map(|key| hub.slots.get(key)).filter(|slot| slot.users.iter().any(|(window, (user, _))| *window == self.window && user == tile)).map(|slot| slot.ask.json()).collect()
    }

    /// What `peek` says of the store: each slot, who shows it, how it stands, and the budget of each connection. A
    /// tile of another window is named with its window (`second/reader:page`).
    pub fn peek(&self) -> Value {
        let hub = self.hub.borrow();
        let mut slots: Vec<(&AskKey, &Slot)> = hub.slots.iter().collect();
        slots.sort_by(|a, b| a.0.cmp(b.0));
        let state = |slot: &Slot| match (&slot.answer, slot.out.is_some(), &slot.fresh) {
            _ if slot.refused.is_some() => "refused",
            (None, _, _) => "asking",
            (Some(_), true, _) => "reading",
            (Some(_), false, Fresh::Yes) if slot.ask.watch && slot.watch.is_none() => "unwatched",
            (Some(_), false, Fresh::Yes) => "held",
            (Some(_), false, _) => "stale",
        };
        let user = |(window, (tile, role)): &(Window, User)| if *window == self.window { format!("{tile}:{role}") } else { format!("{}/{tile}:{role}", hub.windows.get(window).map_or("", String::as_str)) };
        let mut links: Vec<&OutlineAt> = hub.wires.keys().collect();
        links.sort();
        json!({
            "budget": links.iter().map(|at| { let (shown, held) = hub.watching(at); json!({ "outline": at.outline, "machine": at.machine, "shown": shown, "held": held, "of": WATCH_BUDGET, "said": format!("{held}/{WATCH_BUDGET}") }) }).collect::<Vec<_>>(),
            "slots": slots.iter().map(|(_, slot)| {
                let mut row: Map<String, Value> = Map::new();
                row.insert("ask".into(), slot.ask.json());
                row.insert("tiles".into(), json!(slot.users.iter().map(user).collect::<Vec<_>>()));
                row.insert("state".into(), json!(state(slot)));
                row.insert("answers".into(), json!(slot.epoch));
                if let Some(index) = slot.watch { row.insert("watch".into(), json!(format!("w{index}"))); }
                Value::Object(row)
            }).collect::<Vec<_>>(),
        })
    }
}

/// The name a run's first window has.
pub const MAIN: &str = "main";
