//! Probe 2: can a kit `TextInput` or `TextArea` be wrapped so the key table sees chords first, the field gets text
//! second, and what neither takes goes up to the window?
//!
//! DESIGN.md §4: "How a field passes keys: one `field()` adapter in `keys.rs`: table first, text second, unhandled
//! up". Here the adapter is `table_first`, the one closure every field's `on_key` gets, whatever kit part draws it.

use std::collections::HashMap;

use ep0ch_native_probes::*;
use rune::{Chord, Cx, El, Key, KeyEvent, Mods, Runtime, TextEdit, Tx, col, row};
use rune_kit::{Kit, TextArea, TextInput};

/// One row of the key table: a chord sequence in the door's own names (`ctrl+w q`), the layer it belongs to and the
/// act line it runs.
struct Row {
    keys: Vec<Chord>,
    layer: &'static str,
    line: &'static str,
}

fn bind(spec: &str, layer: &'static str, line: &'static str) -> Row {
    Row { keys: spec.split_whitespace().map(|c| Chord::parse(c).unwrap_or_else(|e| panic!("{c}: {e:?}"))).collect(), layer, line }
}

struct Desk {
    table: Vec<Row>,
    /// The chords of a sequence pressed so far.
    pending: Vec<KeyEvent>,
    /// Every act line the table ran, with where the keys were.
    ran: Vec<String>,
    /// Every stage a key reached after the table said no, in order.
    passed: Vec<String>,
    /// One field per tile, by tile name: the shell's `HashMap<TileId, TileUi>`.
    fields: HashMap<String, TextEdit>,
    submitted: u32,
}

fn desk() -> Desk {
    Desk {
        table: vec![
            bind("mod+k", "any", "bar.open"),
            bind("ctrl+w q", "any", "tile.close"),
            bind("mod+enter", "field", "draft.save"),
            bind("escape", "field", "draft.leave"),
            bind("tab", "field", "completion.accept"),
            bind("mod+z", "field", "layout.undo"),
            bind("j", "tile", "list.down"),
        ],
        pending: vec![],
        ran: vec![],
        passed: vec![],
        fields: ["seeds", "notes", "beds", "log"].into_iter().map(|t| (t.to_owned(), TextEdit::default())).collect(),
        submitted: 0,
    }
}

impl Desk {
    /// The key table's one answer for a key: true when a row took it (or it started a sequence).
    fn table_takes(&mut self, e: &KeyEvent, tx: &Tx, layer: &str, at: &str) -> bool {
        let mut seq = std::mem::take(&mut self.pending);
        seq.push(e.clone());
        let fits = |row: &Row| (row.layer == "any" || row.layer == layer) && row.keys.len() >= seq.len() && row.keys.iter().zip(&seq).all(|(c, e)| c.matches_tx(e, tx));
        let Some(row) = self.table.iter().find(|r| fits(r)) else { return false };
        if row.keys.len() == seq.len() { self.ran.push(format!("{} @{at}", row.line)) } else { self.pending = seq }
        true
    }
}

/// The adapter: what every field's `on_key` is. The table first; false hands the key to the editor.
///
/// A `lines` field is a note's source, not a chat composer: Rune's editor answers plain Return in a paragraph with
/// "submit", so the adapter types the line itself (after the table had its say).
fn table_first(tile: String, lines: bool) -> impl Fn(&mut Desk, &KeyEvent, &mut Tx) -> bool {
    move |s, e, tx| {
        let at = format!("field:{tile}");
        if s.table_takes(e, tx, "field", &at) { return true }
        if lines && e.key == Key::Enter && e.mods == Mods::default() {
            s.fields.get_mut(&tile).unwrap().insert("\n");
            return true;
        }
        s.passed.push(format!("editor {:?}", e.key));
        false
    }
}

fn edit_of(tile: String) -> impl for<'a> Fn(&'a mut Desk) -> &'a mut TextEdit {
    move |s| s.fields.get_mut(&tile).unwrap()
}

