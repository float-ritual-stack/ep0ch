//! Wave H2, arranging by mouse: a tile held by its title shows where it will land, and lands there. The places are
//! the layout's drop rule (`layout/drop.rs`, held to the door's `drop.ts` cell for cell by `contract.rs`): these
//! tests press a drawn window and read what it draws and does. Every drop is the act the door's drop is
//! (`layout.move`, `layout.swap`), recorded as itself.
use rune::{Key, KeyEvent, Mods, Runtime};
use serde_json::{Value, json};

use super::owners::leaf;
use super::support::*;
use crate::actions::{Actor, App, CELL, Step, Tone};
use crate::keys;

/// A window laid out as the screen `beds`: the beds on the left, the bed over the seed list on the right.
fn plot() -> Runtime<App> { laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("tree", "beds"), { "t": "split", "dir": "col", "weights": [0.5, 0.5], "kids": [leaf("reader", "bed"), leaf("reader", "seeds")] }] } })) }

fn laid(layout: Value) -> Runtime<App> {
    let mut g = garden(ok());
    screens_are(&mut g, json!([screen_row("beds", layout, json!([]))]));
    let opened = act(&mut g.app, "screen.open name=beds");
    assert!(opened.ok, "{}", opened.said);
    window(g.app)
}

/// The arrangement but for where the keys are: a press on a title gives its tile the keys and moves nothing.
fn shape(rt: &Runtime<App>) -> Value { let mut saved = rt.state.layout.save(); saved.as_object_mut().unwrap().remove("focus"); saved }
fn lines(rt: &Runtime<App>, from: usize) -> Vec<String> { rt.state.steps[from..].iter().map(Step::line).collect() }
fn shown(rt: &Runtime<App>) -> Vec<String> { rt.state.shown_tiles().iter().map(|id| rt.state.layout.name(id)).collect() }
fn element(rt: &Runtime<App>, key: &str) -> Option<rune::ElementInfo> { rt.elements().into_iter().find(|e| e.key.as_deref() == Some(key)) }
/// The words drawn in an element, its own and its children's.
fn words_in(rt: &Runtime<App>, key: &str) -> String {
    let all = rt.elements();
    let Some(at) = all.iter().position(|e| e.key.as_deref() == Some(key)) else { return String::new() };
    let inside = |mut i: usize| loop { if i == at { return true } match all[i].parent { Some(parent) => i = parent, None => return false } };
    all.iter().enumerate().filter(|(i, _)| inside(*i)).filter_map(|(_, e)| e.text.clone()).collect::<Vec<_>>().join(" ")
}
/// A point of a tile, by parts of its box.
fn point_in(rt: &Runtime<App>, tile: &str, fx: f32, fy: f32) -> (f32, f32) { let r = rect_of(rt, &format!("tile/{tile}")).unwrap_or_else(|| panic!("{tile} is drawn")); (r[0] + r[2] * fx, r[1] + r[3] * fy) }
/// The bare part of a tile's title: where it is held.
fn title_of(rt: &Runtime<App>, tile: &str) -> (f32, f32) { let bar = rect_of(rt, &format!("tile/{tile}/bar")).unwrap(); (bar[0] + bar[2] * 0.55, bar[1] + 9.0) }
/// A tile's title pressed and carried to a point, and held there.
fn hold(rt: &mut Runtime<App>, tile: &str, to: (f32, f32)) { let from = title_of(rt, tile); hold_at(rt, from, to) }
fn hold_at(rt: &mut Runtime<App>, from: (f32, f32), to: (f32, f32)) {
    rt.pointer_down(from.0, from.1);
    rt.pointer_move(from.0 + 6.0, from.1 + 6.0);
    rt.frame(1.0 / 60.0);
    rt.pointer_move(to.0, to.1);
    for _ in 0..4 { rt.frame(1.0 / 60.0); }
}
fn let_go(rt: &mut Runtime<App>, at: (f32, f32)) { rt.pointer_up(at.0, at.1); rest(rt) }

