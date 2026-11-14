//! Wave F3, ways out: a refusal of the layout's names a way out that exists in this window, in this window's own
//! keys. The layout names the way as an act (`layout::Way`); the dispatcher's one sayer (`actions::says`) words it:
//! the key this window's table binds for the person, the act line for an agent, nothing for an action that is no
//! row here. And what the layout's rules are told beside the layout (how this arrangement is named, its home, what
//! placement remembers) is told.
use serde_json::{Value, json};

use super::owners::{laid, leaf};
use super::support::*;
use crate::actions::{self, Actor, Tone, says};
use crate::keys;
use crate::layout::{Refusal, Way};

fn agent() -> Actor { Actor::Agent("seedling-agent".into()) }

/// Every dotted word a sentence holds that reads as an action's name (`layout.get`, `tile.close`).
fn dotted(said: &str) -> Vec<String> {
    said.split(|c: char| !(c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')).map(|word| word.trim_matches('.')).filter(|word| word.contains('.') && word.chars().all(|c| c.is_ascii_lowercase() || c == '.' || c == '-') && !word.starts_with('.')).map(str::to_string).collect()
}

fn three(more: Value) -> Garden {
    let mut spec = json!({ "layout": { "focus": "beds", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.4, 0.4], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), leaf("reader", "seeds")] } } });
    for (key, value) in more.as_object().unwrap() { spec[key] = value.clone() }
    laid(spec)
}

/// The sentence: refused by the layout, the person reads the key this window binds, and an agent the act line.
#[test]
fn a_refusal_of_the_layout_s_names_this_window_s_own_key_for_the_person_and_the_act_line_for_an_agent() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "open id=onions").ok && act(&mut g.app, "edit").ok);
    write(&mut g.app, "Thin the row to a hand apart");
    // Closing the reader a block is being written in is the layout's to refuse, and its way out is an act: `edit`.
    // The person reads the key this window's own table binds to it, and no key of the door's.
    let key = keys::cap("edit").expect("this window binds a key to edit");
    let mine = act(&mut g.app, "tile.close tile=reader");
    assert_eq!((mine.ok, mine.said.as_str()), (false, format!("not closed: it holds an edit of Lift the onions · {key} enters it").as_str()));
    assert!(!mine.said.contains("^W") && !mine.said.contains('⏎'), "no key of the door's is named: {}", mine.said);
    // It is put in front of them: the refusal is the notice, as an open's is. (It was answered and shown nowhere.)
    assert_eq!(g.app.notice.as_ref().map(|notice| (notice.tone, notice.said.as_str())), Some((Tone::Problem, mine.said.as_str())));
    act(&mut g.app, "notice.dismiss");
    // An agent is held back for the person by the layout's own guard, and is told the act that gets their attention
    // here: this window's (a comment on the note), by its row's name, as the act line it runs.
    let resized = g.app.act("layout.resize split=s1 border=0 share=0.6", agent());
    assert_eq!((resized.ok, resized.said.as_str()), (false, "the person is typing in reader; an agent doesn't resize it · comment body=\"…\" on the note gets their attention"));
    assert_eq!(dotted(&resized.said), Vec::<String>::new(), "nothing of the door's is named: {}", resized.said);
    // An agent's refusal is the agent's to read, and is said on the status line: it puts no notice before the person.
    assert!(g.app.notice.is_none() && g.app.agent_said.as_deref().is_some_and(|said| said.ends_with(&resized.said)), "{:?} {:?}", g.app.notice, g.app.agent_said);
    // A way with no key is said by its act line to the person too, and the act is a row: the one that names a split.
    for by in [Actor::Person, agent()] {
        let gone = g.app.act("layout.resize split=s9 border=0 share=0.3", by.clone());
        assert_eq!((gone.ok, gone.said.as_str()), (false, "no split s9 in the layout (it's gone: its tiles were moved or closed) · layout.get gives each split's id"), "as {}", by.label());
        assert!(dotted(&gone.said).iter().all(|id| actions::find(id).is_some()), "{}", gone.said);
    }
}

