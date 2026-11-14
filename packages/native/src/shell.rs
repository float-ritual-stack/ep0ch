//! The window's shell: any layout tree, drawn. Where each tile sits is the layout's answer (`Layout::placed`, the
//! door's geometry), so a split, a tab set, a dock, a flow and a float are one loop over boxes here, and a screen
//! laid out in the door sits the same way in this window. The shell draws tiles, their borders to drag, the
//! screen's toolbar and the notice; it decides nothing: every press, drag and drop is an act line.
//!
//! A tile held by its title is drawn from what the model holds of it (`App::moving`, `actions/carry.rs`): the
//! places every tile offers, the one under the pointer lit, the held tile dimmed and its name at the pointer. The
//! shell says where the pointer is (`layout.carry`) and that it let go (`layout.drop`), and knows no zone's
//! shape, words or act: those are the layout's drop rule (`layout/drop.rs`, the door's by contract).
use std::hash::{Hash, Hasher};

use rune::{Align, Cx, Drag, El, Phase, Tx, col, el, memo, row, text};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, IconButton, IconButtonVariant, Kit, glyphs};

use crate::actions::{self, Actor, App, CELL, Moving, Tone, word};
use crate::keys;
use crate::layout::drop::Zone;
use crate::layout::tree::{Node, Rect};
use crate::layout::{Axis, Fold};
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
/// The strip a border is dragged by.
const GRIP: f32 = 6.0;
/// How far a title is dragged before it is held: under this, a press is a press.
const HOLD: f32 = 4.0;

/// A box of the layout, in points inside the tiles' area.
fn points(r: Rect) -> [f32; 4] { [r.col as f32 * CELL.0, r.row as f32 * CELL.1, r.cols as f32 * CELL.0, r.rows as f32 * CELL.1] }

/// Where a held title is, said as act lines: the cell the pointer is over once it has moved far enough to be a
/// hold (`layout.carry`, said again only when the cell changes), and that it was let go (`layout.drop`; Escape
/// ends the drag with nothing moved).
fn carried(d: &Drag, moving: Option<&Moving>, name: &str, Frame { origin, window }: Frame) -> Option<String> {
    match d.phase {
        Phase::Down => None,
        Phase::Move => {
            if moving.is_none() && d.dx.abs() < HOLD && d.dy.abs() < HOLD { return None }
            let [x, y] = d.window_point();
            let out = x < 0.0 || y < 0.0 || x >= window[0] || y >= window[1];
            let at = (((x - origin[0]) / CELL.0).floor() as f64, ((y - origin[1]) / CELL.1).floor() as f64);
            if moving.is_some_and(|held| held.at == Some(at) && held.out == out) { return None }
            Some(format!("layout.carry col={} row={}{} tile={}", at.0, at.1, if out { " out=true" } else { "" }, word(name)))
        }
        Phase::Up => moving.map(|_| if d.cancelled() { "layout.drop cancel=true".to_string() } else { "layout.drop".to_string() }),
    }
}

/// What the shell knows of the window while it draws a title: where the tiles' area is, and how large the window is.
#[derive(Clone, Copy)]
struct Frame { origin: [f32; 2], window: [f32; 2] }

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

/// A tile folded to a spine: a strip with its name where it stood (down a row of tiles, or across a column of
/// them). A press opens it again; held and dragged, it moves as any tile does.
fn spine(s: &App, id: &str, at: [f32; 4], fold: &Fold, frame: Frame, k: &Kit) -> El {
    let c = &k.c;
    let name = s.layout.name(id);
    let line = format!("tile.collapse on=false tile={}", word(&name));
    let ink = if s.layout.focus == id { c.text_base } else { c.text_muted };
    let said = if fold.flat { row().w_full().h_full().center_y().px(8.0).child(text(name.clone()).font(k.ty.small).color(ink).truncate()) } else { name.chars().fold(col().w_full().h_full().items_center().py(6.0), |spine, letter| spine.child(text(letter.to_string()).font(k.ty.small).color(ink))) };
    keys::tile(k.interactive(said.key(format!("tile/{name}")).role("button").label(format!("{name}: {}", actions::label(&line))).absolute(at[0], at[1]).w(at[2]).h(at[3]).radius(k.radius.sm).fill(c.layer_01).border(1.0, if s.layout.focus == id { c.border_focus } else { c.border_muted }))
        .opacity(if s.moving.as_ref().is_some_and(|held| held.tile == id) { 0.4 } else { 1.0 })
        .on_press(act(line)).on_drag(move |s: &mut App, d: &mut Drag, _: &mut Tx| if let Some(line) = carried(d, s.moving.as_ref(), &name, frame) { s.act(&line, Actor::Person); }))
}