/// The sentence: a tile held by its title shows where it will land, and lands there.
#[test]
fn a_tile_held_by_its_title_shows_where_it_will_land_and_lands_there() {
    let mut rt = plot();
    assert!(element(&rt, "drop/bed/swap").is_none() && rt.state.moving.is_none(), "nothing is drawn of a drop until a title is held");
    let (before, from) = (shape(&rt), rt.state.steps.len());
    // The beds' title, pressed and carried over the left of the bed.
    let over = point_in(&rt, "bed", 0.1, 0.5);
    hold(&mut rt, "beds", over);
    let held = rt.state.moving.clone().expect("the beds are held");
    assert_eq!((rt.state.layout.name(&held.tile), shape(&rt) == before), ("beds".to_string(), true), "held, and nothing has moved yet");
    // Every tile that can take it shows its places, in the layout's own words; the held tile shows none.
    for (key, said) in [("drop/bed/split/up", "^ drop here to split above"), ("drop/bed/split/left", "< split left"), ("drop/bed/tabs", "drop here: a tab"), ("drop/bed/swap", "drop here: swap"), ("drop/bed/split/right", "split >"), ("drop/bed/split/down", "v drop here to split below"), ("drop/seeds/tabs", "drop here: a tab"), ("drop/seeds/swap", "drop here: swap")] {
        assert_eq!(words_in(&rt, key), said, "{key} is drawn with its words");
    }
    assert!(rt.elements().iter().all(|e| !e.key.as_deref().is_some_and(|key| key.starts_with("drop/beds/"))), "the held tile offers itself nothing");
    // A zone is drawn where the drop rule says it is, so the box seen is where the drop lands.
    let (origin, zone) = (rect_of(&rt, "tiles").unwrap(), held.zones.iter().find(|(id, _)| rt.state.layout.name(id) == "bed").unwrap().1.iter().find(|zone| zone.label == "< split left").unwrap().ghost);
    assert_eq!(rect_of(&rt, "drop/bed/split/left"), Some([origin[0] + zone.col as f32 * CELL.0, origin[1] + zone.row as f32 * CELL.1, zone.cols as f32 * CELL.0, zone.rows as f32 * CELL.1]));
    // The one under the pointer is lit, and the others are dim; the held tile is dimmed where it stands.
    let lit: Vec<String> = rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("drop/") && key != "drop/held" && key != "drop/foot") && e.opacity > 0.99).filter_map(|e| e.key).collect();
    assert_eq!(lit, ["drop/bed/split/left"], "one place is lit: the one the pointer is over");
    assert!(element(&rt, "tile/beds").unwrap().opacity < 0.5 && element(&rt, "tile/bed").unwrap().opacity > 0.99);
    // Its name is at the pointer, and the foot of the tiles says what is held, where it would land and the key that lets go.
    assert!(words_in(&rt, "drop/held").contains("beds"));
    let esc = keys::hints(rt.state.person().layer).into_iter().next().expect("the layer a held tile is has its key");
    let said = element(&rt, "holding").and_then(|e| e.text).expect("the foot says what is held");
    assert!(said.starts_with("beds") && said.contains("< split left") && said.contains(&esc.0) && said.contains(esc.1), "{said}");
    assert_eq!(rt.state.person().layer.name(), "moving");
    // Carried on to the lower middle of the seed list: that place is lit instead.
    let swap = point_in(&rt, "seeds", 0.5, 0.62);
    rt.pointer_move(swap.0, swap.1);
    for _ in 0..4 { rt.frame(1.0 / 60.0); }
    assert!(element(&rt, "drop/seeds/swap").unwrap().opacity > 0.99 && element(&rt, "drop/bed/split/left").unwrap().opacity < 0.99);
    // Let go: it lands there, by the act the place is, recorded as itself; and nothing of the hold is left drawn.
    let seeds = rect_of(&rt, "tile/seeds").unwrap();
    let_go(&mut rt, swap);
    assert!(lines(&rt, from).contains(&"layout.swap to=seeds tile=beds".to_string()), "{:?}", lines(&rt, from));
    assert_eq!(rect_of(&rt, "tile/beds"), Some(seeds), "the beds are where the seed list was");
    assert!(rt.state.moving.is_none() && rt.elements().iter().all(|e| !e.key.as_deref().is_some_and(|key| key.starts_with("drop/"))) && element(&rt, "holding").is_none());
    assert!(element(&rt, "tile/beds").unwrap().opacity > 0.99);
    // And it is one step back.
    rt.update(|s, _| { s.act("layout.undo", Actor::Person); });
    rest(&mut rt);
    assert_eq!(shape(&rt), before);
}

/// A press that goes nowhere is a press: nothing is held, and nothing is drawn of a drop.
#[test]
fn a_title_pressed_and_not_carried_holds_nothing() {
    let mut rt = plot();
    let at = title_of(&rt, "seeds");
    rt.pointer_down(at.0, at.1);
    rt.pointer_move(at.0 + 2.0, at.1 + 1.0);
    rt.frame(1.0 / 60.0);
    assert!(rt.state.moving.is_none(), "two points is no hold");
    let_go(&mut rt, (at.0 + 2.0, at.1 + 1.0));
    assert!(!rt.state.steps.iter().any(|step| step.action.starts_with("layout.")), "{:?}", lines(&rt, 0));
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "seeds", "the press gave the tile the keys");
}