fn tile(name: &'static str, body: El) -> El {
    col()
        .key(format!("tile/{name}"))
        .focusable(true)
        .size(220.0, 200.0)
        .on_key(move |s: &mut Desk, e: &KeyEvent, tx: &mut Tx| {
            let at = format!("tile:{name}");
            s.table_takes(e, tx, "tile", &at) || { s.passed.push(format!("tile {:?}", e.key)); false }
        })
        .child(body)
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = Kit::neutral(cx.system_dark());
    let seeds = TextInput::new(&s.fields["seeds"]).on_edit(edit_of("seeds".into())).on_key(table_first("seeds".into(), false)).on_submit(|s: &mut Desk, _: &mut Tx| s.submitted += 1).build(&k).key("tile/seeds/field");
    let notes = TextArea::new(&s.fields["notes"]).rows(4).on_edit(edit_of("notes".into())).on_key(table_first("notes".into(), true)).build(&k).key("tile/notes/field");
    // Fields with no adapter, to see what Rune does alone.
    let bare = TextInput::new(&s.fields["beds"]).on_edit(edit_of("beds".into())).build(&k).key("tile/beds/field");
    let bare_area = TextArea::new(&s.fields["log"]).rows(4).on_edit(edit_of("log".into())).build(&k).key("tile/log/field");
    row().child(tile("seeds", seeds)).child(tile("notes", notes)).child(tile("beds", bare)).child(tile("log", bare_area))
}

fn window_keys(s: &mut Desk, e: &KeyEvent, tx: &mut Tx) -> bool {
    s.passed.push(format!("window {:?} focused={:?}", e.key, tx.focused()));
    false
}

fn window(focus: &str) -> Runtime<Desk> {
    let mut rt = Runtime::new(desk(), view, (900.0, 240.0), env());
    rt.on_key = Some(window_keys);
    turn(&mut rt);
    let key = focus.to_owned();
    rt.update(move |_, tx| tx.focus(key, false));
    turn(&mut rt);
    rt
}

fn command(ch: char) -> Key { Key::Command(ch) }

#[test]
fn a_chord_in_the_table_runs_its_line_and_the_field_never_sees_it() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "kale");
    chord(&mut rt, command('k'), primary());
    assert_eq!(rt.state.ran, ["bar.open @field:seeds"]);
    assert_eq!(rt.state.fields["seeds"].text, "kale");
    assert!(rt.state.fields["seeds"].focused, "and the field keeps the keys");
    assert!(!rt.state.passed.iter().any(|p| p.contains("Command('k')")), "no later stage heard it: {:?}", rt.state.passed);
}

#[test]
fn text_reaches_the_field_and_a_letter_bound_in_the_tile_layer_types() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "jam");
    assert_eq!(rt.state.fields["seeds"].text, "jam", "`j` is list.down in a tile; in a field the table says no and it types");
    assert!(rt.state.ran.is_empty());
    // The same key with the tile focused, not the field.
    rt.update(|_, tx| tx.focus("tile/seeds", false));
    turn(&mut rt);
    typed(&mut rt, "j");
    assert_eq!(rt.state.ran, ["list.down @tile:seeds"]);
    assert_eq!(rt.state.fields["seeds"].text, "jam");
}

#[test]
fn the_editor_s_own_commands_stay_the_editor_s_when_the_table_does_not_list_them() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "kale");
    chord(&mut rt, command('a'), primary());
    typed(&mut rt, "x");
    assert_eq!(rt.state.fields["seeds"].text, "x", "select all, then the letter replaced it");
    key(&mut rt, Key::Left);
    typed(&mut rt, "y");
    assert_eq!(rt.state.fields["seeds"].text, "yx");
    assert!(rt.state.ran.is_empty());
}

#[test]
fn the_table_wins_over_the_editor_for_a_chord_both_know() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "kale");
    chord(&mut rt, command('z'), primary());
    assert_eq!(rt.state.ran, ["layout.undo @field:seeds"]);
    assert_eq!(rt.state.fields["seeds"].text, "kale", "the editor's own undo did not run: binding it in the field layer is the table's choice");
}

#[test]
fn return_escape_and_tab_are_the_table_s_before_submit_dismiss_and_focus_navigation() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "ka");
    key(&mut rt, Key::Tab);
    assert_eq!(rt.state.ran, ["completion.accept @field:seeds"]);
    assert!(rt.state.fields["seeds"].focused, "Tab did not move focus");
    key(&mut rt, Key::Escape);
    chord(&mut rt, Key::Enter, primary());
    assert_eq!(rt.state.ran[1..], ["draft.leave @field:seeds", "draft.save @field:seeds"]);
    assert_eq!(rt.state.submitted, 0);
    key(&mut rt, Key::Enter);
    assert_eq!(rt.state.submitted, 1, "plain Return isn't in the table, so the field's on_submit has it");
}

#[test]
fn a_two_chord_sequence_is_held_by_the_table_and_its_second_key_is_not_typed() {
    let mut rt = window("tile/notes/field");
    typed(&mut rt, "sow ");
    let ctrl = Mods { ctrl: true, cmd: !cfg!(target_os = "macos"), ..Mods::default() };
    chord(&mut rt, command('w'), ctrl);
    assert!(rt.state.ran.is_empty() && rt.state.pending.len() == 1, "the first chord is taken and waits");
    typed(&mut rt, "q");
    assert_eq!(rt.state.ran, ["tile.close @field:notes"]);
    assert_eq!(rt.state.fields["notes"].text, "sow ", "`q` finished the sequence instead of typing");
    // A sequence that doesn't finish lets its second key through.
    chord(&mut rt, command('w'), ctrl);
    typed(&mut rt, "x");
    assert_eq!(rt.state.fields["notes"].text, "sow x");
    assert!(rt.state.pending.is_empty());
}

