//! Probe 6: `memo(tile.id, version)`: does a per-tile memo skip re-running an unchanged tile's view? Measured.
//!
//! DESIGN.md §5, Frame cost: "each tile draws in `memo(tile.id, version)` over its spec, slot generations, focus,
//! cursor, scroll and draft revision". Every handled event re-runs the whole view, so without it one tile's change
//! builds every tile.

use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

use ep0ch_native_probes::*;
use rune::{Cx, El, GrowthSpec, Runtime, ScrollSpec, Span, TextEdit, col, memo, rich, row, text};
use rune_kit::{Kit, TextInput};

const TILES: usize = 8;
const ROWS: usize = 150;

struct TileUi {
    /// Stands for the tile's slot generations: bumped when what it shows changed.
    generation: u64,
    cursor: usize,
    field: TextEdit,
    /// How many times this tile's draw ran.
    builds: Rc<Cell<u32>>,
}

struct Desk {
    order: Vec<String>,
    tiles: HashMap<String, TileUi>,
    focus: String,
    weights: Vec<f32>,
    memoized: bool,
    /// Something outside every tile that changes: the status line's count.
    tick: u32,
    /// Leave the cursor out of the version, to see what goes stale.
    forget_cursor: bool,
    views: Rc<Cell<u32>>,
}

fn desk(memoized: bool) -> Desk {
    let order: Vec<String> = (0..TILES).map(|i| format!("bed{i}")).collect();
    Desk {
        tiles: order.iter().map(|id| (id.clone(), TileUi { generation: 0, cursor: 0, field: TextEdit::default(), builds: Rc::new(Cell::new(0)) })).collect(),
        focus: order[0].clone(),
        weights: vec![1.0; TILES],
        order,
        memoized,
        tick: 0,
        forget_cursor: false,
        views: Rc::new(Cell::new(0)),
    }
}

/// One tile's drawer: a title, a field and a list of rich rows. Everything it reads is in `version` below.
fn draw(s: &Desk, k: &Kit, id: &str) -> El {
    let ui = &s.tiles[id];
    ui.builds.set(ui.builds.get() + 1);
    let field_id = id.to_owned();
    let field = TextInput::new(&ui.field).on_edit(move |s: &mut Desk| &mut s.tiles.get_mut(&field_id).unwrap().field).build(k).key(format!("tile/{id}/field"));
    let rows = (0..ROWS).map(|i| {
        let line = format!("{} row {i} of generation {}", if ui.cursor == i { ">" } else { " " }, ui.generation);
        let spans = vec![Span::new(0, 1).bold(), Span::new(2, 5).color(rune::oklch(0.6, 0.15, 30.0)), Span::new(6, line.len()).mono()];
        // A handler in a memo keeps what it captured at build: capture ids, read the state when it runs.
        let (tile, at) = (id.to_owned(), i);
        row().key(format!("tile/{id}/row/{i}")).h(18.0).child(rich(line, spans)).on_press(move |s: &mut Desk| s.tiles.get_mut(&tile).unwrap().cursor = at)
    });
    col()
        .grow(1.0)
        .min_h(0.0)
        .child(text(format!("{id}{}", if s.focus == id { " (focus)" } else { "" })).key(format!("tile/{id}/title")))
        .child(field)
        .child(col().key(format!("tile/{id}/scroll")).scroll(ScrollSpec { stick_bottom: false }).grow(1.0).min_h(0.0).child(col().growth(GrowthSpec::default()).children(rows)))
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    s.views.set(s.views.get() + 1);
    let k = Kit::neutral(cx.system_dark());
    let tiles = row().key("row").size(1600.0, 600.0).children(s.order.iter().enumerate().map(|(i, id)| {
        let ui = &s.tiles[id];
        let shell = col().key(format!("tile/{id}")).grow(s.weights[i]).min_w(0.0).h_full();
        let body = if s.memoized {
            let cursor = if s.forget_cursor { 0 } else { ui.cursor };
            // The memo's id becomes its root element's key, so it is namespaced like any other.
            memo(format!("tile/{id}/body"), (ui.generation, cursor, s.focus == *id, &ui.field), || draw(s, &k, id))
        } else {
            draw(s, &k, id)
        };
        shell.child(body)
    }));
    col().child(tiles).child(text(format!("{} answers landed", s.tick)).key("status"))
}

fn window(memoized: bool) -> Runtime<Desk> {
    let mut rt = Runtime::new(desk(memoized), view, (1600.0, 600.0), env());
    turn(&mut rt);
    rest(&mut rt);
    // One more view run: see `a_tile_with_a_kit_field_draws_once_more_after_its_first_layout`.
    rt.invalidate();
    turn(&mut rt);
    rt
}

fn builds(rt: &Runtime<Desk>) -> Vec<u32> { rt.state.order.iter().map(|id| rt.state.tiles[id].builds.get()).collect() }

/// How many times each tile was drawn while `f` ran.
fn drawn(rt: &mut Runtime<Desk>, f: impl FnOnce(&mut Runtime<Desk>)) -> Vec<u32> {
    let before = builds(rt);
    f(rt);
    builds(rt).iter().zip(before).map(|(after, before)| after - before).collect()
}

#[test]
fn a_tile_with_a_kit_field_draws_once_more_after_its_first_layout() {
    let mut rt = Runtime::new(desk(true), view, (1600.0, 600.0), env());
    turn(&mut rt);
    rest(&mut rt);
    assert_eq!(builds(&rt), [1; TILES]);
    // The kit's field reads its own laid-out size while it builds; Rune tracks that read for the memo around it. It
    // read nothing before the first layout, so the next view run builds each tile once more. Then they hold.
    let d = drawn(&mut rt, |rt| {
        rt.invalidate();
        turn(rt);
    });
    assert_eq!(d, [1; TILES]);
    let d = drawn(&mut rt, |rt| {
        rt.invalidate();
        turn(rt);
        rt.invalidate();
        turn(rt);
    });
    assert_eq!(d, [0; TILES], "a view run with nothing changed draws no tile");
}