/// One tile in its box: its title bar (its name, or its set's tabs; held and dragged to move it), then what its
/// drawer draws.
fn tile(s: &App, id: &str, r: Rect, frame: Frame, dark: bool, k: &Kit) -> El {
    let c = &k.c;
    let at = points(r);
    if let Some(fold) = s.layout.collapsed.get(id).filter(|_| s.layout.zoom.is_none()) { return spine(s, id, at, fold, frame, k) }
    let name = s.layout.name(id);
    let focused = s.layout.focus == id;
    let spec = s.spec(id);
    let kind = spec.map_or("", |spec| spec.kind.as_str());
    // Its tab set's tabs, when it is the one in front of a set: each label takes the cells the model says, so a tile
    // let go over one lands before that tab. A tab is held by its own label, and the title's bare part holds the one in front.
    let tabs = s.tab_cells(id, r);
    let mut title = row().center_y().grow(1.0).min_w(0.0).child(el().w(((tabs.first().map_or(r.col, |tab| tab.from) - r.col) as f32 * CELL.0 - 6.0).max(0.0)));
    for tab in &tabs {
        let (here, tab_name, alone) = (tab.id == id, s.layout.name(&tab.id), tabs.len() == 1);
        let label = text(tab_name.clone()).font(if here { k.ty.ui_medium } else { k.ty.ui }).color(if here { c.text_base } else { c.text_muted }).truncate().px(6.0).py(3.0).radius(k.radius.sm);
        let label = if alone { label.min_w(0.0) } else { label.w((tab.to - tab.from) as f32 * CELL.0) };
        title = title.child(k.interactive(label).key(format!("tile/{name}/tab/{tab_name}")).role("tab").on_press(act(format!("tile.focus tile={}", word(&tab_name))))
            .on_drag(move |s: &mut App, d: &mut Drag, _: &mut Tx| if let Some(line) = carried(d, s.moving.as_ref(), &tab_name, frame) { s.act(&line, Actor::Person); }));
    }
    let floats = s.layout.is_float(id);
    let mut bar = row().key(format!("tile/{name}/bar")).w_full().h(TITLE).gap(6.0).center_y().px(6.0).fill(if focused { c.layer_02 } else { c.layer_01 }).child(title);
    // A set whose tabs take the whole title has no room for more than its close: the model says where the labels end.
    let roomy = tabs.len() == 1 || s.title_has_room(&tabs, r);
    // What kind of tile it is, in the kind's own word for itself (its row's name), else as its spec names it.
    if roomy { bar = bar.child(Badge::new(s.kind_of(id).map(|row| row.name.clone()).filter(|name| !name.is_empty()).unwrap_or_else(|| kind.to_string())).variant(BadgeVariant::Subtle).build(k)) }
    // The tile with the keys says what can be done with it where it is: fold it, pop it out. A float says the way back.
    let control = |glyph: &'static rune::Icon, line: String, part: &str| IconButton::new(glyph).variant(IconButtonVariant::GhostMuted).label(actions::label(&line)).on_press(act(line)).build(k).key(format!("tile/{name}/{part}"));
    if focused && roomy && !floats && s.layout.zoom.is_none() { bar = bar.child(control(&glyphs::DASH, format!("tile.collapse tile={}", word(&name)), "fold")) }
    // In a window torn from another, the way back to the window it came from.
    if s.torn() { bar = bar.child(control(&glyphs::ARROW_RIGHT, format!("tile.return tile={}", word(&name)), "return")) }
    if (focused && roomy) || floats { bar = bar.child(control(&glyphs::COPY, format!("tile.float tile={}", word(&name)), "float")) }
    let bar = bar.child(control(&glyphs::CLOSE, format!("tile.close tile={}", word(&name)), "close"));
    let dragged = name.clone();
    let bar = bar.on_drag(move |s: &mut App, d: &mut Drag, _: &mut Tx| if let Some(line) = carried(d, s.moving.as_ref(), &dragged, frame) { s.act(&line, Actor::Person); });
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
    // The tile that is held is dimmed where it stands until it is let go.
    keys::tile(col().key(format!("tile/{name}")).role("group").label(name.clone()).absolute(at[0], at[1]).w(at[2]).h(at[3]).radius(k.radius.md).fill(c.surface_base).border(1.0, if focused { c.border_focus } else { c.border_muted })
        .opacity(match s.moving.as_ref().filter(|held| held.tile == id) { Some(held) if held.lifted.is_none() => 0.4, Some(_) => 0.9, None => 1.0 })
        .child(bar)
        .child(body.child(el().w_full().grow(1.0).min_h(0.0).child(drawn))))
}

