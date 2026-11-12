//! The window's shell: any layout tree, drawn. Where each tile sits is the layout's answer (`Layout::placed`, the
//! door's geometry), so a split, a tab set, a dock, a flow and a float are one loop over boxes here, and a screen
//! laid out in the door sits the same way in this window. The shell draws tiles, their borders to drag, the
//! screen's toolbar and the notice; it decides nothing: every press, drag and drop is an act line.
use std::hash::{Hash, Hasher};
use std::rc::Rc;

use rune::{Cx, Drag, El, Phase, Tx, col, el, memo, row, text};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, IconButton, IconButtonVariant, Kit, glyphs};

use crate::actions::{self, Actor, App, CELL, Tone, word};
use crate::keys;
use crate::layout::tree::{self, Node, Rect};
use crate::layout::{Axis, Dir};
use crate::tiles;

/// A press that runs an act line, as the person.
fn act(line: impl Into<String>) -> impl Fn(&mut App) + Clone + 'static {
    let line = line.into();
    move |s: &mut App| { s.act(&line, Actor::Person); }
}

/// A button for an act line: its label is the action's, its keycap the key table's.
fn button(line: &str, variant: ButtonVariant) -> Button {
    let b = Button::new(actions::label(line)).variant(variant).on_press(act(line));
    match keys::cap(line) { Some(cap) => b.shortcut(cap), None => b }
}

/// A tile's title bar, in points.
const TITLE: f32 = 26.0;
/// The strip a border is dragged by, and the one a shut dock is opened by.
const GRIP: f32 = 6.0;
const DOCK_STRIP: f32 = 14.0;

/// A box of the layout, in points inside the tiles' area.
fn points(r: Rect) -> [f32; 4] { [r.col as f32 * CELL.0, r.row as f32 * CELL.1, r.cols as f32 * CELL.0, r.rows as f32 * CELL.1] }

type Boxes = Rc<Vec<(String, [f32; 4])>>;

/// The tile under a point and the side of it the point is nearest: a centre third, else the nearest edge.
fn drop_side(boxes: &[(String, [f32; 4])], [x, y]: [f32; 2]) -> Option<(&str, &'static str)> {
    let (name, r) = boxes.iter().rev().find(|(_, r)| x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3])?;
    let (fx, fy) = ((x - r[0]) / r[2], (y - r[1]) / r[3]);
    let side = if (1.0 / 3.0..2.0 / 3.0).contains(&fx) && (1.0 / 3.0..2.0 / 3.0).contains(&fy) { "center" } else { [("left", fx), ("right", 1.0 - fx), ("top", fy), ("bottom", 1.0 - fy)].into_iter().min_by(|a, b| a.1.total_cmp(&b.1)).map_or("center", |side| side.0) };
    Some((name, side))
}

/// The act line a title let go of says: the tile under the pointer and the side of it, when that is another tile.
fn dropped(d: &Drag, boxes: &[(String, [f32; 4])], origin: [f32; 2], dragged: &str) -> Option<String> {
    if d.phase != Phase::Up || d.cancelled() || (d.dx.abs() < 4.0 && d.dy.abs() < 4.0) { return None }
    let [x, y] = d.window_point();
    let (to, side) = drop_side(boxes, [x - origin[0], y - origin[1]])?;
    (to != dragged).then(|| format!("tile.move side={side} to={} tile={}", word(to), word(dragged)))
}

/// What a tile's body is drawn from, as one number: its drawer's own state, how each of its asks stands, whether
/// it has the keys, what the service says is wrong with it. An unchanged tile is not drawn again.
fn version(s: &App, cx: &tiles::TileCx, drawer: &tiles::Drawer, problems: &[String], dark: bool) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    // Its spec's fields by what they say, not how many there are: a query edited in place is another tile to draw.
    let fields = serde_json::to_string(&cx.spec.fields).unwrap_or_default();
    (cx.id, &cx.name, &cx.spec.kind, fields, cx.focused, dark, problems, (drawer.version)(cx), s.online, &s.machine).hash(&mut h);
    for (role, ask) in (drawer.asks)(cx) { (role, s.store().epoch(&ask), s.store().waiting(&ask), s.store().refusal(&ask).is_some()).hash(&mut h) }
    h.finish()
}