/// Escape, or letting go over no place, changes nothing and says so.
#[test]
fn escape_or_letting_go_over_no_place_changes_nothing_and_says_so() {
    let mut rt = plot();
    let before = shape(&rt);
    let over = point_in(&rt, "bed", 0.5, 0.4);
    hold(&mut rt, "beds", over);
    assert!(rt.state.moving.as_ref().is_some_and(|held| held.drop.is_some()));
    // Escape while it is held: the drag ends, and the act that lets go with nothing moved is the one recorded.
    rt.key(KeyEvent { key: Key::Escape, mods: Mods::default() });
    rest(&mut rt);
    assert_eq!((rt.state.moving.is_none(), shape(&rt) == before, rt.state.steps.last().map(Step::line)), (true, true, Some("layout.drop cancel=true".to_string())));
    assert_eq!(rt.state.notice.as_ref().map(|notice| (notice.tone, notice.said.as_str())), Some((Tone::Info, "beds stays where it was: let go with nothing moved.")));
    rt.pointer_up(over.0, over.1);
    rest(&mut rt);
    assert_eq!(shape(&rt), before, "the pointer coming up after Escape drops nothing");
    // Let go over the toolbar, which is no place.
    let toolbar = rt.find("toolbar").unwrap();
    hold(&mut rt, "beds", toolbar);
    assert!(rt.state.moving.as_ref().is_some_and(|held| held.drop.is_none()), "held over no place");
    let_go(&mut rt, toolbar);
    assert_eq!((rt.state.moving.is_none(), shape(&rt) == before), (true, true));
    assert_eq!(rt.state.notice.as_ref().map(|notice| notice.said.as_str()), Some("beds stays where it was: it was let go over no place."));
    // Onto itself is no place either.
    let own = point_in(&rt, "beds", 0.5, 0.5);
    hold(&mut rt, "beds", own);
    assert!(rt.state.moving.as_ref().is_some_and(|held| held.drop.is_none()));
    let_go(&mut rt, own);
    assert_eq!(shape(&rt), before);
}

