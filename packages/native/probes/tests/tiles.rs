//! Probe 5: can N dynamic tiles be drawn from a `HashMap<TileId, TileUi>`, with element keys namespaced
//! `tile/<name>/…`, without the kit's `fn(&mut S) -> &mut T` accessors?
//!
//! `src/accessors.rs` is the compiler's half (which kit builders take a tile id at all). This is the running half:
//! tiles opened and closed while the window runs, each with a kit field, a virtual list with its own cursor, a kit
//! button, and a kit `TabStrip` per tabs container.

use std::collections::{HashMap, HashSet};

use ep0ch_native_probes::*;
use rune::{Cx, El, GrowthSpec, Runtime, ScrollSpec, TextEdit, Tx, col, row, text};
use rune_kit::shell::{TabDragState, TabItem, TabOrientation, TabReorder, TabStrip};
use rune_kit::{Button, Kit, TextInput};

/// What the shell keeps per tile, whatever its kind: found by id, never by a field name.
#[derive(Default)]
struct TileUi {
    cursor: Option<String>,
    field: TextEdit,
    rows: Vec<String>,
}

struct Tabs {
    id: String,
    kids: Vec<String>,
    active: String,
}

struct Desk {
    /// The row container's tiles, in order.
    order: Vec<String>,
    tiles: HashMap<String, TileUi>,
    tabs: Vec<Tabs>,
    /// One gesture for every strip: a window has one pointer.
    tab_drag: TabDragState,
    log: Vec<String>,
}

fn tile_ui(name: &str, rows: usize) -> TileUi {
    TileUi { rows: (0..rows).map(|i| format!("{name}-{i}")).collect(), ..TileUi::default() }
}

fn desk() -> Desk {
    let names = ["beds", "reader", "seeds"];
    Desk {
        order: names.iter().map(|n| n.to_string()).collect(),
        tiles: names.iter().map(|n| (n.to_string(), tile_ui(n, 200))).collect(),
        tabs: vec![
            Tabs { id: "left".into(), kids: vec!["links".into(), "props".into(), "log".into()], active: "links".into() },
            Tabs { id: "right".into(), kids: vec!["threads".into(), "history".into(), "sessions".into()], active: "threads".into() },
        ],
        tab_drag: TabDragState::default(),
        log: vec![],
    }
}

fn tile(s: &Desk, k: &Kit, id: &str) -> El {
    let ui = &s.tiles[id];
    let (a, b, c, d) = (id.to_owned(), id.to_owned(), id.to_owned(), id.to_owned());
    let field = TextInput::new(&ui.field).width(Some(180.0)).on_edit(move |s: &mut Desk| &mut s.tiles.get_mut(&a).unwrap().field).build(k).key(format!("tile/{id}/field"));
    let add = Button::new("Add a row").on_press(move |s: &mut Desk| {
        let ui = s.tiles.get_mut(&b).unwrap();
        ui.rows.push(format!("{b}-{}", ui.rows.len()));
    }).build(k).key(format!("tile/{id}/add"));
    // The list is the app's own: rows built by index, keyed by row id under the tile, the cursor in the tile's TileUi.
    let rows = col().key(format!("tile/{id}/rows")).growth(GrowthSpec::default()).virtual_rows(
        ui.rows.len(),
        20.0,
        move |s: &Desk, i| format!("tile/{c}/row/{}", s.tiles[&c].rows[i]).into(),
        move |s: &Desk, i| {
            let ui = &s.tiles[&d];
            let (tile, row_id) = (d.clone(), ui.rows[i].clone());
            let mark = if ui.cursor.as_deref() == Some(row_id.as_str()) { "> " } else { "  " };
            row().h(20.0).child(text(format!("{mark}{row_id}"))).on_press(move |s: &mut Desk| {
                s.tiles.get_mut(&tile).unwrap().cursor = Some(row_id.clone());
                s.log.push(format!("select {tile} {row_id}"));
            })
        },
    );
    col()
        .key(format!("tile/{id}"))
        .size(200.0, 260.0)
        .child(text(id.to_owned()).key(format!("tile/{id}/title")))
        .child(field)
        .child(add)
        .child(col().key(format!("tile/{id}/scroll")).scroll(ScrollSpec { stick_bottom: false }).grow(1.0).min_h(0.0).child(rows))
}

fn strip(s: &Desk, k: &Kit, tabs: &Tabs) -> El {
    let (a, b, c) = (tabs.id.clone(), tabs.id.clone(), tabs.id.clone());
    TabStrip::new(format!("tabs/{}", tabs.id), TabOrientation::Horizontal)
        .tabs(tabs.kids.iter().map(|kid| TabItem::new(kid.as_str(), kid.as_str())))
        .active(Some(tabs.active.as_str()))
        .viewport_width(Some(400.0))
        .drag_state(&s.tab_drag, |s: &mut Desk| &mut s.tab_drag)
        .on_select(move |s: &mut Desk, tab: &str, _: &mut Tx| {
            s.tabs.iter_mut().find(|t| t.id == a).unwrap().active = tab.to_owned();
            s.log.push(format!("tab {a} {tab}"));
        })
        .on_close(move |s: &mut Desk, tab: &str, _: &mut Tx| {
            s.tabs.iter_mut().find(|t| t.id == b).unwrap().kids.retain(|k| k != tab);
            s.log.push(format!("close {b} {tab}"));
        })
        .on_reorder(move |s: &mut Desk, r: TabReorder, _: &mut Tx| {
            let kids = &mut s.tabs.iter_mut().find(|t| t.id == c).unwrap().kids;
            let kid = kids.remove(r.from);
            kids.insert(r.to, kid);
            s.log.push(format!("reorder {c} {} {}>{}", r.id, r.from, r.to));
        })
        .build(k)
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = Kit::neutral(cx.system_dark());
    col()
        .child(row().key("row").children(s.order.iter().map(|id| tile(s, &k, id))))
        .child(row().key("strips").children(s.tabs.iter().map(|t| col().w(400.0).child(strip(s, &k, t)))))
}

