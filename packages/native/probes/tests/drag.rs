//! Probe 3: can a drag handler read other tiles' rects to compute a drop side, and can dividers be dragged with
//! `on_drag`?
//!
//! DESIGN.md §7, Mouse: "dividers and title bars use `on_drag`; a drop point becomes `tile.move to= side=`". A drag
//! handler gets `&mut S`, a `Drag` and a `Tx`, never a `Cx`, so the question is how the rects reach it.

use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

use ep0ch_native_probes::*;
use rune::{Cx, Drag, El, Key, Phase, Runtime, Tx, col, el, row, text};

const NAMES: [&str; 3] = ["beds", "reader", "seeds"];
const DIVIDER: f32 = 6.0;

/// A row container of three tiles with a divider between each pair.
struct Desk {
    weights: Vec<f32>,
    /// The weights as a divider drag found them, to put back if the drag is cancelled.
    held: Option<Vec<f32>>,
    /// Every act line a drop produced.
    lines: Vec<String>,
    /// Where a title drag would land if let go now: drawn as the drop hint.
    hint: Option<(String, &'static str)>,
    /// Rects reported by `El::on_layout`, the second way a handler can know them.
    reported: HashMap<String, [f32; 4]>,
    /// What `Tx::element_at` picked under the pointer, the third way.
    picked: Vec<Option<String>>,
    views: Rc<Cell<u32>>,
    /// How the title's handler learns the rects.
    read: Read,
}

#[derive(Clone, Copy, PartialEq)]
enum Read {
    /// `Cx::layout` in the view, captured by the handler.
    Captured,
    /// `El::on_layout` writing state.
    Reported,
}

fn desk(read: Read) -> Desk {
    Desk { weights: vec![1.0, 1.0, 1.0], held: None, lines: vec![], hint: None, reported: HashMap::new(), picked: vec![], views: Rc::new(Cell::new(0)), read }
}

type Rects = Rc<Vec<(&'static str, [f32; 4])>>;

/// The tile under a window point and the side of it the point is nearest: a centre third, else the nearest edge.
fn drop_side(rects: &[(&'static str, [f32; 4])], [x, y]: [f32; 2]) -> Option<(&'static str, &'static str)> {
    let (name, r) = rects.iter().find(|(_, r)| x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3])?;
    let (fx, fy) = ((x - r[0]) / r[2], (y - r[1]) / r[3]);
    let side = if (1.0 / 3.0..2.0 / 3.0).contains(&fx) && (1.0 / 3.0..2.0 / 3.0).contains(&fy) {
        "center"
    } else {
        [("left", fx), ("right", 1.0 - fx), ("top", fy), ("bottom", 1.0 - fy)].into_iter().min_by(|a, b| a.1.total_cmp(&b.1)).unwrap().0
    };
    Some((name, side))
}

fn title_drag(name: &'static str, captured: Rects) -> impl Fn(&mut Desk, &mut Drag, &mut Tx) {
    move |s, d, tx| {
        let rects: Vec<(&'static str, [f32; 4])> = match s.read {
            Read::Captured => captured.to_vec(),
            Read::Reported => NAMES.iter().filter_map(|n| Some((*n, *s.reported.get(*n)?))).collect(),
        };
        let at = d.window_point();
        let over = drop_side(&rects, at).filter(|(to, _)| *to != name);
        match d.phase {
            Phase::Down => s.hint = None,
            Phase::Move => {
                s.hint = over.map(|(to, side)| (to.to_owned(), side));
                // The third way: ask Rune what is under the pointer. The answer comes after this handler.
                tx.element_at(at[0], at[1], |s: &mut Desk, picked, _| s.picked.push(picked.and_then(|p| p.key().map(str::to_owned))));
            }
            Phase::Up => {
                s.hint = None;
                if !d.cancelled() && let Some((to, side)) = over { s.lines.push(format!("tile.move {name} to={to} side={side}")); }
            }
        }
    }
}

fn divider(i: usize, row_width: Option<f32>) -> El {
    el().key(format!("divider/{i}")).w(DIVIDER).h_full().cursor(rune::Cursor::ResizeColumn).on_drag(move |s: &mut Desk, d: &mut Drag, _: &mut Tx| {
        // The space the tiles share: the container's width less its dividers.
        let Some(space) = row_width.map(|w| w - DIVIDER * (NAMES.len() - 1) as f32) else { return };
        match d.phase {
            Phase::Down => s.held = Some(s.weights.clone()),
            Phase::Move => {
                let from = s.held.clone().unwrap();
                let total: f32 = from.iter().sum();
                let pair = from[i] + from[i + 1];
                // The drag is measured from the press, so every move is the whole change and none accumulates.
                let a = (from[i] + d.dx / space * total).clamp(0.1 * total, pair - 0.1 * total);
                s.weights[i] = a;
                s.weights[i + 1] = pair - a;
            }
            Phase::Up => {
                let from = s.held.take().unwrap();
                if d.cancelled() { s.weights = from }
            }
        }
    })
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    s.views.set(s.views.get() + 1);
    let rects: Rects = Rc::new(NAMES.iter().filter_map(|n| Some((*n, cx.layout(&format!("tile/{n}"))?))).collect());
    let row_width = cx.layout_size("split").map(|[w, _]| w);
    let mut kids = Vec::new();
    for (i, name) in NAMES.into_iter().enumerate() {
        if i > 0 { kids.push(divider(i - 1, row_width)); }
        let hinted = s.hint.as_ref().filter(|(to, _)| to == name).map(|(_, side)| *side);
        let title = row().key(format!("tile/{name}/title")).h(24.0).w_full().on_drag(title_drag(name, rects.clone())).child(text(name));
        let mut tile = col().key(format!("tile/{name}")).grow(s.weights[i]).min_w(0.0).h_full().child(title).child(text(hinted.unwrap_or("")).key(format!("tile/{name}/hint")));
        if s.read == Read::Reported {
            tile = tile.on_layout(move |s: &mut Desk, r| { s.reported.insert(name.to_owned(), r); });
        }
        kids.push(tile);
    }
    row().key("split").size(906.0, 300.0).children(kids)
}

fn window(read: Read) -> Runtime<Desk> {
    let mut rt = Runtime::new(desk(read), view, (906.0, 300.0), env());
    turn(&mut rt);
    turn(&mut rt);
    rt
}

fn widths(rt: &Runtime<Desk>) -> Vec<f32> { NAMES.iter().map(|n| rect(rt, &format!("tile/{n}"))[2].round()).collect() }

#[test]
fn a_divider_dragged_with_on_drag_resizes_the_two_tiles_beside_it() {
    let mut rt = window(Read::Captured);
    assert_eq!(widths(&rt), [298.0, 298.0, 298.0]);
    let from = center(&rt, "divider/0");
    drag(&mut rt, from, (from.0 + 60.0, from.1), 6);
    assert_eq!(widths(&rt), [358.0, 238.0, 298.0], "60 points to the right: the left tile grew by them, the next gave them, the third never moved");
    assert!(rt.state.held.is_none());
    // The pointer may leave the divider and the window's row: the press keeps the drag.
    let from = center(&rt, "divider/1");
    drag(&mut rt, from, (from.0 - 100.0, from.1 + 500.0), 4);
    assert_eq!(widths(&rt), [358.0, 138.0, 398.0]);
}

#[test]
fn a_divider_stops_at_the_smallest_share_a_tile_keeps() {
    let mut rt = window(Read::Captured);
    let from = center(&rt, "divider/0");
    drag(&mut rt, from, (from.0 + 2000.0, from.1), 3);
    let w = widths(&rt);
    assert!(w[1] >= 89.0 && w[1] <= 90.0, "{w:?}");
    assert_eq!(w[2], 298.0);
}

#[test]
fn escape_during_a_divider_drag_cancels_it_and_the_handler_puts_the_weights_back() {
    let mut rt = window(Read::Captured);
    let from = center(&rt, "divider/0");
    rt.pointer_down(from.0, from.1);
    turn(&mut rt);
    rt.pointer_move(from.0 + 80.0, from.1);
    turn(&mut rt);
    assert_eq!(widths(&rt)[0], 378.0);
    key(&mut rt, Key::Escape);
    assert_eq!(rt.state.weights, [1.0, 1.0, 1.0], "Phase::Up arrived with Drag::cancelled");
    assert_eq!(widths(&rt)[0], 378.0, "the commit that puts them back is not a Move, so it springs: the tiles are still on their way");
    rest(&mut rt);
    assert_eq!(widths(&rt), [298.0, 298.0, 298.0]);
    rt.pointer_up(from.0 + 80.0, from.1);
    rest(&mut rt);
    assert_eq!(widths(&rt), [298.0, 298.0, 298.0], "the release that follows a cancel is nobody's");
}

fn drop_on(rt: &mut Runtime<Desk>, tile: &str, to: &str, frac: (f32, f32)) {
    let from = center(rt, &format!("tile/{tile}/title"));
    let r = rect(rt, &format!("tile/{to}"));
    drag(rt, from, (r[0] + r[2] * frac.0, r[1] + r[3] * frac.1), 5);
}

#[test]
fn a_title_drag_reads_the_other_tiles_rects_through_cx_layout_and_drops_as_an_act_line() {
    let mut rt = window(Read::Captured);
    drop_on(&mut rt, "beds", "seeds", (0.9, 0.5));
    drop_on(&mut rt, "beds", "reader", (0.5, 0.5));
    drop_on(&mut rt, "seeds", "beds", (0.5, 0.95));
    drop_on(&mut rt, "seeds", "reader", (0.05, 0.5));
    drop_on(&mut rt, "reader", "beds", (0.5, 0.05));
    assert_eq!(rt.state.lines, [
        "tile.move beds to=seeds side=right",
        "tile.move beds to=reader side=center",
        "tile.move seeds to=beds side=bottom",
        "tile.move seeds to=reader side=left",
        "tile.move reader to=beds side=top",
    ]);
}

#[test]
fn the_drop_hint_follows_the_pointer_while_the_title_is_held() {
    let mut rt = window(Read::Captured);
    let from = center(&rt, "tile/beds/title");
    let r = rect(&rt, "tile/reader");
    rt.pointer_down(from.0, from.1);
    turn(&mut rt);
    rt.pointer_move(r[0] + r[2] * 0.95, r[1] + r[3] * 0.5);
    turn(&mut rt);
    assert_eq!(rt.state.hint, Some(("reader".into(), "right")));
    assert_eq!(element(&rt, "tile/reader/hint").unwrap().text.as_deref(), Some("right"), "and the view drew it");
    rt.pointer_move(r[0] + r[2] * 0.5, r[1] + r[3] * 0.5);
    turn(&mut rt);
    assert_eq!(rt.state.hint, Some(("reader".into(), "center")));
    key(&mut rt, Key::Escape);
    turn(&mut rt);
    assert!(rt.state.hint.is_none() && rt.state.lines.is_empty(), "a cancelled drag drops nothing");
}

#[test]
fn a_drop_on_the_tile_s_own_rect_or_outside_every_tile_is_nothing() {
    let mut rt = window(Read::Captured);
    drop_on(&mut rt, "beds", "beds", (0.5, 0.9));
    let from = center(&rt, "tile/beds/title");
    drag(&mut rt, from, (from.0, 900.0), 3);
    assert!(rt.state.lines.is_empty());
}

#[test]
fn the_rects_a_handler_captured_are_the_ones_after_a_divider_moved() {
    let mut rt = window(Read::Captured);
    let from = center(&rt, "divider/0");
    drag(&mut rt, from, (from.0 + 200.0, from.1), 4);
    // x = 400 was the reader's before the divider moved; now it is the beds tile's right edge.
    let title = center(&rt, "tile/seeds/title");
    drag(&mut rt, title, (480.0, 150.0), 4);
    assert_eq!(rt.state.lines, ["tile.move seeds to=beds side=right"], "the view re-ran when the rects it read moved, and the handler it rebuilt holds the new ones");
}

#[test]
fn on_layout_reports_the_same_rects_into_state_at_the_cost_of_a_view_run_each() {
    let mut rt = window(Read::Reported);
    assert_eq!(rt.state.reported.len(), 3);
    for n in NAMES { assert_eq!(rt.state.reported[n], rect(&rt, &format!("tile/{n}"))); }
    drop_on(&mut rt, "beds", "seeds", (0.9, 0.5));
    assert_eq!(rt.state.lines, ["tile.move beds to=seeds side=right"]);
    // What a divider drag costs each way: view runs for the same six pointer moves.
    let runs = |read| {
        let mut rt = window(read);
        let before = rt.state.views.get();
        let from = center(&rt, "divider/0");
        drag(&mut rt, from, (from.0 + 60.0, from.1), 6);
        rt.state.views.get() - before
    };
    let (captured, reported) = (runs(Read::Captured), runs(Read::Reported));
    println!("divider drag, 6 moves: {captured} view runs with Cx::layout captured, {reported} with on_layout into state");
    assert!(captured >= 6 && reported >= captured, "{captured} {reported}");
}

#[test]
fn tx_element_at_names_the_element_under_the_pointer_one_step_late_and_without_its_rect() {
    let mut rt = window(Read::Captured);
    let from = center(&rt, "tile/beds/title");
    let r = rect(&rt, "tile/seeds");
    rt.pointer_down(from.0, from.1);
    turn(&mut rt);
    rt.pointer_move(r[0] + r[2] * 0.9, r[1] + r[3] * 0.5);
    turn(&mut rt);
    turn(&mut rt);
    assert_eq!(rt.state.picked, [Some("tile/seeds".to_owned())], "the pick answers after the handler: enough to name a tile, not to choose a side");
    rt.pointer_up(r[0] + r[2] * 0.9, r[1] + r[3] * 0.5);
    turn(&mut rt);
}