/// The places are the door's: a title's row for a place among a set's tabs, a tab taken out of its own set by its
/// label, the window's outer strips, and a shut dock's strip.
#[test]
fn a_tab_is_placed_among_tabs_taken_out_of_its_set_and_a_tile_goes_to_an_edge_or_into_a_shut_dock() {
    let mut rt = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.25, 0.5, 0.25], "kids": [leaf("tree", "beds"), { "t": "tabs", "active": 0, "tabs": [leaf("reader", "bed"), leaf("reader", "seeds"), leaf("backlinks", "roots")] }, { "t": "dock", "edge": "right", "open": false, "kid": leaf("props", "tools") }] } }));
    let tabs = |rt: &Runtime<App>, set: &str| -> Vec<String> { let id = rt.state.layout.named(set).unwrap(); rt.state.tab_cells(&id, crate::layout::Rect::default()).iter().map(|tab| rt.state.layout.name(&tab.id)).collect() };
    assert_eq!(tabs(&rt, "bed"), ["bed", "seeds", "roots"]);
    // The beds, let go on the tab set's title over the second label: a tab before it.
    let label = rect_of(&rt, "tile/bed/tab/seeds").unwrap();
    let from = rt.state.steps.len();
    hold(&mut rt, "beds", (label[0] + label[2] / 2.0, label[1] + 4.0));
    assert_eq!(words_in(&rt, "drop/here"), "\u{25ad} tabs", "the title's row says it takes a tab");
    let_go(&mut rt, (label[0] + label[2] / 2.0, label[1] + 4.0));
    assert!(lines(&rt, from).contains(&"layout.move index=1 to=bed where=tabs tile=beds".to_string()), "{:?}", lines(&rt, from));
    let set = rt.state.layout.name(&rt.state.layout.focus);
    assert_eq!(tabs(&rt, "bed"), ["bed", "beds", "seeds", "roots"], "{set}");
    // A tab behind, held by its own label and let go on its own set's right side: a tile of its own beside the set.
    let front = shown(&rt).into_iter().find(|name| tabs(&rt, "bed").contains(name)).unwrap();
    let (label, from) = (rt.find(&format!("tile/{front}/tab/roots")).unwrap(), rt.state.steps.len());
    let side = point_in(&rt, &front, 0.95, 0.5);
    hold_at(&mut rt, label, side);
    assert_eq!(words_in(&rt, &format!("drop/{front}/split/right")), "split >", "its own set offers its sides, and no middle");
    assert!(element(&rt, &format!("drop/{front}/tabs")).is_none() && element(&rt, &format!("drop/{front}/swap")).is_none());
    let_go(&mut rt, side);
    assert!(lines(&rt, from).contains(&format!("layout.move to={front} where=right tile=roots")), "{:?}", lines(&rt, from));
    assert!(shown(&rt).contains(&"roots".to_string()) && tabs(&rt, "bed") == ["bed", "beds", "seeds"], "roots is a tile of its own: {:?}", shown(&rt));
    // Reordered within its own set, by its label over the first.
    let (label, first, from) = (rt.find(&format!("tile/{front}/tab/seeds")).unwrap(), rect_of(&rt, &format!("tile/{front}/tab/bed")).unwrap(), rt.state.steps.len());
    hold_at(&mut rt, label, (first[0] + first[2] / 2.0, first[1] + 4.0));
    assert_eq!(words_in(&rt, "drop/here"), "\u{2194} reorder tab");
    let_go(&mut rt, (first[0] + first[2] / 2.0, first[1] + 4.0));
    assert!(lines(&rt, from).iter().any(|line| line.starts_with("layout.move index=0 ") && line.ends_with("where=tabs tile=seeds")), "{:?}", lines(&rt, from));
    assert_eq!(tabs(&rt, "bed"), ["seeds", "bed", "beds"]);
    // The window's left strip: a column the whole height.
    let (area, from) = (rect_of(&rt, "tiles").unwrap(), rt.state.steps.len());
    let edge = (area[0] + 4.0, area[1] + area[3] / 2.0);
    hold(&mut rt, "roots", edge);
    assert_eq!(words_in(&rt, "drop/here"), "\u{21d0} full-height column");
    let_go(&mut rt, edge);
    assert!(lines(&rt, from).contains(&"layout.move where=edge-left tile=roots".to_string()), "{:?}", lines(&rt, from));
    let roots = rect_of(&rt, "tile/roots").unwrap();
    assert!((roots[0] - area[0]).abs() < 1.0 && roots[3] > area[3] - CELL.1 * 2.0, "roots is the leftmost column, the whole height: {roots:?}");
    // The shut dock's strip: it joins the tile the dock shows, as a tab, and the drag says it docks.
    let (strip, from) = (rt.find("dock/right").expect("the shut dock has its strip"), rt.state.steps.len());
    hold(&mut rt, "roots", strip);
    assert!(words_in(&rt, "drop/here").ends_with("docked here: stays on this screen"), "{}", words_in(&rt, "drop/here"));
    let_go(&mut rt, strip);
    assert!(lines(&rt, from).contains(&"layout.move to=tools where=tabs tile=roots".to_string()), "{:?}", lines(&rt, from));
    assert_eq!(tabs(&rt, "tools"), ["tools", "roots"]);
}

/// A place the layout refuses says why in its own band while it is held there, in this window's words, and letting
/// go there moves nothing. The way out it names is an action of this window's, by this window's key.
#[test]
fn a_place_the_layout_refuses_says_why_where_it_is_held_and_takes_nothing() {
    let mut rt = plot();
    rt.update(|s, _| { assert!(s.act("layout.lock on=true", Actor::Person).ok); });
    rest(&mut rt);
    let (before, over) = (shape(&rt), point_in(&rt, "bed", 0.5, 0.4));
    hold(&mut rt, "beds", over);
    let key = keys::cap("layout.lock").expect("the lock has a key here");
    let why = format!("the beds screen is locked: moving beds is refused \u{b7} {key} in it unlocks it");
    assert_eq!(rt.state.moving.as_ref().and_then(|held| held.drop.as_ref()).and_then(|zone| zone.refused.clone()), Some(why.clone()));
    assert_eq!(words_in(&rt, "drop/bed/tabs"), format!("\u{2715} {why}"), "the band under the pointer says why");
    assert_eq!(words_in(&rt, "drop/bed/swap"), "drop here: swap", "a band the pointer is not over keeps its words");
    let_go(&mut rt, over);
    assert_eq!(shape(&rt), before);
    assert_eq!(rt.state.notice.as_ref().map(|notice| (notice.tone, notice.said.clone())), Some((Tone::Problem, format!("beds is not moved: {why}"))));
    // Unlocked by the toolbar's lock, the same drop lands.
    press(&mut rt, "tool/lock");
    hold(&mut rt, "beds", over);
    let_go(&mut rt, over);
    assert!(rt.state.steps.iter().any(|step| step.line() == "layout.move to=bed where=tabs tile=beds" && step.ok), "{:?}", lines(&rt, 0));
}