/// One tile in its box: its title bar (its name, or its set's tabs; dragged to move it), then what its drawer draws.
fn tile(s: &App, id: &str, at: [f32; 4], boxes: &Boxes, origin: [f32; 2], dark: bool, k: &Kit) -> El {
    let c = &k.c;
    let name = s.layout.name(id);
    let focused = s.layout.focus == id;
    let spec = s.spec(id);
    let kind = spec.map_or("", |spec| spec.kind.as_str());
    // Its tab set's tabs, when it is the one in front of a set.
    let tabs: Vec<String> = match tree::tabs_of(s.layout.tree(), id).and_then(|p| s.layout.tree().at(&p)) { Some(Node::Tabs { kids, .. }) => kids.iter().map(|spec| s.layout.name(&spec.id)).collect(), _ => vec![name.clone()] };
    let mut title = row().gap(2.0).center_y().grow(1.0).min_w(0.0);
    for tab in &tabs {
        let here = *tab == name;
        title = title.child(
            k.interactive(text(tab.clone()).font(if here { k.ty.ui_medium } else { k.ty.ui }).color(if here { c.text_base } else { c.text_muted }).truncate().px(6.0).py(3.0).radius(k.radius.sm))
                .key(format!("tile/{name}/tab/{tab}")).role("tab").on_press(act(format!("tile.focus tile={}", word(tab)))),
        );
    }
    // The title is what a tile is moved by: where it is dropped says the tile it goes by and the side.
    let (dragged, held) = (name.clone(), boxes.clone());
    let bar = row().key(format!("tile/{name}/bar")).w_full().h(TITLE).gap(6.0).center_y().px(6.0).fill(if focused { c.layer_02 } else { c.layer_01 })
        .child(title)
        // What kind of tile it is, in the kind's own word for itself (its row's name), else as its spec names it.
        .child(Badge::new(s.kind_of(id).map(|row| row.name.clone()).filter(|name| !name.is_empty()).unwrap_or_else(|| kind.to_string())).variant(BadgeVariant::Subtle).build(k))
        .child(IconButton::new(&glyphs::CLOSE).variant(IconButtonVariant::GhostMuted).label(actions::label("tile.close")).on_press(act(format!("tile.close tile={}", word(&name)))).build(k).key(format!("tile/{name}/close")))
        .on_drag(move |s: &mut App, d: &mut Drag, _: &mut Tx| if let Some(line) = dropped(d, &held, origin, &dragged) { s.act(&line, Actor::Person); });
    let problems = s.problems_of(id);
    let mut body = col().w_full().grow(1.0).min_h(0.0);
    // What the service says is wrong with this tile is said on it, in its words.
    for (i, said) in problems.iter().enumerate() { body = body.child(text(said.clone()).key(format!("tile/{name}/problem/{i}")).font(k.ty.small).color(c.danger.fg).wrap().px(10.0).py(6.0)) }
    let drawn = match (s.cx(id), spec) {
        (Some(cx), _) => match tiles::drawer_of(cx.row) {
            Some(drawer) => memo(format!("tile/{name}/body"), version(s, &cx, drawer, &problems, dark), || col().w_full().h_full().min_h(0.0).child((drawer.draw)(&cx, k))),
            None => tiles::as_data(cx.spec, &name, k),
        },
        (None, Some(spec)) => tiles::as_data(spec, &name, k),
        (None, None) => el(),
    };
    keys::tile(col().key(format!("tile/{name}")).role("group").label(name.clone()).absolute(at[0], at[1]).w(at[2]).h(at[3]).radius(k.radius.md).fill(c.surface_base).border(1.0, if focused { c.border_focus } else { c.border_muted })
        .child(bar)
        .child(body.child(el().w_full().grow(1.0).min_h(0.0).child(drawn))))
}