/// One namer of a split's id: `layout.get` answers it, the resize's row points at it, and the id it gives is the one
/// the resize takes.
#[test]
fn layout_get_names_the_split_a_resize_takes_and_changes_nothing() {
    let mut g = garden(ok());
    let before = g.app.layout.clone();
    let read = g.app.act("layout.get", agent());
    assert!(read.ok && g.app.layout == before, "a read: {}", read.said);
    let split = read.answer["layout"]["root"]["id"].as_str().expect("the root split's id").to_string();
    assert_eq!(read.answer["rev"].as_u64(), Some(g.app.layout.rev));
    assert!(g.app.act(&format!("layout.resize split={split} border=0 share=0.3"), agent()).ok, "the id layout.get gave is the split's");
    let row = actions::find("layout.resize").unwrap().row;
    assert!(row.summary.contains("layout.get") && !row.summary.contains("peek"), "its row names the same read: {}", row.summary);
}

/// A locked screen's refusal names the way out, now that the lock is an action here: the person reads this
/// window's key for it, an agent the act line and that it is the person's. The screen is named as this window knows
/// it (its title), never "the screen". (Until wave H2 no unlock was a row here, and the refusal was its reason alone.)
#[test]
fn a_locked_screen_s_refusal_names_the_unlock_by_this_window_s_key_and_the_arrangement_by_its_screen() {
    let mut g = three(json!({}));
    g.app.act("tile.focus tile=bed", Actor::Person);
    let mut locked = g.app.layout.save();
    locked["policy"] = json!({ "locked": true });
    let mut g = three(json!({ "layout": locked }));
    let key = keys::cap("layout.lock").expect("this window binds a key to the lock");
    let mine = g.app.act("tile.close tile=seeds", Actor::Person);
    assert_eq!((mine.ok, mine.said), (false, format!("the beds screen is locked: closing seeds is refused \u{b7} {key} in it unlocks it")));
    let theirs = g.app.act("tile.close tile=seeds", agent());
    assert!(!theirs.ok && theirs.said.starts_with("the beds screen is locked: closing seeds is refused \u{b7} ") && theirs.said.contains("layout.lock on=false") && theirs.said.ends_with("unlocks it"), "{}", theirs.said);
    // The way named is the way out: taken, the close is done.
    assert!(act(&mut g.app, "layout.lock on=false").ok && act(&mut g.app, "tile.close tile=seeds").ok);
}