/// An agent moves a tile by the same act and shows no drag; the hold itself is the person's.
#[test]
fn an_agent_s_move_is_the_same_act_attributed_and_shows_no_drag() {
    let mut rt = plot();
    let agent = || Actor::Agent("seedling-agent".into());
    let run = |rt: &mut Runtime<App>, line: &'static str, by: Actor| { let (send, got) = std::sync::mpsc::channel(); rt.update(move |s, _| { let _ = send.send(s.act(line, by)); }); rest(rt); got.recv().unwrap() };
    let moved = run(&mut rt, "layout.move tile=beds to=seeds where=down", agent());
    assert!(moved.ok, "{}", moved.said);
    let (beds, seeds) = (rect_of(&rt, "tile/beds").unwrap(), rect_of(&rt, "tile/seeds").unwrap());
    assert!(beds[1] >= seeds[1] + seeds[3] - 1.0 && rt.state.moving.is_none() && element(&rt, "drop/held").is_none(), "moved outright, with nothing held");
    assert_eq!(rt.state.steps.last().map(|step| (step.line(), step.by.clone())), Some(("layout.move to=seeds where=down tile=beds".to_string(), agent())));
    assert!(rt.state.agent_said.as_deref().is_some_and(|said| said.contains("seedling-agent") && said.contains("layout.move")), "{:?}", rt.state.agent_said);
    for line in ["layout.carry col=40 row=10 tile=beds", "layout.drop"] {
        let held = run(&mut rt, line, agent());
        assert!(!held.ok && held.said.contains("an agent moves a tile outright (layout.move"), "{line}: {}", held.said);
    }
    assert!(rt.state.moving.is_none());
    // The person's hold is left alone by an agent's act, and lands by the arrangement as it is when it is let go.
    let over = point_in(&rt, "bed", 0.5, 0.4);
    hold(&mut rt, "seeds", over);
    assert!(run(&mut rt, "tile.split tile=bed dir=right", agent()).ok);
    assert!(rt.state.moving.is_some(), "an agent's act lets go of nothing");
    let over = point_in(&rt, "bed", 0.5, 0.4);
    rt.pointer_move(over.0, over.1);
    rt.frame(1.0 / 60.0);
    let_go(&mut rt, over);
    assert!(rt.state.steps.iter().rev().take(3).any(|step| step.action == "layout.move" && step.by == Actor::Person && step.ok), "{:?} {:?}", lines(&rt, 0), rt.state.notice.as_ref().map(|n| n.said.clone()));
}

/// A press in a tile's body gives that tile the keys.
#[test]
fn a_press_in_a_tile_s_body_gives_it_the_keys() {
    let mut rt = plot();
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "bed");
    // In the empty middle of a reader told no note, on a list's row, and on a note's words.
    let at = point_in(&rt, "seeds", 0.5, 0.8);
    rt.pointer_down(at.0, at.1);
    rt.pointer_up(at.0, at.1);
    rest(&mut rt);
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "seeds", "a press on bare ground in a tile");
    press(&mut rt, "tile/beds/row/plot");
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), "beds", "a press on a list's row");
    // On a note's own words, which can be selected: the press is the tile's too.
    let reader = rt.state.layout.all().into_iter().find(|id| rt.state.note_of(id).as_deref() == Some("plot")).map(|id| rt.state.layout.name(&id)).expect("the row opened the plot in a reader");
    let tile = rect_of(&rt, &format!("tile/{reader}")).unwrap();
    let prose = rt.elements().into_iter().find(|e| e.rect[0] >= tile[0] && e.rect[0] < tile[0] + tile[2] && e.text.as_deref().is_some_and(|text| text.contains("Before the rain"))).unwrap_or_else(|| panic!("the note's words are drawn: {:?}", rt.elements().into_iter().filter_map(|e| e.text).collect::<Vec<_>>()));
    let at = (prose.rect[0] + 30.0, prose.rect[1] + prose.rect[3] / 2.0);
    rt.pointer_down(at.0, at.1);
    rt.pointer_up(at.0, at.1);
    rest(&mut rt);
    assert_eq!(rt.state.layout.name(&rt.state.layout.focus), reader, "a press on a note's words");
    assert!(rt.state.steps.iter().filter(|step| step.action == "tile.focus").count() >= 3);
}

