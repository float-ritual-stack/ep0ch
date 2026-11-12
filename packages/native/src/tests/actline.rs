//! The act-line grammar and the action rows, against what the door's own functions wrote down
//! (`outline-core/fixtures/act-lines.json`, `action-rows.json`): one grammar and one row shape, two readers.
use serde_json::{Value, json};

use crate::actions::row::{ActionRow, ArgType};
use crate::actions::{self};
use crate::actline::{self, Address};

fn fixture(name: &str) -> Value {
    let path = format!("{}/../outline-core/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("can't read {path}: {e}"))).unwrap()
}

#[derive(serde::Deserialize)]
struct Rows {
    rows: Vec<ActionRow>,
}

/// The door's rows, each as written and as read into this crate's `ActionRow` (from the text, so its arguments
/// keep the order they were written in).
fn door_rows() -> Vec<(Value, ActionRow)> {
    let path = format!("{}/../outline-core/fixtures/action-rows.json", env!("CARGO_MANIFEST_DIR"));
    let read: Rows = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap_or_else(|e| panic!("a row of the door's doesn't read as an ActionRow: {e}"));
    fixture("action-rows.json")["rows"].as_array().unwrap().iter().cloned().zip(read.rows).collect()
}

#[test]
fn every_row_the_door_has_reads_as_an_action_row_and_writes_back_the_same() {
    let rows = door_rows();
    assert!(rows.len() > 600, "the fixture holds every action the door has: {}", rows.len());
    for (written, row) in &rows {
        assert_eq!(&serde_json::to_value(row).unwrap(), written, "{} in {}", row.id, row.scope.unwrap_or(""));
    }
}

#[test]
fn every_action_here_is_a_row_of_that_shape_with_one_name_and_an_example_when_it_takes_arguments() {
    let mut names = std::collections::HashSet::new();
    for action in actions::all() {
        let row = action.row;
        assert!(names.insert(row.id), "{} is named twice", row.id);
        let written = serde_json::to_value(row).unwrap();
        assert_eq!(serde_json::from_str::<ActionRow>(&serde_json::to_string(row).unwrap()).unwrap(), *row, "{} reads back as itself", row.id);
        for field in ["id", "summary", "args", "touches"] { assert!(written.get(field).is_some(), "{} has {field}", row.id) }
        assert!(row.required().next().is_none() || !row.examples.is_empty(), "{} can't run without arguments, so it shows a call that works", row.id);
        // An example is a real call: it reads, names this action and types by the row.
        for example in row.examples {
            let req = actline::parse(example.act).unwrap_or_else(|e| panic!("{}: {e:?}", example.act));
            assert_eq!(req.action, row.id);
            actline::coerce(row, &req.args).unwrap_or_else(|e| panic!("{}: {}", example.act, e.0));
        }
        assert!(!row.key_rows().is_empty(), "{} says how the person reaches it: a key, or a way that is none", row.id);
    }
}

/// The two doors share a vocabulary: an action here that the door also has takes arguments the door's takes, by
/// the same names and types. (What each touches is the door's own to say of its screens.)
#[test]
fn an_action_the_door_also_has_takes_arguments_by_the_door_s_names_and_types() {
    let door = door_rows();
    let mut shared = Vec::new();
    for action in actions::all() {
        let theirs: Vec<&ActionRow> = door.iter().map(|(_, row)| row).filter(|row| row.id == action.row.id).collect();
        if theirs.is_empty() { continue }
        shared.push(action.row.id);
        for (name, spec) in action.row.args.iter() {
            let found: Vec<ArgType> = theirs.iter().filter_map(|row| row.args.get(name)).map(|spec| spec.ty).collect();
            assert!(found.contains(&spec.ty), "{}: the door's row has no {name} of that type ({found:?})", action.row.id);
        }
    }
    for id in ["open", "back", "link.follow", "edit", "edit.save", "edit.close", "note.new", "note.trash", "note.untrash", "note.move", "bar.open", "bar.close", "bar.pick", "tree.pick", "tree.fold"] {
        assert!(shared.contains(&id), "{id} is the door's name for it too");
    }
}

#[test]
fn every_line_of_the_fixture_reads_as_the_door_reads_it() {
    let (lines, door) = (fixture("act-lines.json"), door_rows());
    let mut typed = 0;
    for case in lines["lines"].as_array().unwrap() {
        let line = case["line"].as_str().unwrap();
        let words = actline::line_words(line);
        assert_eq!(json!(words), case["words"], "the words of {line:?}");
        let req = actline::request_of(&words, case["repeats"] == "list");
        if let Some(why) = case["refused"].as_str() {
            assert_eq!(req.as_ref().err().map(|e| e.0.as_str()), Some(why), "{line:?}");
            continue;
        }
        let req = req.unwrap_or_else(|e| panic!("{line:?} is refused here: {}", e.0));
        let mut written = json!({ "action": req.action, "args": req.args });
        if let Some(by) = &req.by { written["as"] = json!(by) }
        if let Some(tile) = &req.tile { written["tile"] = json!(tile) }
        assert_eq!(written, case["request"], "the request {line:?} is");
        if case.get("args").is_none() && case.get("argsRefused").is_none() { continue }
        // Typed by the action's row, as the door's row for it types them.
        let rows: Vec<&ActionRow> = door.iter().map(|(_, row)| row).filter(|row| row.id == req.action).collect();
        assert!(!rows.is_empty(), "the fixture has a row for {}", req.action);
        let answers: Vec<Value> = rows.iter().map(|row| match actline::coerce(row, &req.args) { Ok(args) => json!({ "args": args.json() }), Err(why) => json!({ "argsRefused": why.0 }) }).collect();
        let expected = match case.get("args") { Some(args) => json!({ "args": args }), None => json!({ "argsRefused": case["argsRefused"] }) };
        assert!(answers.contains(&expected), "{line:?} types as {expected}, here: {answers:?}");
        typed += 1;
    }
    assert!(typed >= 9, "the typed cases ran: {typed}");
}

#[test]
fn a_tile_is_one_of_five_kinds_of_address() {
    for case in fixture("act-lines.json")["addresses"].as_array().unwrap() {
        let tile = case["tile"].as_str().unwrap();
        assert_eq!(Address::parse(tile).json(tile), case["address"], "tile={tile}");
    }
}