/// The strip between two kids of a split: dragged, it moves their border (`layout.resize`).
fn grip(split: &str, border: usize, axis: Axis, a: Rect, b: Rect, share: f32, origin: [f32; 2], k: &Kit) -> El {
    let (pa, pb) = (points(a), points(b));
    let row_wise = axis == Axis::Row;
    let (start, span) = if row_wise { (pa[0], pa[2] + pb[2]) } else { (pa[1], pa[3] + pb[3]) };
    let at = if row_wise { [pb[0] - GRIP / 2.0, pa[1], GRIP, pa[3]] } else { [pa[0], pb[1] - GRIP / 2.0, pa[2], GRIP] };
    let split = split.to_string();
    k.interactive(el().absolute(at[0], at[1]).w(at[2]).h(at[3]))
        .key(format!("grip/{split}/{border}")).role("separator").label("The border between two tiles: drag it to resize them")
        .on_drag(move |s: &mut App, d: &mut Drag, _: &mut Tx| if let Some(line) = resized(d, &split, border, row_wise, origin, start, span, share) { s.act(&line, Actor::Person); })
}

/// The act line a drag on a border says now: the share its pointer is at; let go with Escape, the share the border
/// had at the press (the drag's own way back: `layout.undo` is another change's).
fn resized(d: &mut Drag, split: &str, border: usize, row_wise: bool, origin: [f32; 2], start: f32, span: f32, share: f32) -> Option<String> {
    let line = |share: f32| format!("layout.resize split={} border={border} share={share:.4}", word(split));
    match d.phase {
        // What the drag holds on to: the share at the press, negative once the border has been moved.
        Phase::Down => { d.data = share; None }
        Phase::Move => {
            let [x, y] = d.window_point();
            let along = if row_wise { x - origin[0] } else { y - origin[1] };
            if span <= 0.0 { return None }
            d.data = -d.data.abs();
            Some(line((along - start) / span))
        }
        Phase::Up => (d.cancelled() && d.data < 0.0).then(|| line(-d.data)),
    }
}

/// A shut dock's strip at its edge: a press slides it open.
fn dock_strip(side: Dir, at: Rect, width: f32, height: f32, k: &Kit) -> El {
    let p = points(at);
    let [x, y, w, h] = match side {
        Dir::Left | Dir::Right => [p[0].min(width - DOCK_STRIP).max(0.0), p[1], DOCK_STRIP, p[3]],
        Dir::Up | Dir::Down => [p[0], p[1].min(height - DOCK_STRIP).max(0.0), p[2], DOCK_STRIP],
    };
    let line = format!("dock.toggle side={}", side.word());
    k.interactive(el().absolute(x, y).w(w).h(h).fill(k.c.layer_02).border(1.0, k.c.border_muted).radius(k.radius.sm))
        .key(format!("dock/{}", side.word())).role("button").label(actions::label(&line)).help(actions::label(&line)).on_press(act(line))
}

/// The screen's toolbar: who answers, then one button an act line of the screen's own list.
fn toolbar(s: &App, k: &Kit) -> El {
    let c = &k.c;
    let mut bar = row().key("toolbar").w_full().gap(8.0).center_y().px(10.0).py(6.0)
        .child(text(s.at.outline.clone()).key("outline-name").font(k.ty.body_medium).color(c.text_base).truncate())
        .child(text(if s.online { format!("on {}", if s.machine.is_empty() { "…" } else { &s.machine }) } else { "offline".to_string() }).font(k.ty.small).color(if s.online { c.text_faint } else { c.danger.fg }).truncate())
        .child(Badge::new(s.screen.title.clone()).variant(BadgeVariant::Subtle).build(k).key("screen-name"));
    // What an agent last did here, said where the person sees it.
    if let Some(said) = &s.agent_said { bar = bar.child(text(said.clone()).key("status").font(k.ty.small).color(c.text_muted).truncate()) }
    bar = bar.child(el().grow(1.0));
    for line in s.screen.toolbar() { bar = bar.child(button(&line, ButtonVariant::Ghost).build(k).key(format!("tool/{line}"))) }
    bar
}