/// Fold, zoom, float and lock are actions, each with its key and, where a tile's title or the toolbar has one, its
/// control: a tile folded is drawn as a spine and a press opens it; a float is moved by its title and lands on a
/// title it is let go on.
#[test]
fn a_tile_is_folded_zoomed_floated_and_the_arrangement_locked_by_a_press_a_key_and_an_act() {
    let mut rt = laid(json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.25, 0.4, 0.35], "kids": [leaf("tree", "beds"), leaf("reader", "bed"), leaf("reader", "seeds")] } }));
    let wide = rect_of(&rt, "tile/bed").unwrap()[2];
    // The fold on the title of the tile with the keys: a spine, three cells wide, with its name; the others take its room.
    press(&mut rt, "tile/bed/fold");
    assert_eq!(rt.state.steps.last().map(Step::line), Some("tile.collapse tile=bed".to_string()));
    let spine = element(&rt, "tile/bed").expect("the spine is drawn where the tile stood");
    assert!(spine.rect[2] <= 3.0 * CELL.0 + 0.5 && spine.rect[2] < wide && element(&rt, "tile/bed/bar").is_none(), "{:?}", spine.rect);
    assert_eq!(words_in(&rt, "tile/bed").replace(' ', ""), "bed", "its name is written down it");
    // A press on the spine opens it again.
    press(&mut rt, "tile/bed");
    assert!(rect_of(&rt, "tile/bed").unwrap()[2] > 20.0 * CELL.0 && element(&rt, "tile/bed/bar").is_some(), "open again, with its title (the open tiles share the row evenly, as the layout's rule says)");
    assert!(rt.state.steps.iter().any(|step| step.line() == "tile.collapse on=false tile=bed" && step.ok));
    // Zoom, by its key: the tile fills the tiles' area, and the key again puts it back.
    let area = rect_of(&rt, "tiles").unwrap();
    let zoom = keys::table().iter().find(|bind| bind.action == "tile.zoom").expect("zoom has a key");
    assert_eq!(zoom.spec, "mod+shift+enter");
    chord(&mut rt, Key::Enter, Mods { shift: true, ..primary() });
    assert_eq!((shown_drawn(&rt), rect_of(&rt, "tile/bed").map(|r| r[2] > area[2] - CELL.0 * 2.0)), (vec!["bed".to_string()], Some(true)), "zoomed, it is the one tile drawn");
    chord(&mut rt, Key::Enter, Mods { shift: true, ..primary() });
    assert_eq!(shown_drawn(&rt), ["beds", "bed", "seeds"]);
    // Float, by the control on its title: over the others, and its title's control puts it back.
    press(&mut rt, "tile/bed/float");
    assert!(rt.state.layout.is_float(&rt.state.layout.named("bed").unwrap()));
    // A float's title carries it: it follows the hand, and let go over a tile's body it is put there.
    let (at, from) = (rect_of(&rt, "tile/bed").unwrap(), rt.state.steps.len());
    let to = (at[0] + at[2] * 0.55 + 96.0, at[1] + 9.0 + 54.0);
    hold(&mut rt, "bed", to);
    assert!(rt.state.moving.as_ref().is_some_and(|held| held.lifted.is_some() && held.zones.is_empty()), "a float is offered no band of a tile");
    let lifted = rect_of(&rt, "tile/bed").unwrap();
    assert!((lifted[0] - at[0] - 96.0).abs() <= CELL.0 * 1.5 && (lifted[1] - at[1] - 54.0).abs() <= CELL.1 * 1.5, "it is drawn where the hand has it: {at:?} then {lifted:?}");
    let_go(&mut rt, to);
    assert!(lines(&rt, from).iter().any(|line| line.starts_with("float.place col=") && line.ends_with("tile=bed")), "{:?}", lines(&rt, from));
    assert_eq!(rect_of(&rt, "tile/bed").map(|r| [r[0], r[1]]), Some([lifted[0], lifted[1]]), "and stays where it was let go");
    // Let go on another tile's title, it lands there as a tab.
    let (label, from) = (rt.find("tile/seeds/tab/seeds").unwrap(), rt.state.steps.len());
    hold(&mut rt, "bed", label);
    assert_eq!(words_in(&rt, "drop/here"), "\u{25ad} tabs");
    let_go(&mut rt, label);
    assert!(lines(&rt, from).iter().any(|line| line.starts_with("layout.move index=") && line.ends_with("to=seeds where=tabs tile=bed")), "{:?}", lines(&rt, from));
    assert!(!rt.state.layout.is_float(&rt.state.layout.named("bed").unwrap()));
    // The lock on the toolbar: a split is refused with the way out, and the lock again lets it through.
    press(&mut rt, "tool/lock");
    assert_eq!(rt.state.layout.policy.flag("locked"), Some(true));
    let split = ran(&mut rt, "tile.split");
    assert!(!split.ok && split.said.contains("is locked") && split.said.contains("unlocks it"), "{}", split.said);
    press(&mut rt, "tool/lock");
    assert!(ran(&mut rt, "tile.split").ok);
}