/// One place a held tile can land in, as the layout's drop rule answers it: its box, its words, and why the
/// layout refuses the held tile there. The one under the pointer is lit; the rest are dim.
fn zone(place: &Zone, lit: bool, key: String, k: &Kit) -> El {
    let c = &k.c;
    let p = points(place.ghost);
    let colors = match (&place.refused, lit) { (Some(_), true) => &c.danger, (None, true) => &c.warning, _ => &c.info };
    let (ink, edge, ground) = if lit { (colors.fg, colors.fg, colors.bg) } else { (if place.refused.is_some() { c.text_muted } else { c.text_base }, c.border_base, c.layer_01.alpha(0.7)) };
    // A refused place says why where the pointer has the tile over it, and elsewhere is marked as refused in its own
    // words (every tile shows its places at once: the reason in each would cover the window); read, it says why.
    let why = place.refused.as_ref().map(|why| format!("\u{2715} {why}"));
    let said = match (&why, lit) { (Some(why), true) => why.clone(), (Some(_), false) => format!("\u{2715} {}", place.label), (None, _) => place.label.clone() };
    // (The lit place's words stand at its top where it has the room: the held tile's name is at the pointer.)
    let boxed = if lit && place.ghost.rows >= 4.0 { col().center_y().py(8.0) } else { el().center() };
    boxed.key(key).role("option").label(why.unwrap_or_else(|| said.clone())).absolute(p[0], p[1]).w(p[2]).h(p[3]).radius(k.radius.sm).fill(ground).border(if lit { 2.0 } else { 1.0 }, edge).opacity(if lit { 1.0 } else { 0.8 }).px(4.0)
        .child(text(said).font(if lit { k.ty.small_medium } else { k.ty.small }).color(ink).align(Align::Center).wrap())
}

/// Everything a held tile draws over the tiles: each tile's places, the place under the pointer when it is no
/// tile's own zone (an outer edge, a shut dock's strip, a title's row), and the held tile's name at the pointer.
fn holding(s: &App, held: &Moving, mut area: El, k: &Kit) -> El {
    for (id, zones) in &held.zones {
        let tile = s.layout.name(id);
        for place in zones { area = area.child(zone(place, held.lit(place), format!("drop/{tile}/{}", place.place.word()), k)) }
    }
    if let Some(place) = held.drop.as_ref().filter(|place| !held.zones.iter().flat_map(|(_, zones)| zones).any(|zone| held.lit(zone) && zone.ghost == place.ghost)) {
        // (A title's row is one cell high: the box drawn over the whole tile is its first row, where the tabs are.)
        let over = if place.handle || place.place.target().is_none() { place.clone() } else { Zone { ghost: Rect { rows: 1.0, ..place.ghost }, ..place.clone() } };
        area = area.child(zone(&over, true, "drop/here".into(), k));
    }
    // What is held, where letting go puts it (the place's own words, or that it leaves the window) and the key that
    // lets go with nothing moved, as the key table has it: along the foot of the tiles, over everything.
    let name = s.layout.name(&held.tile);
    let place = if held.out { Some(actions::label(s.leaves_by().id)) } else { held.drop.as_ref().map(|place| place.refused.clone().unwrap_or_else(|| place.label.clone())) };
    let said: Vec<String> = std::iter::once(name.clone()).chain(place).chain(keys::hints(s.person().layer).into_iter().map(|(cap, does)| format!("{cap} {does}"))).collect();
    let (width, height) = (s.area.cols as f32 * CELL.0, s.area.rows as f32 * CELL.1);
    area = area.child(el().key("drop/foot").absolute(0.0, height - 40.0).w(width).h(28.0).center()
        .child(row().px(12.0).py(5.0).radius(k.radius.md).fill(k.c.bg_inverse).child(text(said.join(" \u{b7} ")).key("holding").font(k.ty.small_medium).color(k.c.text_inverse).truncate())));
    let Some((col, row)) = held.at.filter(|_| !held.out) else { return area };
    area.child(row_chip(&name, [(col as f32 + 2.0) * CELL.0, (row as f32 + 1.0) * CELL.1], k))
}

