//! The third hydra sweep, held by what the window does: each test is a failure a second decider caused, pressed
//! through act lines alone, and goes red when one comes back. (`one_owner.rs` scans the source for the same thing.)
use serde_json::json;

use super::support::*;
use super::sweep2::{asked_for, laid, leaf, note_in, split, with};
use crate::actions::{Actor, App};

/// The rows a list tile shows, as the service answered them.
fn rows_in(app: &App, tile: &str) -> Vec<crate::page::ListRow> { app.layout.named(tile).and_then(|id| app.list_of(&id).map(|answer| answer.list.rows.clone())).unwrap_or_default() }
/// The act line of a row's own press, by what the press says.
fn press_of(app: &App, tile: &str, row: &str, says: &str) -> String {
    let rows = rows_in(app, tile);
    let row = rows.iter().find(|r| r.id == row).unwrap_or_else(|| panic!("{tile} lists no row {row}"));
    row.cells.iter().find(|cell| cell["text"] == says).and_then(|cell| cell["act"].as_str()).unwrap_or_else(|| panic!("{row:?} has no press {says}")).to_string()
}

// ── which reader a list about a note speaks for: one answer, for its subject, its mark, its press and its opens ────

/// A list of revisions that keeps its note (it doesn't follow) still lists that note's texts after the reader has
/// moved on. Its row's Restore names the note it is a text of, so it is refused in a reader that shows another:
/// revision 2 of one note never lands in another note's editor.
#[test]
fn a_revision_is_put_back_only_into_the_note_it_is_a_text_of() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), with(leaf("revisions", "kept"), json!({ "subject": "held" }))])) } }));
    assert!(act(&mut g.app, "open id=plot").ok);
    assert_eq!(asked_for(&g, "revisions")["of"], "plot", "it lists the note its home showed when it first listed");
    assert!(act(&mut g.app, "open id=shed").ok);
    assert_eq!((note_in(&g.app, "bed").as_deref(), asked_for(&g, "revisions")["of"].as_str()), (Some("shed"), Some("plot")), "the reader moved on, and the list kept its note");
    let restore = press_of(&g.app, "kept", "2", "Restore");
    assert_eq!(restore, "revision.restore of=\"plot\" revision=\"2\"", "the press names the note, as the service wrote it");
    let before = g.asked.borrow().len();
    let refused = g.app.act_in(&restore, "kept", Actor::Person);
    g.app.settle();
    assert!(!refused.ok && refused.said.contains("bed shows another note (shed), not plot"), "{}", refused.said);
    assert!(g.asked.borrow()[before..].iter().all(|a| a["action"] != "block.revisions"), "no text was asked for");
    assert!(g.app.draft_on(&g.app.layout.named("bed").unwrap()).is_none(), "and no editor opened on the other note");
    // Back on its note, the same press puts the text in.
    assert!(act(&mut g.app, "open id=plot").ok);
    let put = g.app.act_in(&restore, "kept", Actor::Person);
    g.app.settle();
    assert!(put.ok, "{}", put.said);
    assert!(g.app.draft_on(&g.app.layout.named("bed").unwrap()).is_some_and(|draft| draft.note == "plot"));
}

/// A list that follows another list (`source: tile:<a list>`) and has no wire of its own speaks for a reader all
/// the same: its row's open lands where the screen's opens land, never "in" the list it follows.
#[test]
fn a_list_that_follows_a_list_opens_its_rows_in_a_reader() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "found", "root": split(json!([with(leaf("query", "found"), json!({ "query": "type=chore" })), with(leaf("query", "also"), json!({ "query": "type=chore", "source": "tile:found" })), leaf("reader", "almanac"), leaf("reader", "bed")])) } }));
    let also = g.app.layout.named("also").unwrap();
    assert_eq!(g.app.home_of(&also).map(|id| g.app.layout.name(&id)).as_deref(), Some("bed"), "its home is a tile that reads notes");
    assert_eq!(g.app.facts(&also).home.as_deref(), Some("bed"), "and the layout's rules are told the same tile");
    let opened = g.app.act_in("open id=beans", "also", Actor::Person);
    g.app.settle();
    assert_eq!((opened.ok, opened.answer["tile"].as_str()), (true, Some("bed")), "{}", opened.said);
    assert_eq!(note_in(&g.app, "bed").as_deref(), Some("beans"));
}

/// One answer, whoever asks: a list whose selection feeds a second reader follows that reader's note, marks it as
/// the one open, tells the layout that reader is its home, and a press in it that acts on a note acts there.
#[test]
fn a_list_speaks_for_one_reader_whatever_is_asked_of_it() {
    let mut g = laid(json!({ "lands": "bed", "layout": { "focus": "bed", "root": split(json!([leaf("reader", "bed"), leaf("reader", "bench"), with(leaf("props", "about"), json!({ "wires": [{ "verb": "select", "to": "bench" }] }))])) } }));
    assert!(act(&mut g.app, "open id=plot tile=bed").ok && act(&mut g.app, "open id=shed tile=bench").ok);
    let about = g.app.layout.named("about").unwrap();
    assert_eq!((note_in(&g.app, "bed").as_deref(), note_in(&g.app, "bench").as_deref()), (Some("plot"), Some("shed")));
    assert_eq!(g.app.home_of(&about).map(|id| g.app.layout.name(&id)).as_deref(), Some("bench"));
    assert_eq!((g.app.subject_of(&about).as_deref(), g.app.home_note(&about).as_deref(), g.app.facts(&about).home.as_deref()), (Some("shed"), Some("shed"), Some("bench")), "its subject, its mark and its home are one reader's");
    assert_eq!(asked_for(&g, "properties")["of"], "shed");
    let edited = g.app.act_in("edit", "about", Actor::Person);
    g.app.settle();
    assert!(edited.ok, "{}", edited.said);
    assert_eq!(g.app.drafts.iter().map(|draft| g.app.layout.name(&draft.tile)).collect::<Vec<_>>(), ["bench"], "a press in it that acts on a note acts in that reader");
}