fn shown_drawn(rt: &Runtime<App>) -> Vec<String> { shown(rt).into_iter().filter(|name| rect_of(rt, &format!("tile/{name}")).is_some()).collect() }
fn ran(rt: &mut Runtime<App>, line: &'static str) -> crate::actions::Outcome { let (send, got) = std::sync::mpsc::channel(); rt.update(move |s, _| { let _ = send.send(s.act(line, Actor::Person)); }); rest(rt); got.recv().unwrap() }

/// A tile let go outside the window is torn into a window of its own, by the action that tears one out.
#[test]
fn a_tile_let_go_outside_the_window_goes_into_a_window_of_its_own() {
    let mut rt = plot();
    let (before, from) = (shown(&rt), rt.state.steps.len());
    hold(&mut rt, "seeds", (-24.0, 300.0));
    assert!(rt.state.moving.as_ref().is_some_and(|held| held.out && held.drop.is_none()));
    let said = element(&rt, "holding").and_then(|e| e.text).unwrap();
    assert!(said.contains(&crate::actions::label("tile.tear")), "the foot says where letting go puts it: {said}");
    let_go(&mut rt, (-24.0, 300.0));
    assert!(lines(&rt, from).contains(&"tile.tear tile=seeds".to_string()), "{:?}", lines(&rt, from));
    assert_eq!(shown(&rt), before.into_iter().filter(|name| name != "seeds").collect::<Vec<_>>());
    let (send, got) = std::sync::mpsc::channel();
    rt.update(move |s, _| { let _ = send.send(s.born().into_iter().map(|born| (born.window(), born.layout.names.0.iter().map(|(_, name)| name.clone()).collect::<Vec<_>>())).collect::<Vec<_>>()); });
    assert_eq!(got.recv().unwrap(), [("seeds".to_string(), vec!["seeds".to_string()])], "the window it asked for holds that tile alone");
}

/// A press in a tile that runs an act there gives that tile the keys, whatever was pressed: a press that leaves
/// Rune's focus where it was says so by the same act.
#[test]
fn a_press_that_runs_an_act_in_a_tile_gives_that_tile_the_keys() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "tile.focus tile=tree").ok);
    let from = g.app.steps.len();
    assert!(g.app.pressed_in("tile.split", "reader").ok);
    g.app.settle();
    assert_eq!(g.app.steps[from..].iter().map(Step::line).collect::<Vec<_>>(), ["tile.focus tile=reader", "tile.split tile=reader"]);
    // In the tile that has them already it is the one act.
    let from = g.app.steps.len();
    g.app.pressed_in("tile.focus tile=tree", "reader2");
    assert_eq!(g.app.steps[from..].iter().map(Step::line).collect::<Vec<_>>(), ["tile.focus tile=tree"]);
}