/// The held tile's name, beside the pointer.
fn row_chip(name: &str, at: [f32; 2], k: &Kit) -> El {
    row().key("drop/held").absolute(at[0], at[1]).px(8.0).py(3.0).gap(6.0).center_y().radius(k.radius.sm).fill(k.c.bg_inverse).child(text(format!("\u{283f} {name}")).font(k.ty.small_medium).color(k.c.text_inverse))
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

/// A shut dock's strip at its edge: a press slides it open, and a held tile let go on it joins what it shows.
fn dock_strip(strip: &actions::Strip, k: &Kit) -> El {
    let [x, y, w, h] = points(strip.at);
    let line = format!("dock.toggle side={}", strip.side.word());
    k.interactive(el().absolute(x, y).w(w).h(h).fill(k.c.layer_02).border(1.0, k.c.border_muted).radius(k.radius.sm))
        .key(format!("dock/{}", strip.side.word())).role("button").label(actions::label(&line)).help(actions::label(&line)).on_press(act(line))
}

/// The toolbar's own room at its sides, and the room it leaves after the window's buttons where they sit over it.
const TOOLBAR_PAD: f32 = 10.0;
const AFTER_BUTTONS: f32 = 12.0;

/// Where the toolbar's first word starts: its own room, or past the window's own buttons when they are drawn over
/// the content (`inset`: Rune's `Cx::titlebar_inset`, the trailing edge of macOS's traffic lights in a window whose
/// content fills it under the title bar; 0 in full screen, in a titled window and on every other platform).
pub(crate) fn toolbar_lead(inset: f32) -> f32 { if inset > 0.0 { (inset + AFTER_BUTTONS).max(TOOLBAR_PAD) } else { TOOLBAR_PAD } }

/// The frame every window of the run has. Rune's default on macOS: the content fills the window under a clear title
/// bar, and the toolbar is that bar's row (it starts past the traffic lights: `toolbar_lead`). Elsewhere the native
/// frame stays whatever this says, so it says so: a headless render then reports the inset this platform's window
/// has (none), where Rune's default reports a Mac's on every platform.
pub fn frame() -> rune::Chrome { rune::Chrome { full_size_content: cfg!(target_os = "macos"), ..rune::Chrome::DEFAULT } }

/// The screen's toolbar: who answers, then one button an act line of the screen's own list.
fn toolbar(s: &App, lead: f32, k: &Kit) -> El {
    let c = &k.c;
    // A press on the toolbar leaves the words selected in a note selected, and the keys where they are: its button
    // that comments is pressed for those words (a press anywhere else in the window lets a selection go first).
    let mut bar = row().key("toolbar").w_full().gap(8.0).center_y().pl(lead).pr(TOOLBAR_PAD).py(6.0).keeps_text_selection()
        .child(text(s.at.outline.clone()).key("outline-name").font(k.ty.body_medium).color(c.text_base).truncate())
        .child(text(if s.online { format!("on {}", if s.machine.is_empty() { "…" } else { &s.machine }) } else { "offline".to_string() }).font(k.ty.small).color(if s.online { c.text_faint } else { c.danger.fg }).truncate())
        .child(Badge::new(s.screen.title.clone()).variant(BadgeVariant::Subtle).build(k).key("screen-name"));
    // The outlines this window left, each a press back to it as it was left.
    for at in { let mut left: Vec<_> = s.parked.keys().collect(); left.sort(); left } {
        let line = format!("outline.switch name={} machine={}", word(&at.outline), word(&at.machine));
        bar = bar.child(k.interactive(Badge::new(at.outline.clone()).variant(BadgeVariant::Subtle).build(k)).key(format!("parked/{}", at.outline)).role("button").label(actions::label(&line)).on_press(act(line)));
    }
    // What an agent last did here, said where the person sees it. A toolbar full of buttons cuts it short, so the
    // whole of it is what a pointer resting on it reads.
    if let Some(said) = &s.agent_said { bar = bar.child(text(said.clone()).key("status").font(k.ty.small).color(c.text_muted).truncate().help(said.clone())) }
    bar = bar.child(el().grow(1.0));
    // The screen's own toolbar, as the service lists it now: a screen note changed since the window opened is followed.
    for line in s.spec_now().map(|spec| spec.toolbar()).unwrap_or_default() { bar = bar.child(button(&line, ButtonVariant::Ghost).build(k).key(format!("tool/{line}"))) }
    // The arrangement's lock: lit while its shape is fixed, a press the other way.
    let locked = s.layout.policy.flag("locked") == Some(true);
    bar.child(IconButton::new(&glyphs::LOCK).variant(if locked { IconButtonVariant::Neutral } else { IconButtonVariant::GhostMuted }).label(actions::label("layout.lock")).on_press(act("layout.lock")).build(k).key("tool/lock"))
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

/// A window torn from another, opened: its own tree, keys and focus over the state the act made for it (`App::born`),
/// which shares the first window's store. `made` is what every window of the run is made of (its view, its keys, its
/// poll: `main.rs` says them once). Agents reach it by its name while it is open. A headless run opens nothing.
pub fn open(born: App, made: rune::AppSpec<App>) {
    let name = born.window();
    let window = rune::App::new(made).chrome(frame()).init(move || born).on_close(crate::control::gone);
    crate::control::here(&name, window.handle());
    rune::open_window(rune::WindowSpec::from_app(format!("window/{name}"), window));
}

pub fn view(s: &App, cx: &mut Cx<App>) -> El {
    let dark = cx.system_dark();
    let k = Kit::neutral(dark);
    let mut layer = Vec::new();
    // Where the tiles' area is in the window, and how large the window is: a drag says where the pointer is in the
    // window's own points.
    let origin = cx.window_layout("tiles").map_or([0.0, 0.0], |r| [r[0], r[1]]);
    let frame = Frame { origin, window: cx.window_layout("shell").map_or([f32::MAX, f32::MAX], |r| [r[2], r[3]]) };
    let holds = |_: &str| false;
    let (base, slid) = s.layout.placed(s.area, &holds);
    let rects = s.layout.rects(s.area, &holds);
    // In front last: the tiles of the tree, then the docks that slide over them, then the floats.
    let over = |id: &str| if s.layout.is_float(id) { 2 } else if slid.iter().any(|dock| dock.placed.rect(id).is_some()) { 1 } else { 0 };
    let mut order: Vec<&(String, Rect)> = rects.iter().filter(|(_, r)| r.cols > 0.0 && r.rows > 0.0).collect();
    order.sort_by_key(|(id, _)| over(id));
    let mut area = el().key("tiles").w_full().grow(1.0).min_h(0.0).on_layout(|s: &mut App, r: [f32; 4]| s.resized(r[2], r[3]));
    // (A float that is held is drawn where the hand has it.)
    let lifted = |id: &str, r: Rect| s.moving.as_ref().filter(|held| held.tile == id).and_then(|held| held.lifted).map_or(r, |(col, row)| Rect { col, row, ..r });
    for (id, r) in &order { area = area.child(tile(s, id, lifted(id, *r), frame, dark, &k)) }
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
    }
    for strip in s.dock_strips() { area = area.child(dock_strip(&strip, &k)) }
    // A tile held by its title: where it can land, over everything in the tiles' area.
    if let Some(held) = &s.moving { area = holding(s, held, area, &k) }
    // (The window's own ground is the theme's page: a light theme's translucent surfaces read as light over it.)
    let mut body = col().key("shell").w_full().h_full().fill(k.c.page).child(toolbar(s, toolbar_lead(cx.titlebar_inset()), &k));
    if let Some(n) = notice(s, &k) { body = body.child(el().w_full().px(10.0).pb(6.0).child(n)) }
    // What a tile draws over the window (the list that completes what is typed in it, at its caret), while the bar is
    // away. The caret is read only while there is something to hang on it: a view that reads it runs again when it moves.
    if !s.bar.open {
        for id in s.shown_tiles() {
            let Some(tile) = s.cx(&id) else { continue };
            let Some(over) = tiles::drawer_of(tile.row).and_then(|drawer| drawer.over) else { continue };
            let caret = (tile.focused && s.completing(&id).is_some()).then(|| cx.caret("input")).flatten();
            over(&tile, caret, &k, &mut layer);
        }
    }
    crate::bar::view(s, &k, &mut layer);
    rune_kit::root(body.child(area), layer)
}