#[test]
fn a_text_area_takes_the_same_adapter_and_the_adapter_makes_return_type_a_line() {
    let mut rt = window("tile/notes/field");
    typed(&mut rt, "one");
    key(&mut rt, Key::Enter);
    typed(&mut rt, "two");
    assert_eq!(rt.state.fields["notes"].text, "one\ntwo");
    chord(&mut rt, Key::Enter, primary());
    chord(&mut rt, command('k'), primary());
    assert_eq!(rt.state.ran, ["draft.save @field:notes", "bar.open @field:notes"]);
    assert_eq!(rt.state.fields["notes"].text, "one\ntwo");
}

#[test]
fn return_in_a_kit_text_area_alone_submits_and_types_no_line() {
    let mut rt = window("tile/log/field");
    typed(&mut rt, "one");
    key(&mut rt, Key::Enter);
    typed(&mut rt, "two");
    assert_eq!(rt.state.fields["log"].text, "onetwo", "the finding: plain Return in a paragraph is the editor's submit, and with no on_submit it goes to the default button");
    chord(&mut rt, Key::Enter, Mods { shift: true, ..Mods::default() });
    typed(&mut rt, "three");
    assert_eq!(rt.state.fields["log"].text, "onetwo\nthree", "Shift+Return (or Option+Return) is what types the line");
}

#[test]
fn what_neither_takes_goes_up_to_the_window_and_skips_the_tile_s_on_key() {
    let mut rt = window("tile/seeds/field");
    key(&mut rt, Key::Function(5));
    assert_eq!(rt.state.passed, ["editor Function(5)", "window Function(5) focused=Some(\"input\")"], "the adapter, the editor, then the window's on_key naming the focused element; an ancestor's El::on_key never hears a field's keys");
    rt.state.passed.clear();
    chord(&mut rt, command('j'), primary());
    assert_eq!(rt.state.passed.len(), 2, "{:?}", rt.state.passed);
    // With the tile itself focused, the tile's on_key is first and the window's second.
    rt.state.passed.clear();
    rt.update(|_, tx| tx.focus("tile/seeds", false));
    turn(&mut rt);
    key(&mut rt, Key::Function(5));
    assert_eq!(rt.state.passed, ["tile Function(5)", "window Function(5) focused=Some(\"tile/seeds\")"]);
}

#[test]
fn keys_the_editor_uses_stop_at_the_editor() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "kale");
    rt.state.passed.clear();
    key(&mut rt, Key::Left);
    key(&mut rt, Key::Backspace);
    assert_eq!(rt.state.passed, ["editor Left", "editor Backspace"], "nothing above the field heard them");
    assert_eq!(rt.state.fields["seeds"].text, "kae");
}

#[test]
fn up_and_down_in_a_single_line_field_stop_at_the_editor() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "ka");
    rt.state.passed.clear();
    key(&mut rt, Key::Down);
    key(&mut rt, Key::Up);
    assert_eq!(rt.state.passed, ["editor Down", "editor Up"], "they never reach the window: a list under a bar's field gets them only as rows of the table's field layer");
}

#[test]
fn a_field_without_the_adapter_lets_the_editor_answer_first() {
    let mut rt = window("tile/beds/field");
    typed(&mut rt, "bed");
    chord(&mut rt, command('k'), primary());
    assert_eq!(rt.state.passed, ["window Command('k') focused=Some(\"input\")"], "a chord the editor has no use for reaches the window's on_key, after the editor");
    chord(&mut rt, command('z'), primary());
    assert_ne!(rt.state.fields["beds"].text, "bed", "a chord the editor knows (undo) never leaves it: only the adapter puts the table first");
    assert!(rt.state.ran.is_empty());
}

#[test]
fn n_fields_from_one_map_share_the_adapter_and_each_names_its_tile() {
    let mut rt = window("tile/seeds/field");
    typed(&mut rt, "kale");
    click(&mut rt, "tile/notes/field");
    typed(&mut rt, "thin the rows");
    chord(&mut rt, command('k'), primary());
    assert_eq!(rt.state.fields["seeds"].text, "kale");
    assert_eq!(rt.state.fields["notes"].text, "thin the rows");
    assert_eq!(rt.state.ran, ["bar.open @field:notes"]);
}