/// A torn window's tile goes back into the window it was torn from: by its act, by its title dragged out of its
/// window, and by the put-back on its title. It shows what it showed; a layout that takes no tile loses nothing.
#[test]
fn a_torn_window_s_tile_is_put_back_into_the_window_it_came_from() {
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "open id=shed");
    let before: Vec<String> = app.layout.names.0.iter().map(|(_, name)| name.clone()).collect();
    assert!(act(&mut app, "tile.tear tile=reader").ok);
    let mut second = app.born().pop().expect("the act asked for a window");
    second.settle();
    // In the first window it is no way: its tiles are its own, and the refusal names the act that tears one out.
    let own = act(&mut app, "tile.return");
    assert!(!own.ok && own.said.starts_with("this window was torn from no other") && own.said.contains(&keys::cap("tile.tear").unwrap()), "{}", own.said);
    // From the torn window, by its title dragged out of the window: the hold says where letting go puts it.
    let mut rt = window(second);
    assert!(element(&rt, "tile/reader/return").is_some(), "its title has the put-back");
    let from = rt.state.steps.len();
    hold(&mut rt, "reader", (300.0, -30.0));
    let said = element(&rt, "holding").and_then(|e| e.text).unwrap();
    assert!(said.contains(&crate::actions::label("tile.return")), "{said}");
    let_go(&mut rt, (300.0, -30.0));
    assert!(lines(&rt, from).contains(&"tile.return tile=reader".to_string()) && rt.state.closing, "{:?}", lines(&rt, from));
    // The first window takes it in its next turn: a tile of its arrangement again, with the keys, showing the shed.
    app.settle();
    let names: Vec<String> = app.layout.names.0.iter().map(|(_, name)| name.clone()).collect();
    assert_eq!({ let mut sorted = names.clone(); sorted.sort(); sorted }, { let mut sorted = before.clone(); sorted.sort(); sorted }, "{names:?}");
    assert_eq!((app.layout.name(&app.layout.focus), app.note_of(&app.layout.named("reader").unwrap()).as_deref()), ("reader".to_string(), Some("shed")));
    assert!(app.notice.as_ref().is_some_and(|notice| notice.said.contains("reader is back")), "{:?}", app.notice);
    drop(rt);
    // A locked arrangement takes no tile: the tile is in a window of its own again, and the first window says why.
    assert!(act(&mut app, "tile.tear tile=reader").ok);
    let mut second = app.born().pop().unwrap();
    second.settle();
    assert!(act(&mut app, "layout.lock on=true").ok && act(&mut second, "tile.return").ok);
    app.settle();
    assert!(app.layout.named("reader").is_none() && app.notice.as_ref().is_some_and(|notice| notice.tone == Tone::Problem && notice.said.starts_with("reader stays in a window of its own:") && notice.said.contains("locked")), "{:?}", app.notice);
    let again = app.born().pop().expect("it has a window of its own again");
    assert_eq!((again.layout.names.0.len(), again.note_of(&again.layout.focus).as_deref()), (1, Some("shed")));
}

/// What a tile shows goes between windows as it is, whichever way it goes: torn out and put back, a tree keeps the
/// folders folded by hand and the note it unfolded the way to once, so nothing is unfolded again behind the person.
#[test]
fn a_tile_put_back_shows_all_it_showed_as_a_tile_torn_out_does() {
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "open id=fork");
    let tree = app.layout.named("tree").unwrap();
    app.settle();
    let here = app.tiles.get(&tree).cloned().expect("the tree shows something here");
    assert!(here.revealed.is_some(), "the tree unfolded the way to the open note, once: {here:?}");
    assert!(act(&mut app, "tile.tear tile=tree").ok);
    let mut second = app.born().pop().expect("the act asked for a window");
    second.settle();
    let torn = second.tiles.get(&second.layout.focus).cloned().expect("the torn tree shows what it showed");
    assert_eq!(torn, here, "torn out, it shows what it showed");
    // A folder on the way to the open note, folded by hand in the torn window: it stays folded.
    let folder = "onions".to_string();
    assert!(torn.unfolded.contains(&folder), "the way to the open note is unfolded: {torn:?}");
    assert!(act(&mut second, &format!("tree.fold id={folder} open=false")).ok);
    second.settle();
    let torn = second.tiles.get(&second.layout.focus).cloned().unwrap();
    assert!(!torn.unfolded.contains(&folder) && torn.revealed.is_some(), "{torn:?}");
    assert!(act(&mut second, "tile.return").ok);
    app.settle();
    let back = app.layout.named("tree").expect("the tree is back");
    assert_eq!(app.tiles.get(&back), Some(&torn), "put back, it shows what it showed in its own window");
}

/// A tile put back is read by the layout's own reader of a saved tile, as a tile torn out is: what the layout keeps
/// of it beside its fields (what agents may do to it) comes back as the layout's, and is no field of the tile.
#[test]
fn a_tile_put_back_keeps_what_agents_may_do_to_it() {
    let Garden { mut app, .. } = garden(ok());
    act(&mut app, "open id=shed");
    assert!(act(&mut app, "tile.agent policy=off tile=reader").ok && act(&mut app, "tile.tear tile=reader").ok);
    let mut second = app.born().pop().expect("the act asked for a window");
    second.settle();
    assert_eq!(second.layout.agents.get(&second.layout.focus).map(String::as_str), Some("off"), "torn out, it keeps its level");
    assert!(act(&mut second, "tile.return").ok);
    app.settle();
    let back = app.layout.named("reader").expect("the reader is back");
    assert_eq!(app.layout.agents.get(&back).map(String::as_str), Some("off"), "put back, agents may still do nothing to it");
    assert_eq!(app.spec(&back).and_then(|spec| spec.fields.get("agents")), None, "and the level is the layout's, no field of the tile");
    let closed = app.act("tile.close tile=reader", Actor::Agent("seedling-agent".into()));
    assert!(!closed.ok, "an agent's close is still refused: {}", closed.said);
}
