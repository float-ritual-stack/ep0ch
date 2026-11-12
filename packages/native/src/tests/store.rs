//! The store alone, over a stand-in host: one slot an ask, a slot's users, the watch budget, what the service
//! dropped, and the answer a tile showed last.
use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;

use serde_json::{Value, json};

use super::support::{Asked, Said, Standin};
use crate::actions::Actor;
use crate::store::{Ask, Landed, OutlineAt, Store, WATCH_BUDGET, Want};

struct Host { store: Store, at: OutlineAt, asked: Asked, said: Said }

/// A store linked to a host that answers every read with the bed it was asked for, and counts what it is asked.
fn host() -> Host {
    let (asked, said): (Asked, Said) = (Rc::new(RefCell::new(Vec::new())), Rc::new(RefCell::new(VecDeque::new())));
    let at = OutlineAt { outline: "garden".into(), machine: String::new() };
    let mut store = Store::new();
    store.link(&at, Box::new(Standin { answers: Box::new(|ask| if ask["bed"] == "weeds" { Err(("invalid", "no bed is named weeds".into())) } else { Ok(json!({ "bed": ask["bed"], "sown": ask.get("generation").is_some() })) }), asked: asked.clone(), said: said.clone() }));
    Host { store, at, asked, said }
}

fn bed(at: &OutlineAt, name: &str) -> Ask { Ask::watched(at, "beds.read", json!({ "bed": name })) }
fn want(tile: &str, ask: &Ask) -> Want { Want { tile: tile.into(), role: "rows", ask: ask.clone() } }
fn says(h: &Host, line: Value) { h.said.borrow_mut().push_back(line) }
fn watch(asked: &Asked, name: &str) -> String { asked.borrow().iter().rev().find(|a| a["bed"] == name && a.get("watch").is_some()).unwrap()["watch"].as_str().unwrap().to_string() }

