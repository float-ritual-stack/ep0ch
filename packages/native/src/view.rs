//! The window, drawn from rune-kit's parts: the shell's split view (a sidebar of the outline's tree, the open note,
//! an inspector), Markdown for prose, and a dialog for finding. Nothing here reads Blockdown: prose arrives as
//! Markdown and components as rows.
use std::borrow::Cow;

use rune::{Cx, El, Icon, Key, KeyEvent, ScrollSpec, TextStyle, Tx, col, el, row, text};
use rune_kit::shell::{Sidebar, SidebarRow, SplitView, Toolbar};
use rune_kit::{Badge, BadgeVariant, Button, ButtonVariant, Dialog, IconButton, IconButtonVariant, Kit, Markdown, TextArea, TextInput, glyphs};

use crate::model::{App, Finder, Frame, ListRow, Page, Part, Row, Tone};

static PLUS: Icon = Icon { name: "ep0ch-plus", view: 16.0, body: r#"<path d="M8 3.5V12.5M3.5 8H12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"# };
static BACK: Icon = Icon { name: "ep0ch-back", view: 16.0, body: r#"<path d="M9.5 3.5L5 8L9.5 12.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>"# };
static FILTER: Icon = Icon { name: "ep0ch-filter", view: 16.0, body: r#"<path d="M3 4.5H13M5 8H11M7 11.5H9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>"# };
static DOT: Icon = Icon { name: "ep0ch-dot", view: 16.0, body: r#"<circle cx="8" cy="8" r="1.6" fill="currentColor"/>"# };

const ROW: f32 = 28.0;

fn sized(base: TextStyle, size: f32, line: f32) -> TextStyle { TextStyle { size, line_height: line, ..base } }

pub fn view(s: &App, cx: &mut Cx<App>) -> El {
    let k = Kit::neutral(cx.system_dark());
    let mut layer = Vec::new();
    let main = match (&s.draft, &s.page) {
        (Some(_), _) => editor(s, &k),
        (None, Some(page)) => note(s, page, &k),
        (None, None) => empty(s, &k),
    };
    let body = SplitView::new(main)
        .sidebar(&s.sidebar, |s: &mut App| &mut s.sidebar, sidebar(s, &k))
        .inspector(&s.inspector, |s: &mut App| &mut s.inspector, inspector(s, &k))
        .toolbar(toolbar(s, &k))
        .titlebar_inset(cx.titlebar_inset())
        .frame_inset(8.0)
        .toolbar_in_panel()
        .reduced_motion(cx.is_reduced_motion())
        .build(&k);
    if s.palette.is_some() { palette(s, &k, &mut layer) }
    rune_kit::root(body, layer)
}

// ── the sidebar: the outline's tree ───────────────────────────────────────────────────────────────────────────

fn tree_row(s: &App, i: usize, k: &Kit) -> El {
    let r = &s.tree[s.visible[i]];
    let open = s.expanded.contains(&r.id);
    let icon = if !r.has_children { &DOT } else if open { &glyphs::TRIANGLE_DOWN } else { &glyphs::TRIANGLE_RIGHT };
    let id = r.id.clone();
    let toggles = r.has_children;
    SidebarRow::new(r.title.clone())
        .icon(icon)
        .height(ROW)
        .depth(r.depth.min(12) as u8)
        .selected(s.selected.as_deref() == Some(r.id.as_str()))
        .on_select({
            let id = id.clone();
            move |s: &mut App, _| {
                // A press opens the note; on the open note it folds or unfolds its children.
                if s.selected.as_deref() == Some(id.as_str()) { if toggles { s.toggle(&id) } } else { s.open(&id); if toggles && !s.expanded.contains(&id) { s.toggle(&id) } }
            }
        })
        .build(k)
        .key(format!("tree/{}", r.id))
}

fn sidebar(s: &App, k: &Kit) -> El {
    let c = &k.c;
    let place = if s.outline.is_empty() { "ep0ch".to_string() } else { s.outline.clone() };
    let header = col()
        .w_full()
        .px(8.0)
        .py(6.0)
        .gap(1.0)
        .child(text(place).key("outline-name").font(k.ty.body_medium).color(c.text_base).truncate())
        .child(text(if s.online { format!("on {}", if s.machine.is_empty() { "…" } else { &s.machine }) } else { "offline".to_string() }).font(k.ty.small).color(if s.online { c.text_faint } else { c.danger.fg }).truncate());
    let kit = k.clone();
    Sidebar::new()
        .label("Outline")
        .header(header)
        .header(SidebarRow::new("Find").icon(&glyphs::SEARCH).detail("⌘K").height(ROW).on_select(|s: &mut App, _| s.find(Finder::Find, "")).build(k).key("find"))
        .header(SidebarRow::new("Query").icon(&FILTER).detail("⌘L").height(ROW).on_select(|s: &mut App, _| s.find(Finder::Query, "")).build(k).key("query"))
        .header(SidebarRow::new("New note").icon(&PLUS).detail("⌘N").height(ROW).on_select(|s: &mut App, _| s.new_child()).build(k).key("new"))
        .row_height(ROW)
        .virtual_rows(s.visible.len(), |s: &App, i| Cow::Owned(format!("tree/{}", s.tree[s.visible[i]].id)), move |s: &App, i| tree_row(s, i, &kit))
        .build(k)
}

// ── the toolbar ───────────────────────────────────────────────────────────────────────────────────────────────

fn toolbar(s: &App, k: &Kit) -> Toolbar {
    let title = s.page.as_ref().map_or(String::new(), |p| p.title.clone());
    let back = IconButton::new(&BACK).variant(IconButtonVariant::GhostMuted).label("Back").shortcut("⌘[").disabled(s.back.is_empty()).on_press(|s: &mut App| s.go_back()).build(k).key("back");
    let mut actions = row().gap(6.0).center_y();
    if let Some(d) = &s.draft {
        actions = actions
            .child(Button::new("Cancel").variant(ButtonVariant::Ghost).shortcut("Esc").on_press(|s: &mut App| s.cancel_edit()).build(k).key("cancel"))
            .child(Button::new(if d.saving { "Saving…" } else { "Save" }).variant(ButtonVariant::Contrast).shortcut("⌘S").disabled(d.saving).on_press(|s: &mut App| s.save()).build(k).key("save"));
    } else if s.page.is_some() {
        actions = actions.child(Button::new("Edit").variant(ButtonVariant::Neutral).shortcut("⌘E").on_press(|s: &mut App| s.edit()).build(k).key("edit"));
    }
    actions = actions.child(
        IconButton::new(&rune_kit::shell::INSPECTOR)
            .variant(IconButtonVariant::GhostMuted)
            .expanded(s.inspector.is_open())
            .label(if s.inspector.is_open() { "Hide details" } else { "Show details" })
            .on_press(|s: &mut App| s.inspector.toggle())
            .build(k)
            .key("inspector-toggle"),
    );
    Toolbar::new().leading(back).title(title).trailing(actions)
}

// ── the note ──────────────────────────────────────────────────────────────────────────────────────────────────

fn notice(s: &App, k: &Kit) -> Option<El> {
    let (tone, said) = s.notice.as_ref()?;
    let colors = if *tone == Tone::Problem { &k.c.danger } else { &k.c.info };
    let mut bar = row().key("notice").w_full().px(12.0).py(8.0).gap(10.0).radius(k.radius.md).fill(colors.bg).border(1.0, colors.border).center_y()
        .child(text(said.clone()).font(k.ty.small).color(colors.fg).wrap().grow(1.0));
    if s.trashed.is_some() && said.starts_with("Moved to the Trash") {
        bar = bar.child(Button::new("Undo").variant(ButtonVariant::Ghost).on_press(|s: &mut App| s.restore()).build(k).key("undo-trash"));
    }
    Some(bar.child(IconButton::new(&glyphs::CLOSE).variant(IconButtonVariant::GhostMuted).label("Dismiss").on_press(|s: &mut App| s.notice = None).build(k).key("notice-close")))
}

fn chips(page: &Page, k: &Kit) -> El {
    page.chips.iter().fold(row().key("chips").gap(6.0).flex_wrap(), |r, chip| {
        let term = (chip.key.clone(), chip.value.clone());
        r.child(
            k.interactive(Badge::new(format!("{} · {}", chip.key, chip.value)).variant(BadgeVariant::Subtle).standard().build(k))
                .key(format!("chip/{}/{}", chip.key, chip.value))
                .help(format!("Notes with {}={}", chip.key, chip.value))
                .on_press(move |s: &mut App| {
                    // A chip is a query: every note that carries it.
                    s.find(Finder::Query, "");
                    s.narrow(&term.0, &term.1);
                }),
        )
    })
}

/// A note in a list (a child, a query's row, a backlink): press to open.
fn link_row(r: &Row, columns: &[String], scope: &str, k: &Kit) -> El {
    let c = &k.c;
    let id = r.id.clone();
    let mut line = row().w_full().gap(8.0).center_y().child(text(r.title.clone()).font(k.ty.ui).color(c.text_base).truncate().grow(1.0));
    for key in columns {
        if let Some(v) = r.props.get(key) { line = line.child(Badge::new(v.clone()).variant(BadgeVariant::Subtle).build(k)) }
    }
    if columns.is_empty() && !r.context.is_empty() { line = line.child(text(r.context.clone()).font(k.ty.small).color(c.text_faint).truncate()) }
    k.interactive(line.px(10.0).py(6.0).radius(k.radius.sm))
        .key(format!("{scope}/{}", r.id))
        .role("link")
        .focusable(true)
        .on_press(move |s: &mut App| s.open(&id))
}

fn section(title: &str, k: &Kit) -> El { text(title.to_uppercase()).font(k.ty.text_xsmall_medium).color(k.c.text_faint) }

fn prose(markdown: &str, k: &Kit) -> El {
    Markdown::new(markdown).selectable(true).tasks_read_only().on_link_tx(|s: &mut App, href: &str, _| s.follow(href)).build(k)
}

/// A row that opens a note when it names one, and is plain words when it doesn't.
fn page_row(text: &str, id: Option<&str>, trailing: Vec<String>, quiet: Option<&str>, key: String, k: &Kit) -> El {
    let c = &k.c;
    let mut line = row().w_full().gap(8.0).center_y().child(text_el(text, k.ty.ui, if id.is_some() { c.text_base } else { c.text_muted }).truncate().grow(1.0));
    for cell in trailing.into_iter().filter(|cell| !cell.is_empty()) { line = line.child(Badge::new(cell).variant(BadgeVariant::Subtle).build(k)) }
    if let Some(q) = quiet { line = line.child(text_el(q, k.ty.small, c.text_faint).truncate()) }
    let line = line.px(10.0).py(6.0).radius(k.radius.sm).key(key);
    match id {
        Some(id) => {
            let id = id.to_string();
            k.interactive(line).role("link").focusable(true).on_press(move |s: &mut App| s.open(&id))
        }
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
        Part::Prose { .. } => return el(),
        Part::Figure { frame, figure, props, markdown } => (frame, match (figure.as_str(), markdown) {
            ("stat", _) if stat_tiles(props, k).is_some() => vec![stat_tiles(props, k).unwrap_or_else(el)],
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
        let q2 = q.clone();
        head = head.child(
            k.interactive(text_el(q, k.ty.mono, c.text_muted).truncate())
                .key(format!("part/{i}/query"))
                .help("Open this query")
                .on_press(move |s: &mut App| s.find(Finder::Query, &q2)),
        );
    } else if let Some(status) = &frame.status {
        head = head.child(text_el(status, k.ty.small, c.text_faint));
    }
    let mut card = col().key(format!("part/{i}")).w_full().padding(12.0).gap(6.0).radius(k.radius.md).fill(c.layer_01).border(1.0, c.border_muted).child(head);
    // The service's words on what is wrong, with whatever it could still answer under them.
    if let Some(e) = &frame.error { card = card.child(text_el(e, k.ty.small, c.danger.fg).wrap()) }
    body.into_iter().fold(card, |card, part| card.child(part))
}

fn note(s: &App, page: &Page, k: &Kit) -> El {
    let c = &k.c;
    let mut body = col().key("note").w_full().max_w(820.0).padding(28.0).gap(14.0);
    if let Some(n) = notice(s, k) { body = body.child(n) }
    if !page.path.is_empty() { body = body.child(text(page.path.clone()).key("path").font(k.ty.small).color(c.text_faint).truncate()) }
    body = body.child(text(page.title.clone()).key("note-title").font(sized(k.ty.body_medium, 26.0, 32.0)).color(c.text_base).wrap().selectable(true));
    if !page.chips.is_empty() { body = body.child(chips(page, k)) }
    for (i, part) in page.parts.iter().enumerate() {
        body = body.child(match part { Part::Prose { markdown } => prose(markdown, k).key(format!("part/{i}")), part => component(i, part, k) });
    }
    if !page.children.is_empty() {
        body = body.child(el().h(6.0)).child(section(&format!("Under this note · {}", page.children.len()), k));
        body = page.children.iter().fold(body, |b, r| b.child(link_row(r, &[], "child", k)));
    }
    let opacity = if s.loading { 0.55 } else { 1.0 };
    k.scroll_bar(col().key("note-scroll").w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(row().w_full().justify_center().child(body.opacity(opacity))))
}

fn empty(s: &App, k: &Kit) -> El {
    let said = if s.loading { "Calling the outline…".to_string() } else if s.tree.is_empty() { "Nothing here yet. ⌘N starts a note.".to_string() } else { "Pick a note on the left, or find one with ⌘K.".to_string() };
    let mut body = col().key("empty").w_full().h_full().center().gap(12.0).padding(28.0);
    if let Some(n) = notice(s, k) { body = body.child(col().max_w(560.0).child(n)) }
    body.child(text(said).font(k.ty.body).color(k.c.text_muted))
}

/// The note's Blockdown source in one text area: what was read is what a save sends back.
fn editor(s: &App, k: &Kit) -> El {
    let Some(d) = &s.draft else { return el() };
    let mut body = col().key("editor").w_full().h_full().min_h(0.0).padding(20.0).gap(12.0);
    if let Some(n) = notice(s, k) { body = body.child(n) }
    body.child(
        k.scroll_bar(
            col().key("editor-scroll").w_full().grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(
                TextArea::new(&d.edit)
                    .label("Note source")
                    .placeholder("Title [key::value]\nThen the note, in Blockdown.")
                    .width(None)
                    .auto_grow(16, 4000)
                    .on_edit(|s: &mut App| match &mut s.draft { Some(d) => &mut d.edit, None => &mut s.sink })
                    .on_key(|s: &mut App, e: &KeyEvent, _| match &e.key {
                        Key::Escape => { s.cancel_edit(); true }
                        Key::Command('s') => { s.save(); true }
                        Key::Enter if e.mods.cmd => { s.save(); true }
                        _ => false,
                    })
                    .build(k)
                    .key("source"),
            ),
        ),
    )
    .child(text("Blockdown source · ⌘S saves · Esc cancels").font(k.ty.small).color(k.c.text_faint))
}

// ── the inspector: what the service knows about the open note ─────────────────────────────────────────────────

fn inspector(s: &App, k: &Kit) -> El {
    let c = &k.c;
    let Some(page) = &s.page else { return col().key("details").w_full().padding(16.0).child(section("Details", k)) };
    let field = |label: &str, value: String| col().gap(2.0).child(text(label.to_owned()).font(k.ty.small).color(c.text_faint)).child(text(value).font(k.ty.ui).color(c.text_base).wrap().selectable(true));
    let mut body = col().key("details").w_full().padding(16.0).gap(12.0).child(section("Properties", k));
    if page.properties.is_empty() { body = body.child(text("None.").font(k.ty.small).color(c.text_faint)) }
    body = page.properties.iter().fold(body, |b, chip| b.child(field(&chip.key, chip.value.clone())));
    body = body.child(el().h(4.0)).child(section(&format!("Linked from · {}", page.backlinks.len()), k));
    if page.backlinks.is_empty() { body = body.child(text("No note links here.").font(k.ty.small).color(c.text_faint)) }
    body = page.backlinks.iter().fold(body, |b, r| b.child(link_row(r, &[], "backlink", k)));
    body = body
        .child(el().h(4.0))
        .child(section("Record", k))
        .child(field("Revision", page.revision.to_string()))
        .child(field("Updated", page.updated.replace('T', " ").trim_end_matches('Z').to_string()))
        .child(field("By", page.author.clone()))
        .child(field("Id", page.id.clone()));
    k.scroll_bar(col().key("details-scroll").w_full().h_full().min_h(0.0).scroll(ScrollSpec { stick_bottom: false }).child(body))
}

// ── finding: words, or the views' grammar ─────────────────────────────────────────────────────────────────────

fn palette(s: &App, k: &Kit, layer: &mut Vec<El>) {
    let Some(p) = &s.palette else { return };
    let c = &k.c;
    let (title, placeholder) = match p.kind {
        Finder::Find => ("Find a note", "Words in a title or a note"),
        Finder::Query => ("Query", "type=letter mail=waiting · any property, as views read it"),
    };
    let field = TextInput::new(&p.edit)
        .label(title)
        .placeholder(placeholder)
        .leading_icon(if p.kind == Finder::Find { &glyphs::SEARCH } else { &FILTER })
        .width(None)
        .on_edit(|s: &mut App| match &mut s.palette { Some(p) => &mut p.edit, None => &mut s.sink })
        .on_change(|s: &mut App, _| s.find_changed())
        .on_key(|s: &mut App, e: &KeyEvent, tx: &mut Tx| match &e.key {
            Key::Down => { s.find_move(1); reveal(s, tx); true }
            Key::Up => { s.find_move(-1); reveal(s, tx); true }
            Key::Enter => { s.find_open(); true }
            Key::Escape => { s.palette = None; true }
            _ => false,
        })
        .build(k)
        .key("palette-field");
    let mut body = col().w_full().px(16.0).pb(16.0).gap(10.0).child(field);
    if !p.facets.is_empty() {
        // The facets the matches carry, counted by the service: each value narrows the query.
        let mut strip = row().key("facets").w_full().gap(6.0).flex_wrap();
        for f in p.facets.iter().take(6) {
            for v in f.values.iter().take(4) {
                let (key, value) = (f.key.clone(), v.value.clone());
                strip = strip.child(
                    k.interactive(Badge::new(format!("{}={} · {}", f.key, v.value, v.count)).variant(BadgeVariant::Subtle).build(k))
                        .key(format!("facet/{}/{}", f.key, v.value))
                        .on_press(move |s: &mut App| s.narrow(&key, &value)),
                );
            }
        }
        body = body.child(strip);
    }
    if !p.hint.is_empty() { body = body.child(text(p.hint.clone()).key("palette-hint").font(k.ty.small).color(c.warning.fg).wrap()) }
    let mut list = col().key("palette-rows").w_full().gap(1.0);
    for (i, r) in p.rows.iter().enumerate() {
        let id = r.id.clone();
        let detail = if r.context.is_empty() { r.snippet.lines().nth(1).unwrap_or("").to_string() } else { r.context.clone() };
        let line = col().w_full().gap(1.0)
            .child(text(r.title.clone()).font(k.ty.ui_medium).color(c.text_base).truncate())
            .child(text(detail).font(k.ty.small).color(c.text_faint).truncate());
        list = list.child(
            k.interactive(line.px(10.0).py(6.0).radius(k.radius.sm).fill(if i == p.cursor { c.surface_hover } else { rune::Color::TRANSPARENT }))
                .key(format!("found/{i}"))
                .role("option")
                .on_press(move |s: &mut App| s.open(&id)),
        );
    }
    if p.rows.is_empty() && p.hint.is_empty() {
        let said = if p.pending { "Asking…" } else if p.edit.text.trim().is_empty() && p.kind == Finder::Find { "Type to search. ↑ ↓ move, ⏎ opens, Esc closes." } else { "No notes match." };
        list = list.child(text(said).font(k.ty.small).color(c.text_faint).px(10.0).py(6.0));
    }
    body = body.child(k.scroll_bar(col().key("palette-scroll").w_full().h((p.rows.len().max(1) as f32 * 46.0).min(322.0)).scroll(ScrollSpec { stick_bottom: false }).child(list)));
    Dialog::new("palette", title).open(true).width(620.0).fit().child(body).on_close(|s: &mut App| s.palette = None).build(k, layer);
}

fn reveal(s: &App, tx: &mut Tx) {
    if let Some(p) = &s.palette { tx.scroll_into_view(format!("found/{}", p.cursor)) }
}
