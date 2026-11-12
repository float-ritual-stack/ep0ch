//! One act, three ways in, one record. Every action is run by its chord (a key through the window), by its row
//! in the bar pressed (a click through the window), and by its act line (the dispatcher asked outright), each
//! from the same garden in the same state; the step each leaves is compared whole: the line, the actor, whether
//! it ran and what it said.
//!
//! The cases are read from the rows: one for every key row (the action with that key's arguments), and one from
//! the row's first example (or the action alone) for an action no key reaches.
use rune::Runtime;

use super::support::*;
use crate::actions::row::KeyRow;
use crate::actions::{self, Actor, App, Step, word};
use crate::keys::{self, Bind};

/// What has to be so before an action can run, as act lines: the bar's own keys need the bar, the editor's the editor.
fn setup(action: &str, on: Option<&str>) -> Vec<&'static str> {
    let mut lines = match action {
        "back" => vec!["open id=shed"],
        "note.untrash" => vec!["note.trash ref=beans"],
        "notice.dismiss" => vec!["link.follow ref=ep0ch:p/Seed%20list"],
        "edit.save" | "edit.close" => vec!["edit"],
        _ => vec![],
    };
    match on { Some("bar") => lines.push("bar.open"), Some("draft") if !lines.contains(&"edit") => lines.push("edit"), _ => {} }
    lines
}

/// The examples name notes by ids nobody has: here they are the garden's.
fn here(line: &str) -> String { line.replace("7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", "beans").replace("confirm=7d9a1f40", "confirm=beans") }