/// The ways the layout names that had no action here until wave H2 are rows now, each said by this window's own
/// key or its act line: a fold, a float put back, a container's policy, an agent's level, a move.
#[test]
fn the_ways_out_that_were_no_row_here_are_said_now() {
    for id in ["layout.lock", "layout.policy", "layout.move", "tile.collapse", "tile.float", "tile.agent"] { assert!(actions::find(id).is_some(), "{id} is an action here") }
    // A float has no place in the tree: moving it beside a tile is refused, with the act that puts it back first.
    let mut g = three(json!({ "layout": { "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.4, 0.6], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] }, "floats": [{ "tile": leaf("reader", "seeds"), "rect": { "col": 30, "row": 6, "cols": 50, "rows": 20 } }] } }));
    let key = keys::cap("tile.float").expect("this window binds a key to the float");
    let moved = act(&mut g.app, "layout.swap to=bed tile=seeds");
    assert_eq!((moved.ok, moved.said), (false, format!("seeds is a float: a swap needs a tile in the layout \u{b7} {key} puts it back first")));
    assert!(act(&mut g.app, "tile.float on=false tile=seeds").ok && act(&mut g.app, "layout.swap to=bed tile=seeds").ok, "put back first, it swaps");
    // A container that keeps its tiles says the policy that lets them go, as the act line (no key is kept for it).
    let mut g = three(json!({ "layout": { "focus": "bed", "policy": { "closable": false }, "root": { "t": "split", "dir": "row", "weights": [0.4, 0.6], "kids": [leaf("tree", "beds"), leaf("reader", "bed")] } } }));
    let kept = act(&mut g.app, "tile.close tile=beds");
    assert!(!kept.ok && kept.said.contains("layout.policy") && kept.said.contains("closable=true"), "{}", kept.said);
    assert!(dotted(&kept.said).iter().all(|id| actions::find(id).is_some()), "{}", kept.said);
    let line = kept.said[kept.said.find("layout.policy").unwrap()..].split(" turns ").next().expect("the way is an act line").to_string();
    assert!(act(&mut g.app, &line).ok && act(&mut g.app, "tile.close tile=beds").ok, "{line} is the way out");
}

/// Every refusal the contract table holds, said here: a way is worded only when its action is a row of this
/// window's, the person is told no key of the door's, and what is left is the reason.
#[test]
fn every_refusal_the_door_s_table_holds_is_said_here_with_only_this_window_s_actions() {
    let table: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/../outline-core/fixtures/layout-contract.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    let (mut said_some, mut said_none) = (0, 0);
    for case in table["cases"].as_array().unwrap().iter().filter(|case| case["result"]["refusal"].is_object()) {
        let refusal = &case["result"]["refusal"];
        let why = Refusal::new(refusal["reason"].as_str().unwrap()).ways(refusal["ways"].as_array().unwrap().iter().map(|way| Way::read(way).expect("a way")));
        let here: Vec<&Way> = why.ways.iter().filter(|way| actions::find(&way.act).is_some()).collect();
        for by in [Actor::Person, agent()] {
            let said = says(&why, &by);
            assert!(said.starts_with(&why.reason), "{said}");
            let ways = &said[why.reason.len()..];
            assert_eq!(ways.is_empty(), here.is_empty(), "{}: a way is said exactly when its action is a row here: {said}", case["name"]);
            assert!(dotted(ways).iter().all(|id| actions::find(id).is_some()), "{}: it names an action this window hasn't: {said}", case["name"]);
            assert!(!ways.contains("^W") && !ways.contains("ctrl+w"), "{}: a key of the door's: {said}", case["name"]);
            for way in &here { assert!(ways.contains(&way.does), "{}: what the way does is said: {said}", case["name"]) }
            // The key named is the one the table binds to that act, read when it is said.
            if by == Actor::Person { for way in &here { if let Some(key) = keys::cap_of(&way.act, &way.args) { assert!(ways.contains(&key), "{}: {key} runs {}: {said}", case["name"], way.act) } } }
        }
        if here.is_empty() { said_none += 1 } else { said_some += 1 }
    }
    // (Before wave H2 eight of them named a way this window has; the lock, the policy, the fold, the float and the move are rows now.)
    assert!(said_some >= 50 && said_none <= 70, "refusals with a way this window has, and with none: {said_some}, {said_none}");
}

/// The keys go to the screen's home when the dock they are in slides shut: the spec's `home` is told to the
/// layout's rules (it was not, and they went to the first tile shown whatever the screen said).
#[test]
fn the_keys_go_home_when_their_dock_shuts_as_the_screen_says() {
    let went = |more: Value| {
        let mut spec = json!({ "layout": { "focus": "seeds", "root": { "t": "split", "dir": "row", "weights": [0.2, 0.5, 0.3], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), { "t": "dock", "edge": "right", "open": true, "kid": leaf("reader", "seeds") }] } } });
        for (key, value) in more.as_object().unwrap() { spec[key] = value.clone() }
        let mut g = laid(spec);
        assert_eq!(g.app.layout.name(&g.app.layout.focus), "seeds");
        let shut = act(&mut g.app, "dock.toggle side=right");
        assert!(shut.ok, "{}", shut.said);
        (g.app.layout.name(&g.app.layout.focus), shut.answer["keys"]["by"].as_str().map(str::to_string))
    };
    assert_eq!(went(json!({ "home": "bed" })), ("bed".to_string(), Some("home".to_string())), "the screen's home takes the keys, and the answer says so");
    assert_eq!(went(json!({})).0, "beds", "with no home said, the first tile shown does");
}

/// Why an open landed elsewhere names what undoes it as an act too (a pinned reader's pin let go: the door's `p`
/// was spelled in the sentence). Said here it is the reason alone: this window has no such action, so it names
/// none, and no key of the door's.
#[test]
fn why_an_open_landed_elsewhere_names_no_key_of_the_door_s() {
    let table: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/../outline-core/fixtures/place-contract.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    let held: Vec<&Value> = table["cases"].as_array().unwrap().iter().filter(|case| case["placement"]["ways"].is_array()).collect();
    assert!(held.len() >= 3, "the pinned rows hold a way beside their reason: {}", held.len());
    for case in held {
        let reason = case["placement"]["why"].as_str().expect("why it landed there");
        assert!(!reason.contains(" · "), "{}: the reason is the reason alone: {reason}", case["name"]);
        let why = Refusal::new(reason).ways(case["placement"]["ways"].as_array().unwrap().iter().map(|way| Way::read(way).expect("a way")));
        for by in [Actor::Person, agent()] {
            let said = says(&why, &by);
            let here = why.ways.iter().any(|way| actions::find(&way.act).is_some());
            assert_eq!(said == reason, !here, "{}: a way is said exactly when its action is a row here: {said}", case["name"]);
            assert!(dotted(&said[reason.len()..]).iter().all(|id| actions::find(id).is_some()), "{}: {said}", case["name"]);
        }
    }
}