fn notice(s: &App, k: &Kit) -> Option<El> {
    let notice = s.notice.as_ref()?;
    let colors = match notice.tone { Tone::Info => &k.c.info, Tone::Problem => &k.c.danger };
    let mut bar = row().key("notice").w_full().px(12.0).py(8.0).gap(10.0).radius(k.radius.md).fill(colors.bg).border(1.0, colors.border).center_y()
        .child(text(notice.said.clone()).font(k.ty.small).color(colors.fg).wrap().grow(1.0));
    // What it did can be taken back: the notice carries the act line that does.
    if let Some(undo) = &notice.undo { bar = bar.child(button(undo, ButtonVariant::Ghost).build(k).key("notice-undo")) }
    Some(bar.child(IconButton::new(&glyphs::CLOSE).variant(IconButtonVariant::GhostMuted).label(actions::label("notice.dismiss")).on_press(act("notice.dismiss")).build(k).key("notice-close")))
}

pub fn view(s: &App, cx: &mut Cx<App>) -> El {
    let dark = cx.system_dark();
    let k = Kit::neutral(dark);
    let mut layer = Vec::new();
    // Where the tiles' area is in the window: a drag says where the pointer is in the window's own points.
    let origin = cx.window_layout("tiles").map_or([0.0, 0.0], |r| [r[0], r[1]]);
    let (width, height) = (s.area.cols as f32 * CELL.0, s.area.rows as f32 * CELL.1);
    let holds = |_: &str| false;
    let (base, slid) = s.layout.placed(s.area, &holds);
    let rects = s.layout.rects(s.area, &holds);
    // In front last: the tiles of the tree, then the docks that slide over them, then the floats.
    let over = |id: &str| if s.layout.is_float(id) { 2 } else if slid.iter().any(|dock| dock.placed.rect(id).is_some()) { 1 } else { 0 };
    let mut order: Vec<&(String, Rect)> = rects.iter().filter(|(_, r)| r.cols > 0.0 && r.rows > 0.0).collect();
    order.sort_by_key(|(id, _)| over(id));
    let boxes: Boxes = Rc::new(order.iter().map(|(id, r)| (s.layout.name(id), points(*r))).collect());
    let mut area = el().key("tiles").w_full().grow(1.0).min_h(0.0).on_layout(|s: &mut App, r: [f32; 4]| s.resized(r[2], r[3]));
    for (id, r) in &order { area = area.child(tile(s, id, points(*r), &boxes, origin, dark, &k)) }
    if s.layout.zoom.is_none() {
        // A border between two kids of a split that both show and neither is a spine: a grip to drag.
        for (path, kid_boxes) in base.lines.iter().chain(slid.iter().flat_map(|dock| dock.placed.lines.iter())) {
            let Some(line @ Node::Split { dir, .. }) = s.layout.tree().at(path) else { continue };
            let Some(id) = line.id() else { continue };
            let sized = |i: usize| { let b = kid_boxes[i]; b.cols > 0.0 && b.rows > 0.0 && !line.kids()[i].leaves().iter().all(|t| s.layout.collapsed.has(t)) };
            // The first side's part of the two, as the layout holds it: where a drag let go with Escape goes back to.
            let share = |i: usize| { let w = line.weights(); let two = w[i] + w[i + 1]; if two > 0.0 { (w[i] / two) as f32 } else { 0.5 } };
            for i in 0..kid_boxes.len().saturating_sub(1) { if sized(i) && sized(i + 1) { area = area.child(grip(id, i, *dir, kid_boxes[i], kid_boxes[i + 1], share(i), origin, &k)) } }
        }
        for (path, at) in &base.docks { if let Some(Node::Dock { side, open: false, .. }) = s.layout.tree().at(path) { area = area.child(dock_strip(*side, *at, width, height, &k)) } }
    }
    let mut body = col().key("shell").w_full().h_full().child(toolbar(s, &k));
    if let Some(n) = notice(s, &k) { body = body.child(el().w_full().px(10.0).pb(6.0).child(n)) }
    crate::bar::view(s, &k, &mut layer);
    rune_kit::root(body.child(area), layer)
}