struct Case { action: &'static str, line: String, bind: Option<&'static Bind>, on: Option<&'static str> }

fn cases() -> Vec<Case> {
    let mut out = Vec::new();
    for action in actions::all() {
        let row = action.row;
        let before = out.len();
        for key in row.key_rows() {
            let KeyRow::Keys { on, args, .. } = key else { continue };
            let line = std::iter::once(row.id.to_string()).chain(args.iter().map(|(k, v)| format!("{k}={}", word(&v.word())))).collect::<Vec<_>>().join(" ");
            let bind = keys::table().iter().find(|bind| bind.line == line && bind.layer.map(keys::Layer::name) == *on);
            assert!(bind.is_some(), "{line}'s key row is in the table");
            out.push(Case { action: row.id, line, bind, on: *on });
        }
        if out.len() == before { out.push(Case { action: row.id, line: here(row.examples.first().map_or(row.id, |example| example.act)), bind: None, on: None }) }
    }
    out
}

/// A garden in the state the case needs, drawn.
fn ready(case: &Case) -> Runtime<App> {
    let mut app = garden(ok()).app;
    for line in setup(case.action, case.on) { assert!(act(&mut app, line).ok, "{line} sets up {}", case.line) }
    let mut rt = window(app);
    rest(&mut rt);
    rt
}

/// The step the case's action left: the newest of that action, as itself.
fn step_of(rt: &Runtime<App>, case: &Case, from: usize) -> Step {
    rt.state.steps[from..].iter().rev().find(|step| step.action == case.action).cloned().unwrap_or_else(|| panic!("{} left no step: {:?}", case.line, rt.state.steps.iter().map(Step::line).collect::<Vec<_>>()))
}

fn by_line(case: &Case) -> Step {
    let mut rt = ready(case);
    let from = rt.state.steps.len();
    let line = case.line.clone();
    rt.update(move |s, _| { s.act(&line, Actor::Person); });
    rest(&mut rt);
    step_of(&rt, case, from)
}

fn by_chord(case: &Case, bind: &Bind) -> Step {
    let mut rt = ready(case);
    let from = rt.state.steps.len();
    for chord in &bind.chords { rt.key(event(chord)); rest(&mut rt); }
    step_of(&rt, case, from)
}

/// A chord as the key event the platform sends for it.
fn event(chord: &rune::Chord) -> rune::KeyEvent {
    use rune::{ChordKey, ChordMod, Key, Mods};
    let primary = chord.has(ChordMod::Primary);
    let mods = Mods { shift: chord.has(ChordMod::Shift), alt: chord.has(ChordMod::Alt), cmd: primary, ctrl: chord.has(ChordMod::Ctrl) || (primary && !cfg!(target_os = "macos")), logo: chord.has(ChordMod::Super) || (primary && cfg!(target_os = "macos")) };
    let key = match chord.key() {
        ChordKey::Char(c) if primary => Key::Command(c),
        ChordKey::Char(c) => Key::Text(c.to_string()),
        ChordKey::Enter => Key::Enter,
        ChordKey::Escape => Key::Escape,
        ChordKey::Backspace => Key::Backspace,
        ChordKey::Up => Key::Up,
        ChordKey::Down => Key::Down,
        ChordKey::Left => Key::Left,
        ChordKey::Right => Key::Right,
        other => panic!("the parity table has no key event for {other:?} yet"),
    };
    rune::KeyEvent { key, mods }
}

fn by_bar(case: &Case) -> Step {
    let mut rt = ready(case);
    // The bar on the actions, with the case's line typed: its row is the action's own, or the line as written.
    let line = case.line.clone();
    rt.update(move |s, _| { s.act(&format!("bar.open scope=actions query={}", word(&line)), Actor::Person); });
    rest(&mut rt);
    let row = crate::bar::rows(&rt.state).into_iter().find(|row| row.line == case.line && !row.fill).unwrap_or_else(|| panic!("the bar lists {}", case.line));
    let from = rt.state.steps.len();
    press(&mut rt, &crate::bar::row_key(&row));
    step_of(&rt, case, from)
}

#[test]
fn every_action_leaves_the_same_step_by_its_chord_by_its_bar_row_and_by_its_act_line() {
    let (mut three, mut two, mut no_chord) = (0, 0, Vec::new());
    for case in cases() {
        let line = by_line(&case);
        assert_eq!((line.line(), &line.by), (case.line.clone(), &Actor::Person), "the line ran as written");
        assert!(line.ok, "{} runs from its setup: {}", case.line, line.said);
        // The bar's own keys are pressed on the bar that is open: its list is not a way to them, the bar is.
        let bars_own = case.on == Some("bar");
        if !bars_own { assert_eq!(by_bar(&case), line, "{}: its bar row pressed and its act line leave one record", case.line) }
        match case.bind {
            Some(bind) => {
                assert_eq!(by_chord(&case, bind), line, "{}: {} and its act line leave one record", case.line, bind.spec);
                if bars_own { two += 1 } else { three += 1 }
            }
            None => {
                // No key reaches it (it takes an argument a key can't name): its row says the way that does.
                assert!(actions::find(case.action).unwrap().row.key_rows().iter().any(|key| matches!(key, KeyRow::Via { .. })), "{} has no key, so its row says how the person reaches it", case.action);
                no_chord.push(case.action);
                two += 1;
            }
        }
    }
    assert!(three >= 12, "most actions run all three ways: {three}");
    assert_eq!(no_chord, ["open", "link.follow", "note.untrash", "bar.narrow", "tree.pick", "tree.fold"], "the actions no key reaches, each by a press its row names ({two} cases ran two ways)");
}

#[test]
fn every_chord_in_the_table_reads_and_none_is_bound_twice_where_the_person_can_be() {
    let table = keys::table();
    assert!(table.len() >= 18, "{}", table.len());
    for (i, a) in table.iter().enumerate() {
        for b in &table[i + 1..] {
            let clash = a.spec == b.spec && (a.layer == b.layer || a.layer.is_none() || b.layer.is_none());
            assert!(!clash, "{} is bound to both {} and {}", a.spec, a.line, b.line);
        }
    }
}

/// The README's table of keys is the key table, row for row: written out for a person, kept true here.
#[test]
fn the_readme_s_keys_are_the_table() {
    let readme = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/README.md")).unwrap();
    let written: Vec<&str> = readme.split("<!-- keys").nth(1).and_then(|rest| rest.split("<!-- /keys -->").next()).expect("the README has its keys table").lines().filter(|line| line.starts_with("| `")).collect();
    let table: Vec<String> = keys::table().iter().map(|bind| format!("| `{}` | `{}` | {} | {} |", bind.spec, bind.line, bind.layer.map_or("everywhere", keys::Layer::name), bind.does)).collect();
    assert_eq!(written, table, "the README's keys, and the table's:\n{}", table.join("\n"));
}