#[test]
fn equal_asks_share_one_slot_whoever_wants_them_and_differ_by_outline_machine_action_and_params() {
    let mut h = host();
    let north = bed(&h.at, "north");
    // The same question spelled with its parameters in another order is the same ask.
    let again = Ask::watched(&h.at, "beds.read", serde_json::from_str(r#"{"bed":"north"}"#).unwrap());
    h.store.want(vec![want("beds", &north), want("reader", &again)]);
    assert_eq!(h.asked.borrow().len(), 1, "two tiles, one read");
    h.store.take();
    assert_eq!(h.store.read::<Value>(&north).unwrap()["bed"], "north");
    assert_eq!((h.store.asks_of("beds").len(), h.store.asks_of("reader").len()), (1, 1));
    assert_eq!(h.store.peek()["slots"][0]["tiles"], json!(["beds:rows", "reader:rows"]));
    // Another machine's outline of the same name, another action, other parameters, unwatched: each its own ask.
    let elsewhere = OutlineAt { outline: "garden".into(), machine: "shed-box".into() };
    let others = [bed(&elsewhere, "north"), Ask::watched(&h.at, "beds.list", json!({ "bed": "north" })), bed(&h.at, "south"), Ask::read(&h.at, "beds.read", json!({ "bed": "north" }))];
    let keys: std::collections::HashSet<_> = others.iter().map(Ask::key).chain([north.key()]).collect();
    assert_eq!(keys.len(), 5);
    assert_eq!(north.key(), again.key());
}

#[test]
fn a_slot_nobody_wants_keeps_its_answer_and_what_a_tile_showed_last_stays_while_the_next_is_on_its_way() {
    let mut h = host();
    let (north, south) = (bed(&h.at, "north"), bed(&h.at, "south"));
    h.store.want(vec![want("reader", &north)]);
    h.store.take();
    h.store.want(vec![want("reader", &south)]);
    assert!(h.store.read::<Value>(&south).is_none() && h.store.waiting(&south));
    assert_eq!(h.store.last::<Value>("reader", "rows").unwrap()["bed"], "north", "the reader still has the north bed to show, dimmed");
    h.store.take();
    assert_eq!(h.store.last::<Value>("reader", "rows").unwrap()["bed"], "south");
    // Wanted again, the first is there at once: nothing is asked, because nothing said it moved.
    let before = h.asked.borrow().len();
    h.store.want(vec![want("reader", &north)]);
    assert_eq!((h.asked.borrow().len(), h.store.read::<Value>(&north).unwrap()["bed"].as_str()), (before, Some("north")));
}

#[test]
fn a_watched_answer_that_moved_is_read_by_its_generation_when_someone_shows_it() {
    let mut h = host();
    let north = bed(&h.at, "north");
    h.store.want(vec![want("beds", &north)]);
    h.store.take();
    let key = watch(&h.asked, "north");
    says(&h, json!({ "event": { "action": "queries.changed", "changes": [{ "key": key, "generation": 3 }] } }));
    h.store.take();
    h.store.want(vec![want("beds", &north)]);
    let read = h.asked.borrow().last().unwrap().clone();
    assert_eq!((read["watch"].as_str(), read["generation"].as_u64()), (Some(key.as_str()), Some(3)));
    h.store.take();
    assert_eq!(h.store.read::<Value>(&north).unwrap()["sown"], true, "the answer read by generation replaced the one held");
}

#[test]
fn the_budget_is_sixty_four_watches_a_link_and_a_released_one_goes_to_the_next_ask() {
    let mut h = host();
    let beds: Vec<Ask> = (0..WATCH_BUDGET + 3).map(|n| bed(&h.at, &format!("bed-{n}"))).collect();
    // Sixty-seven beds on screen at once: sixty-four are watched, the rest are read and say they are not.
    h.store.want(beds.iter().map(|ask| want("beds", ask)).collect());
    h.store.take();
    let watched: std::collections::HashSet<String> = h.asked.borrow().iter().filter_map(|a| a["watch"].as_str().map(str::to_string)).collect();
    assert_eq!((watched.len(), h.asked.borrow().len()), (WATCH_BUDGET, WATCH_BUDGET + 3), "never a sixty-fifth key: the host would drop the oldest for it");
    assert_eq!(h.store.watching(&h.at), (WATCH_BUDGET, WATCH_BUDGET));
    assert_eq!(h.store.peek()["budget"][0]["said"], "64/64");
    assert!(beds.iter().all(|ask| h.store.read::<Value>(ask).is_some()), "every one of them was answered");
    let states = |h: &Host| h.store.peek()["slots"].as_array().unwrap().iter().filter(|slot| slot["state"] == "unwatched").count();
    assert_eq!(states(&h), 3);
    // Asking again changes nothing while every key is shown: no thrash.
    let settled = h.asked.borrow().len();
    h.store.want(beds.iter().map(|ask| want("beds", ask)).collect());
    assert_eq!(h.asked.borrow().len(), settled);
    // Ten beds scroll away: their keys go to the three that had none, by the same key names.
    h.store.want(beds[10..].iter().map(|ask| want("beds", ask)).collect());
    let registered: Vec<Value> = h.asked.borrow()[settled..].to_vec();
    assert_eq!(registered.len(), 3);
    assert!(registered.iter().all(|a| watched.contains(a["watch"].as_str().unwrap())), "a released key is reused, never a new one: {registered:?}");
    h.store.take();
    assert_eq!((states(&h), h.store.watching(&h.at)), (0, (WATCH_BUDGET - 7, WATCH_BUDGET)));
    // One of the beds that scrolled away comes back: its key went to another ask, so it is asked afresh.
    let lost = &beds[0];
    let before = h.asked.borrow().len();
    h.store.want(beds[10..].iter().chain([lost]).map(|ask| want("beds", ask)).collect());
    let read = h.asked.borrow()[before..].to_vec();
    assert_eq!((read.len(), read[0]["bed"].as_str(), read[0].get("generation")), (1, Some("bed-0"), None));
}

#[test]
fn what_the_service_dropped_is_asked_again_when_shown_and_only_then() {
    let mut h = host();
    let (north, south) = (bed(&h.at, "north"), bed(&h.at, "south"));
    h.store.want(vec![want("beds", &north), want("beds", &south)]);
    h.store.take();
    let (n, s) = (watch(&h.asked, "north"), watch(&h.asked, "south"));
    // South scrolls away; then the host drops both.
    h.store.want(vec![want("beds", &north)]);
    let before = h.asked.borrow().len();
    says(&h, json!({ "event": { "action": "queries.changed", "changes": [{ "key": n, "generation": 9, "dropped": true }, { "key": s, "generation": 2, "dropped": true }] } }));
    h.store.take();
    h.store.want(vec![want("beds", &north)]);
    let again = h.asked.borrow()[before..].to_vec();
    assert_eq!((again.len(), again[0]["bed"].as_str(), again[0]["watch"].is_string(), again[0].get("generation")), (1, Some("north"), true, None), "the one on screen is registered again, with no generation");
    h.store.take();
    assert_eq!(h.store.read::<Value>(&south).unwrap()["bed"], "south", "the other keeps the answer it had");
    h.store.want(vec![want("beds", &north), want("beds", &south)]);
    assert_eq!((h.asked.borrow().len(), h.asked.borrow().last().unwrap()["bed"].as_str()), (before + 2, Some("south")), "and is asked again when it is next shown");
}

#[test]
fn a_refused_read_is_said_once_keeps_no_watch_and_leaves_an_earlier_answer_standing() {
    let mut h = host();
    let weeds = bed(&h.at, "weeds");
    h.store.want(vec![want("beds", &weeds)]);
    h.store.take();
    assert_eq!(h.store.refusal(&weeds).map(|r| (r.kind.as_str(), r.error.as_str())), Some(("invalid", "no bed is named weeds")));
    assert!(!h.store.waiting(&weeds) && h.store.read::<Value>(&weeds).is_none());
    assert_eq!(h.store.watching(&h.at), (0, 0), "a question the service refused holds no watch");
    let before = h.asked.borrow().len();
    h.store.want(vec![want("beds", &weeds)]);
    assert_eq!(h.asked.borrow().len(), before, "and isn't asked again for nothing");
}

#[test]
fn a_write_is_stamped_with_who_acts_and_a_link_made_again_asks_for_everything_shown() {
    let mut h = host();
    h.store.set_person("ep0ch-native:box".into());
    fn then(_: &mut crate::actions::App, _: crate::store::Reply) {}
    h.store.write(&h.at.clone(), "update", json!({ "blockId": "north" }), &Actor::Person, then, Value::Null);
    h.store.write(&h.at.clone(), "update", json!({ "blockId": "north" }), &Actor::Agent("compost-agent".into()), then, Value::Null);
    h.store.write(&h.at.clone(), "create", json!({ "text": "" }), &Actor::Person, then, Value::Null);
    h.store.write(&h.at.clone(), "create", json!({ "text": "" }), &Actor::Agent("compost-agent".into()), then, json!({ "kept": 1 }));
    let sent = h.asked.borrow().clone();
    assert_eq!(sent[0]["mutation"], json!({ "author": "user", "actorId": "ep0ch-native:box" }));
    assert_eq!(sent[1]["mutation"], json!({ "author": "agent", "actorId": "compost-agent" }));
    assert_eq!((sent[2]["author"].as_str(), sent[2].get("provenance"), sent[2].get("mutation")), (Some("user"), None, None));
    assert_eq!((sent[3]["author"].as_str(), &sent[3]["provenance"]), (Some("agent"), &json!({ "actorId": "compost-agent" })));
    let landed = h.store.take();
    assert!(matches!(landed.last(), Some(Landed::Reply(reply)) if reply.by == Actor::Agent("compost-agent".into()) && reply.ctx["kept"] == 1 && reply.result.is_ok()));

    let north = bed(&h.at, "north");
    h.store.want(vec![want("beds", &north)]);
    h.store.take();
    let (asked, said): (Asked, Said) = Default::default();
    h.store.link(&h.at.clone(), Box::new(Standin { answers: Box::new(|ask| Ok(json!({ "bed": ask["bed"], "again": true }))), asked: asked.clone(), said }));
    assert_eq!(h.store.read::<Value>(&north).unwrap()["bed"], "north", "the answer held stays to be shown");
    h.store.want(vec![want("beds", &north)]);
    assert_eq!((asked.borrow().len(), asked.borrow()[0]["watch"].is_string(), asked.borrow()[0].get("generation")), (1, true, None));
    h.store.take();
    assert_eq!(h.store.read::<Value>(&north).unwrap()["again"], true);
}
