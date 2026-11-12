//! The window, drawn from rune-kit's parts: the shell's split view (a sidebar of the outline's tree, the open note,
//! an inspector), Markdown for prose, and the command bar over it. Nothing here reads Blockdown: prose arrives as
//! Markdown and components as the service answered them. And nothing here changes the window: a press runs an
//! act line, and a button's label and keycap are read from that line's action (`actions::label`, `keys::cap`).
use std::borrow::Cow;
use std::rc::Rc;

use rune::{Cx, El, Icon, ScrollSpec, SurfaceFit, TextStyle, col, el, row, text};
use rune_kit::shell::{Sidebar, SidebarRow, SplitView, Toolbar};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, IconButton, IconButtonVariant, Keybind, Kit, Markdown, glyphs};

use crate::actions::{self, Actor, App, Field, Shown, Tone, TreeLine, word};
use crate::keys::{self, Layer};
use crate::list::{self, Rows};
use crate::page::{Frame, ListRow, NoteRow, Page, Part, Picture};

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

static PLUS: Icon = Icon { name: "ep0ch-plus", view: 16.0, body: r#"<path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"# };
static BACK: Icon = Icon { name: "ep0ch-back", view: 16.0, body: r#"<path d="M9.5 3.5L5 8L9.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>"# };
static FILTER: Icon = Icon { name: "ep0ch-filter", view: 16.0, body: r#"<path d="M3 4.5H13M5 8H11M7 11.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"# };
static DOT: Icon = Icon { name: "ep0ch-dot", view: 16.0, body: r#"<circle cx="8" cy="8" r="1.6" fill="currentColor"/>"# };

const ROW: f32 = 28.0;

fn sized(base: TextStyle, size: f32, line: f32) -> TextStyle { TextStyle { size, line_height: line, ..base } }

/// A terminal row in points: a note gives a picture's height in rows, as the door reads it.
const ROW_POINTS: f32 = 20.0;
/// A header image's height when the note names none.
const HERO_POINTS: f32 = 220.0;

pub fn view(s: &App, cx: &mut Cx<App>) -> El {
    let k = Kit::neutral(cx.system_dark());
    let mut layer = Vec::new();
    let main = match (&s.editing, s.shown()) {
        (Some(_), _) => editor(s, &k),
        (None, Some(page)) => note(s, page, &k),
        (None, None) => empty(s, &k),
    };
    let body = SplitView::new(main)
        .sidebar(&s.sidebar, |s: &mut App| s.pane(true), sidebar(s, &k))
        .inspector(&s.inspector, |s: &mut App| s.pane(false), inspector(s, &k))
        .toolbar(toolbar(s, &k))
        .titlebar_inset(cx.titlebar_inset())
        .frame_inset(8.0)
        .toolbar_in_panel()
        .reduced_motion(cx.is_reduced_motion())
        .build(&k);
    crate::bar::view(s, &k, &mut layer);
    rune_kit::root(body, layer)
}

// ── the sidebar: the outline's tree ───────────────────────────────────────────────────────────────────────────

fn tree_row(s: &App, line: &TreeLine, k: &Kit) -> El {
    let r = &line.row;
    let open = s.unfolded.contains(&r.id);
    let icon = if !r.has_children { &DOT } else if open { &glyphs::TRIANGLE_DOWN } else { &glyphs::TRIANGLE_RIGHT };
    let pick = act(format!("tree.pick id={}", word(&r.id)));
    SidebarRow::new(if r.title.is_empty() { "untitled".to_string() } else { r.title.clone() })
        .icon(icon)
        .height(ROW)
        .depth(line.depth.min(12) as u8)
        .selected(s.subject().as_deref() == Some(r.id.as_str()))
        .on_select(move |s: &mut App, _| pick(s))
        .build(k)
        .key(format!("tree/{}", r.id))
}

/// A row of the sidebar's head that runs an act line: its label and keycap are the action's.
fn head_row(line: &'static str, icon: &'static Icon, key: &'static str, k: &Kit) -> El {
    let run = act(line);
    let row = SidebarRow::new(actions::label(line)).icon(icon).height(ROW).on_select(move |s: &mut App, _| run(s));
    match keys::cap(line) { Some(cap) => row.detail(cap), None => row }.build(k).key(key)
}

fn sidebar(s: &App, k: &Kit) -> El {
    let c = &k.c;
    let mut header = col()
        .w_full()
        .px(8.0)
        .py(6.0)
        .gap(1.0)
        .child(text(s.at.outline.clone()).key("outline-name").font(k.ty.body_medium).color(c.text_base).truncate())
        .child(text(if s.online { format!("on {}", if s.machine.is_empty() { "…" } else { &s.machine }) } else { "offline".to_string() }).font(k.ty.small).color(if s.online { c.text_faint } else { c.danger.fg }).truncate());
    // What an agent last did here, said where the person sees it.
    if let Some(said) = &s.agent_said { header = header.child(text(said.clone()).key("status").font(k.ty.small).color(c.text_muted).wrap()) }
    let tree = Rc::new(s.tree());
    let (keyed, built, kit) = (tree.clone(), tree.clone(), k.clone());
    let head = Sidebar::new()
        .label("Outline")
        .header(header)
        .header(head_row("bar.open", &glyphs::SEARCH, "find", k))
        .header(head_row("bar.open scope=query", &FILTER, "query", k))
        .header(head_row("note.new", &PLUS, "new", k));
    list::in_sidebar(head, Rows::new(tree.len(), ROW, move |_: &App, i: usize| Cow::Owned(format!("tree/{}", keyed[i].row.id)), move |s: &App, i: usize| tree_row(s, &built[i], &kit))).build(k)
}

// ── the toolbar ───────────────────────────────────────────────────────────────────────────────────────────────

fn toolbar(s: &App, k: &Kit) -> Toolbar {
    let title = s.shown().map_or(String::new(), |p| p.title.clone());
    let mut back = IconButton::new(&BACK).variant(IconButtonVariant::GhostMuted).label(actions::label("back")).disabled(s.back.is_empty()).on_press(act("back"));
    if let Some(cap) = keys::cap("back") { back = back.shortcut(cap) }
    let mut actions = row().gap(6.0).center_y();
    if s.editing.is_some() {
        let (saving, unsaved) = (s.saving(), s.unsaved());
        // Leaving is its own act: Done when everything is saved, Discard (by name) when it isn't.
        actions = actions
            .child(if unsaved { button("edit.close discard=true", ButtonVariant::Ghost).build(k).key("discard") } else { button("edit.close", ButtonVariant::Ghost).build(k).key("done") })
            .child(button("edit.save", ButtonVariant::Contrast).disabled(saving || !unsaved).build(k).key("save"));
    } else if s.page().is_some() {
        actions = actions.child(button("edit", ButtonVariant::Neutral).build(k).key("edit"));
    }
    actions = actions.child(
        IconButton::new(&rune_kit::shell::INSPECTOR)
            .variant(IconButtonVariant::GhostMuted)
            .expanded(s.inspector.is_open())
            .label(crate::actions::label("dock.toggle side=right"))
            .on_press(act("dock.toggle side=right"))
            .build(k)
            .key("inspector-toggle"),
    );
    Toolbar::new().leading(back.build(k).key("back")).title(title).trailing(actions)
}

// ── the note ──────────────────────────────────────────────────────────────────────────────────────────────────

fn notice(s: &App, k: &Kit) -> Option<El> {
    let notice = s.notice.as_ref()?;
    let colors = match notice.tone { Tone::Info => &k.c.info, Tone::Problem => &k.c.danger };
    let mut bar = row().key("notice").w_full().px(12.0).py(8.0).gap(10.0).radius(k.radius.md).fill(colors.bg).border(1.0, colors.border).center_y()
        .child(text(notice.said.clone()).font(k.ty.small).color(colors.fg).wrap().grow(1.0));
    // What it did can be taken back: the notice carries the act line that does.
    if let Some(undo) = &notice.undo { bar = bar.child(button(undo, ButtonVariant::Ghost).build(k).key("notice-undo")) }
    Some(bar.child(IconButton::new(&glyphs::CLOSE).variant(IconButtonVariant::GhostMuted).label(actions::label("notice.dismiss")).on_press(act("notice.dismiss")).build(k).key("notice-close")))
}

fn chips(page: &Page, k: &Kit) -> El {
    page.chips.iter().fold(row().key("chips").gap(6.0).flex_wrap(), |r, chip| {
        r.child(
            k.interactive(Badge::new(format!("{} · {}", chip.key, chip.value)).variant(BadgeVariant::Subtle).standard().build(k))
                .key(format!("chip/{}/{}", chip.key, chip.value))
                .help(format!("Notes with {}={}", chip.key, chip.value))
                // A chip is a query: every note that carries it.
                .on_press(act(format!("bar.narrow key={} value={}", word(&chip.key), word(&chip.value)))),
        )
    })
}

/// A note in a list (a child, a backlink, an ancestor): press to open.
fn link_row(r: &NoteRow, scope: &str, k: &Kit) -> El {
    page_row(if r.title.is_empty() { "untitled" } else { &r.title }, Some(&r.id), Vec::new(), (!r.context.is_empty()).then_some(r.context.as_str()), format!("{scope}/{}", r.id), k)
}

fn section(title: &str, k: &Kit) -> El { text(title.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint) }

fn prose(markdown: &str, k: &Kit) -> El {
    Markdown::new(markdown).selectable(true).tasks_read_only().on_link_tx(|s: &mut App, href: &str, _| { s.act(&format!("link.follow ref={}", word(href)), Actor::Person); }).build(k)
}

/// A row that opens a note when it names one, and is plain words when it doesn't.
fn page_row(text: &str, id: Option<&str>, trailing: Vec<String>, quiet: Option<&str>, key: String, k: &Kit) -> El {
    let c = &k.c;
    let mut line = row().w_full().gap(8.0).center_y().child(text_el(text, k.ty.ui, if id.is_some() { c.text_base } else { c.text_muted }).truncate().grow(1.0));
    for cell in trailing.into_iter().filter(|cell| !cell.is_empty()) { line = line.child(Badge::new(cell).variant(BadgeVariant::Subtle).build(k)) }
    if let Some(q) = quiet { line = line.child(text_el(q, k.ty.small, c.text_faint).truncate()) }
    let line = line.px(10.0).py(6.0).radius(k.radius.sm).key(key);
    match id {
        Some(id) => k.interactive(line).role("link").focusable(true).on_press(act(format!("open id={}", word(id)))),
        None => line,
    }
}

fn text_el(words: &str, font: TextStyle, color: rune::Color) -> El { text(words.to_string()).font(font).color(color) }

/// A `graph-stat` from its answered props: a tile per item, the number large over its label.
fn stat_tiles(props: &serde_json::Value, k: &Kit) -> Option<El> {
    let items = props.get("items")?.as_array()?;
    let words = |v: Option<&serde_json::Value>| match v { Some(serde_json::Value::String(s)) => s.clone(), Some(serde_json::Value::Null) | None => String::new(), Some(other) => other.to_string() };
    let tiles = items.iter().fold(row().w_full().gap(8.0).flex_wrap(), |tiles, item| {
        let accent = item.get("accent").and_then(serde_json::Value::as_bool).unwrap_or(false);
        tiles.child(
            col().min_w(120.0).grow(1.0).padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_02).border(1.0, if accent { k.c.border_focus } else { k.c.border_muted })
                .child(text(words(item.get("value"))).font(sized(k.ty.body_medium, 24.0, 30.0)).color(if accent { k.c.text_accent } else { k.c.text_base }))
                .child(text(words(item.get("label"))).font(k.ty.small).color(k.c.text_muted).wrap()),
        )
    });
    (!items.is_empty()).then_some(tiles)
}

/// A component as the service answered it. One it has no answer for, or this window no drawing for, shows as it was written: never hidden.
fn component(i: usize, part: &Part, k: &Kit) -> El {
    let c = &k.c;
    let (frame, body): (&Frame, Vec<El>) = match part {
        Part::Prose { .. } | Part::Picture { .. } => return el(),
        Part::Figure { frame, figure, props, markdown } => (frame, match (figure.as_str(), markdown) {
            ("stat", _) => vec![stat_tiles(props, k).unwrap_or_else(|| text_el(&frame.source, k.ty.mono, c.text_muted).wrap())],
            (_, Some(md)) => vec![prose(md, k)],
            _ => vec![text_el(&frame.source, k.ty.mono, c.text_muted).wrap()],
        }),
        Part::View { frame, view, truncated } => {
            let mut rows: Vec<El> = Vec::new();
            let headers = if view.headers.is_empty() { &view.columns } else { &view.headers };
            if !headers.is_empty() && !view.rows.is_empty() {
                rows.push(text_el(&headers.join(" · "), k.ty.text_xsmall_medium, c.text_faint).px(10.0));
            }
            rows.extend(view.rows.iter().map(|r| page_row(&r.label, Some(&r.id), r.cells.iter().map(ListRow::cell).collect(), r.detail.as_deref(), format!("part/{i}/{}", r.id), k)));
            if view.rows.is_empty() { rows.push(text_el("No notes match.", k.ty.small, c.text_faint)) }
            if *truncated { rows.push(text_el("More match than are shown: open the query for all of them.", k.ty.small, c.text_faint)) }
            (frame, rows)
        }
        Part::Rows { frame, groups } => {
            let mut rows: Vec<El> = Vec::new();
            for (g, group) in groups.iter().enumerate() {
                if groups.len() > 1 { rows.push(section(&group.name, k).px(10.0)) }
                if group.rows.is_empty() { rows.push(text_el(group.empty.as_deref().unwrap_or("nothing here yet"), k.ty.small, c.text_faint).px(10.0)) }
                rows.extend(group.rows.iter().enumerate().map(|(n, r)| {
                    let key = r.id.as_ref().map_or(format!("part/{i}/{g}/{n}"), |id| format!("part/{i}/{id}"));
                    page_row(&r.text, r.id.as_deref(), Vec::new(), r.note.as_deref(), key, k)
                }));
            }
            (frame, rows)
        }
        Part::Component { frame } => (frame, vec![text_el(&frame.source, k.ty.mono, c.text_muted).wrap()]),
    };
    let mut head = row().w_full().gap(8.0).center_y().child(Badge::new(frame.name.clone()).variant(BadgeVariant::Accent).build(k));
    if let Some(t) = &frame.title { head = head.child(text_el(t, k.ty.ui_medium, c.text_base)) }
    head = head.child(el().grow(1.0));
    if let Some(q) = &frame.query {
        head = head.child(
            k.interactive(text_el(q, k.ty.mono, c.text_muted).truncate())
                .key(format!("part/{i}/query"))
                .help("Open this query")
                .on_press(act(format!("bar.open scope=query query={}", word(q)))),
        );
    } else if let Some(status) = &frame.status {
        head = head.child(text_el(status, k.ty.small, c.text_faint));
    }
    let mut card = col().key(format!("part/{i}")).w_full().padding(12.0).gap(6.0).radius(k.radius.md).fill(c.layer_01).border(1.0, c.border_muted).child(head);
    // The service's words on what is wrong, with whatever it could still answer under them.
    if let Some(e) = &frame.error { card = card.child(text_el(e, k.ty.small, c.danger.fg).wrap()) }
    body.into_iter().fold(card, |card, part| card.child(part))
}

/// What stands where a picture will be, or would have been: its alt text and why it isn't drawn.
fn no_picture(picture: &Picture, why: &str, key: &str, k: &Kit) -> El {
    let name = picture.alt.clone().or_else(|| picture.path.clone()).unwrap_or_else(|| "picture".into());
    col().key(key.to_string()).w_full().padding(12.0).gap(2.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_muted)
        .child(text_el(&name, k.ty.ui, k.c.text_muted))
        .child(text_el(why, k.ty.small, k.c.text_faint).wrap())
}

/// A picture where it stands: at its own size up to the reading measure (`full`: the width there is), or the height the note gives it.
fn picture(s: &App, picture: &Picture, key: String, k: &Kit) -> El {
    let (image, points) = match s.picture(picture) {
        Some(Shown::Ready { image, points }) => (image, *points),
        Some(Shown::Failed(why)) => return no_picture(picture, why, &key, k),
        Some(Shown::Asked) | None => return no_picture(picture, "on its way…", &key, k),
    };
    let Some([width, _]) = image.size() else {
        return match image.error() { Some(e) => no_picture(picture, &format!("{e:?}"), &key, k), None => no_picture(picture, "decoding…", &key, k) };
    };
    let mut drawn = el().key(key).role("image").label(picture.alt.clone().unwrap_or_else(|| "Picture".into())).w_full().radius(6.0);
    drawn = match picture.height {
        // The note says how tall: the picture is shown whole inside that band.
        Some(rows) => drawn.h(rows * ROW_POINTS).pixels_fit(image.pixels(), SurfaceFit::Fit),
        None => drawn.pixels(image.pixels()),
    };
    if picture.width != "full" && picture.height.is_none() { drawn = drawn.max_w(width as f32 / points) }
    let mut body = col().w_full().gap(4.0).child(drawn);
    // What's written on its line that isn't a layout value is said under it, as the door's caption does.
    for problem in &picture.problems { body = body.child(text_el(problem, k.ty.small, k.c.warning.fg).wrap()) }
    body
}

/// The note's header image: a band above the title, cropped to fill it (`contain`: shown whole), dimmed as the note asks.
fn hero(s: &App, picture: &Picture, k: &Kit) -> Option<El> {
    let Some(Shown::Ready { image, .. }) = s.picture(picture) else { return None };
    image.size()?;
    let fit = if picture.fit.as_deref() == Some("contain") { SurfaceFit::Fit } else { SurfaceFit::Fill };
    let band = el().key("hero").role("image").label(picture.alt.clone().unwrap_or_else(|| "Header image".into())).w_full()
        .h(picture.height.map_or(HERO_POINTS, |rows| rows * ROW_POINTS)).radius(10.0).pixels_fit(image.pixels(), fit);
    Some(match picture.dim.filter(|dim| *dim > 0.0) {
        Some(dim) => band.child(el().w_full().h_full().radius(10.0).fill(k.alpha(k.c.black, dim.min(1.0)))),
        None => band,
    })
}

fn note(s: &App, page: &Page, k: &Kit) -> El {
    let c = &k.c;
    let mut body = col().key("note").w_full().max_w(820.0).padding(28.0).gap(14.0);
    if let Some(n) = notice(s, k) { body = body.child(n) }
    if let Some(band) = page.hero.as_ref().and_then(|picture| hero(s, picture, k)) { body = body.child(band) }
    if !page.ancestors.is_empty() {
        let path = page.ancestors.iter().map(|a| a.title.as_str()).collect::<Vec<_>>().join(" › ");
        body = body.child(text(path).key("path").font(k.ty.small).color(c.text_faint).truncate());
    }
    body = body.child(text(page.title.clone()).key("note-title").font(sized(k.ty.body_medium, 26.0, 32.0)).color(c.text_base).wrap().selectable(true));
    if !page.chips.is_empty() { body = body.child(chips(page, k)) }
    for (i, part) in page.parts.iter().enumerate() {
        body = body.child(match part {
            Part::Prose { markdown } => prose(markdown, k).key(format!("part/{i}")),
            Part::Picture { picture: shown } => picture(s, shown, format!("part/{i}"), k),
            part => component(i, part, k),
        });
    }
    if !page.children.is_empty() {
        body = body.child(el().h(6.0)).child(section(&format!("Under this note · {}", page.children.len()), k));
        body = page.children.iter().fold(body, |b, r| b.child(link_row(r, "child", k)));
    }
    // The open note's page is on its way: the last one stays, dimmed, so the window never blanks.
    let opacity = if s.loading() { 0.55 } else { 1.0 };
    k.scroll_bar(col().key("note-scroll").w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(row().w_full().justify_center().child(body.opacity(opacity))))
}

fn empty(s: &App, k: &Kit) -> El {
    let cap = |line: &str| keys::cap(line).unwrap_or_else(|| actions::label(line));
    let said = if s.loading() { "Calling the outline…".to_string() } else if s.tree().is_empty() { format!("Nothing here yet. {} starts a note.", cap("note.new")) } else { format!("Pick a note on the left, or find one with {}.", cap("bar.open")) };
    let mut body = col().key("empty").w_full().h_full().center().gap(12.0).padding(28.0);
    if let Some(n) = notice(s, k) { body = body.child(col().max_w(560.0).child(n)) }
    body.child(text(said).font(k.ty.body).color(k.c.text_muted))
}

/// The note's Blockdown source in one text area: what was read is what a save sends back.
fn editor(s: &App, k: &Kit) -> El {
    let mut body = col().key("editor").w_full().h_full().min_h(0.0).padding(20.0).gap(12.0);
    if let Some(n) = notice(s, k) { body = body.child(n) }
    // What the editor's own keys do, from the table: the save that keeps you here, the Esc that leaves.
    let keys = keys::bind_of("edit.save").map(|bind| (bind.cap(), bind.does)).into_iter().chain(keys::hints(Layer::Draft)).fold(row().key("editor-keys").w_full().gap(12.0).flex_wrap(), |line, (cap, does)| {
        line.child(row().gap(4.0).center_y().child(Keybind::new(&[cap.as_str()]).build(k)).child(text(does).font(k.ty.small).color(k.c.text_faint)))
    });
    body.child(
        k.scroll_bar(
            col().key("editor-scroll").w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(
                keys::area(&s.editor, Field::Draft)
                    .label("Note source")
                    .placeholder("Title [key::value]\nThen the note, in Blockdown.")
                    .width(None)
                    .auto_grow(16, 4000)
                    .build(k)
                    .key("source"),
            ),
        ),
    )
    .child(keys)
}

// ── the inspector: what the service knows about the open note ─────────────────────────────────────────────────

fn inspector(s: &App, k: &Kit) -> El {
    let c = &k.c;
    let Some(page) = s.shown() else { return col().key("details").w_full().padding(16.0).child(section("Details", k)) };
    let field = |label: &str, value: String| col().gap(2.0).child(text(label.to_owned()).font(k.ty.small).color(c.text_faint)).child(text(value).font(k.ty.ui).color(c.text_base).wrap().selectable(true));
    let mut body = col().key("details").w_full().padding(16.0).gap(12.0).child(section("Properties", k));
    if page.properties.is_empty() { body = body.child(text("None.").font(k.ty.small).color(c.text_faint)) }
    body = page.properties.iter().fold(body, |b, chip| b.child(field(&chip.key, chip.value.clone())));
    body = body.child(el().h(4.0)).child(section(&format!("Linked from · {}", page.backlinks.len()), k));
    if page.backlinks.is_empty() { body = body.child(text("No note links here.").font(k.ty.small).color(c.text_faint)) }
    body = page.backlinks.iter().fold(body, |b, r| b.child(link_row(r, "backlink", k)));
    body = body
        .child(el().h(4.0))
        .child(section("Record", k))
        .child(field("Revision", page.revision.to_string()))
        .child(field("Updated", when(&page.updated)))
        .child(field("By", page.author.clone()))
        .child(field("Id", page.id.clone()));
    k.scroll_bar(col().key("details-scroll").w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(body))
}

/// An ISO time as a person reads it: the day and the minute.
fn when(iso: &str) -> String { iso.get(..16).map_or(iso.to_string(), |minute| minute.replace('T', " ")) }