fn window() -> Runtime<Desk> {
    let mut rt = Runtime::new(desk(), view, (1000.0, 400.0), env());
    turn(&mut rt);
    rest(&mut rt);
    rt
}

#[test]
fn three_tiles_from_one_map_draw_with_keys_that_name_their_tile() {
    let rt = window();
    let keys: Vec<String> = rt.elements().into_iter().filter_map(|e| e.key).filter(|k| k.starts_with("tile/")).collect();
    let unique: HashSet<&String> = keys.iter().collect();
    assert_eq!(keys.len(), unique.len(), "no two elements share a namespaced key");
    for id in ["beds", "reader", "seeds"] {
        for part in ["", "/title", "/field", "/add", "/rows", &format!("/row/{id}-0")] {
            assert!(rt.find(&format!("tile/{id}{part}")).is_some(), "tile/{id}{part}");
        }
    }
    assert_ne!(rt.find("tile/beds/row/beds-3"), rt.find("tile/seeds/row/seeds-3"));
    assert!(rt.find("tile/beds/row/beds-150").is_none(), "rows outside the list's window aren't built");
    // The kit's own part names repeat in every tile; a lookup by one of them alone finds only the first.
    let inputs = rt.elements().into_iter().filter(|e| e.key.as_deref() == Some("input")).count();
    assert_eq!(inputs, 3);
}

#[test]
fn a_press_or_a_key_in_one_tile_changes_only_that_tile_s_ui() {
    let mut rt = window();
    click(&mut rt, "tile/reader/row/reader-2");
    click(&mut rt, "tile/seeds/field");
    typed(&mut rt, "kale");
    click(&mut rt, "tile/beds/add");
    let (beds, reader, seeds) = (&rt.state.tiles["beds"], &rt.state.tiles["reader"], &rt.state.tiles["seeds"]);
    assert_eq!((beds.cursor.as_deref(), reader.cursor.as_deref(), seeds.cursor.as_deref()), (None, Some("reader-2"), None));
    assert_eq!((beds.field.text.as_str(), reader.field.text.as_str(), seeds.field.text.as_str()), ("", "", "kale"));
    assert_eq!((beds.rows.len(), reader.rows.len(), seeds.rows.len()), (201, 200, 200));
    assert_eq!(rt.state.log, ["select reader reader-2"]);
}

#[test]
fn a_tile_opened_while_the_window_runs_draws_and_one_closed_takes_nothing_with_it() {
    let mut rt = window();
    click(&mut rt, "tile/seeds/field");
    typed(&mut rt, "ka");
    click(&mut rt, "tile/reader/row/reader-4");
    rt.update(|s, _| {
        s.tiles.insert("orchard".into(), tile_ui("orchard", 5));
        s.order.insert(1, "orchard".into());
    });
    turn(&mut rt);
    rest(&mut rt);
    assert!(rt.find("tile/orchard/row/orchard-4").is_some());
    click(&mut rt, "tile/orchard/row/orchard-1");
    assert_eq!(rt.state.tiles["orchard"].cursor.as_deref(), Some("orchard-1"));
    // Close the first tile: the others keep their ids, their state and, for the field, the keys.
    click(&mut rt, "tile/seeds/field");
    rt.update(|s, _| {
        s.order.retain(|id| id != "beds");
        s.tiles.remove("beds");
    });
    turn(&mut rt);
    rest(&mut rt);
    assert!(rt.find("tile/beds").is_none());
    typed(&mut rt, "le");
    assert_eq!(rt.state.tiles["seeds"].field.text, "kale", "the field kept focus while the tiles around it changed");
    assert_eq!(rt.state.tiles["reader"].cursor.as_deref(), Some("reader-4"));
}

#[test]
fn each_tabs_container_gets_a_kit_tab_strip_whose_handlers_name_the_container() {
    let mut rt = window();
    // The kit keys a tab `t-<id>`: tab ids must be unique in the window, which tile names are.
    click(&mut rt, "t-history");
    click(&mut rt, "t-props");
    assert_eq!(rt.state.log, ["tab right history", "tab left props"]);
    assert_eq!((rt.state.tabs[0].active.as_str(), rt.state.tabs[1].active.as_str()), ("props", "history"));
}

#[test]
fn two_strips_share_one_drag_state_and_a_drag_reorders_only_its_own() {
    let mut rt = window();
    let from = center(&rt, "t-threads");
    let to = center(&rt, "t-sessions");
    rt.pointer_move(from.0, from.1);
    rt.pointer_down(from.0, from.1);
    for i in 1..=10 {
        rt.pointer_move(from.0 + (to.0 + 20.0 - from.0) * i as f32 / 10.0, from.1);
        rt.frame(1.0 / 60.0);
    }
    rt.pointer_up(to.0 + 20.0, from.1);
    rest(&mut rt);
    assert_eq!(rt.state.tabs[1].kids, ["history", "sessions", "threads"], "{:?}", rt.state.log);
    assert_eq!(rt.state.tabs[0].kids, ["links", "props", "log"], "the other strip read the same TabDragState and stayed as it was");
    assert!(rt.state.log.iter().any(|l| l.starts_with("reorder right threads")), "{:?}", rt.state.log);
}