#[test]
fn one_tile_s_change_draws_that_tile_and_no_other() {
    let mut rt = window(true);
    let d = drawn(&mut rt, |rt| {
        rt.update(|s, _| s.tiles.get_mut("bed3").unwrap().generation += 1);
        turn(rt);
    });
    assert_eq!(d, [0, 0, 0, 1, 0, 0, 0, 0]);
    assert_eq!(element(&rt, "tile/bed3/row/7").and_then(|e| e.parent).is_some(), true);
    // Without the memo the same change draws all eight.
    let mut rt = window(false);
    let d = drawn(&mut rt, |rt| {
        rt.update(|s, _| s.tiles.get_mut("bed3").unwrap().generation += 1);
        turn(rt);
    });
    assert_eq!(d, [1; TILES]);
}

#[test]
fn typing_in_one_tile_s_field_draws_only_that_tile_and_the_field_keeps_the_keys() {
    let mut rt = window(true);
    click(&mut rt, "tile/bed5/field");
    let d = drawn(&mut rt, |rt| typed(rt, "kale"));
    assert_eq!(d, [0, 0, 0, 0, 0, 4, 0, 0], "the TextEdit is in the version: one draw per key, in its own tile");
    assert_eq!(rt.state.tiles["bed5"].field.text, "kale");
}

#[test]
fn a_press_inside_a_reused_tile_still_runs_its_handler() {
    let mut rt = window(true);
    // Draw the others once more so bed2 is certainly a reused subtree.
    rt.update(|s, _| s.tiles.get_mut("bed0").unwrap().generation += 1);
    turn(&mut rt);
    let d = drawn(&mut rt, |rt| click(rt, "tile/bed2/row/4"));
    assert_eq!(rt.state.tiles["bed2"].cursor, 4);
    assert_eq!(d, [0, 0, 1, 0, 0, 0, 0, 0], "and the cursor is in the version, so its tile drew the new mark");
    assert_eq!(element(&rt, "tile/bed2/row/4").unwrap().parent.is_some(), true);
}

#[test]
fn what_a_tile_reads_and_leaves_out_of_its_version_goes_stale_on_screen() {
    let mut rt = window(true);
    rt.update(|s, _| s.forget_cursor = true);
    turn(&mut rt);
    let row_text = |rt: &Runtime<Desk>, i: usize| {
        let row = rt.elements().iter().position(|e| e.key.as_deref() == Some(&format!("tile/bed1/row/{i}"))).unwrap();
        rt.elements().into_iter().find(|e| e.parent == Some(row)).and_then(|e| e.text).unwrap()
    };
    let d = drawn(&mut rt, |rt| click(rt, "tile/bed1/row/3"));
    assert_eq!(rt.state.tiles["bed1"].cursor, 3, "the state changed");
    assert_eq!(d, [0; TILES], "nothing drew");
    assert!(row_text(&rt, 3).starts_with(' '), "and row 3 still shows no mark: the finding, and why the version lists the cursor");
}

#[test]
fn a_divider_drag_reflows_memoized_tiles_without_drawing_one() {
    let mut rt = window(true);
    let before = rect(&rt, "tile/bed0")[2];
    let d = drawn(&mut rt, |rt| {
        for step in 1..=10 {
            rt.update(move |s, tx| {
                s.weights[0] = 1.0 + step as f32 * 0.1;
                tx.instant();
            });
            turn(rt);
        }
    });
    assert_eq!(d, [0; TILES], "layout runs for a reused subtree; its drawer does not");
    assert!(rect(&rt, "tile/bed0")[2] > before + 100.0, "{} -> {}", before, rect(&rt, "tile/bed0")[2]);
}

#[test]
fn focus_moving_between_tiles_draws_the_two_it_touches() {
    let mut rt = window(true);
    let d = drawn(&mut rt, |rt| {
        rt.update(|s, _| s.focus = "bed6".into());
        turn(rt);
    });
    assert_eq!(d, [1, 0, 0, 0, 0, 0, 1, 0]);
}

/// Wall-clock cost of one frame, with and without the per-tile memo, for two changes: one tile's data, and
/// something outside every tile (the status line). `cargo test --release --test memo measure -- --nocapture
/// --test-threads 1` prints the numbers PROBES.md quotes.
#[test]
fn measure_a_frame_with_and_without_the_per_tile_memo() {
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    let mut medians = Vec::new();
    for memoized in [false, true] {
        let mut rt = window(memoized);
        let elements = rt.elements().len();
        let mut one_tile = Vec::new();
        for i in 0..80 {
            let id = format!("bed{}", i % TILES);
            rt.update(move |s, _| s.tiles.get_mut(&id).unwrap().generation += 1);
            one_tile.push(ms(|| turn(&mut rt)));
        }
        let mut status = Vec::new();
        for _ in 0..80 {
            rt.update(|s, _| s.tick += 1);
            status.push(ms(|| turn(&mut rt)));
        }
        let ((tile_median, tile_worst), (status_median, status_worst)) = (median_max(one_tile), median_max(status));
        println!("memo={memoized} ({profile}, {elements} elements, {TILES} tiles of {ROWS} rows): one tile changed: median {tile_median:.2} ms, worst {tile_worst:.2} ms; only the status line changed: median {status_median:.2} ms, worst {status_worst:.2} ms");
        medians.push((tile_median, status_median));
    }
    assert!(medians[1].1 < medians[0].1, "a frame that changes no tile is cheaper with the memo: {medians:?}");
}
