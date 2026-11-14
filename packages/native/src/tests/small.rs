//! Wave H3, small things: what Evan met the first time he ran the window by hand. The status line lets an agent's
//! refusal go once it has been read; a refusal's notice goes when the person next acts; the toolbar starts past the
//! window's own buttons where they sit over it; a table's column header stays above its rows; a picture decoded is
//! kept across redraws; and an empty reader says what to do next.
use std::time::{Duration, Instant};

use super::support::*;
use crate::actions::{Actor, Tone, stays};

fn agent() -> Actor { Actor::Agent("seedling-agent".into()) }
/// What the elements keyed under `key` say.
fn says(rt: &rune::Runtime<crate::actions::App>, key: &str) -> Vec<String> { rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|k| k.starts_with(key))).filter_map(|e| e.text).collect() }

/// The run: an agent was refused while the person had the bar open, and the status line still said so minutes and
/// many acts later. What an agent did is news for as long as it takes to read (the door's rule for its status bar).
#[test]
fn what_an_agent_was_refused_leaves_the_status_line_once_it_has_been_read() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "bar.open").ok);
    let refused = g.app.act("screen.open name=desk", agent());
    assert!(!refused.ok, "{refused:?}");
    let said = g.app.agent_said.clone().expect("said on the status line");
    assert!(said.contains("screen.open refused"), "{said}");
    let start = Instant::now();
    // It is up while it can still be unread, and says when it wants looking at again.
    let (went, due) = g.app.fade(start);
    assert!(!went && due.is_some_and(|due| due <= stays(said.chars().count())), "{due:?}");
    let (went, _) = g.app.fade(start + stays(said.chars().count()) - Duration::from_millis(50));
    assert!(!went && g.app.agent_said.is_some());
    // Long enough to read, it goes, and nothing more is due.
    assert_eq!(g.app.fade(start + stays(said.chars().count())), (true, None));
    assert_eq!(g.app.agent_said, None);
    assert_eq!(g.app.fade(start + Duration::from_secs(600)), (false, None));
    // The same words said by another act are news again: their time starts over.
    assert!(!g.app.act("screen.open name=desk", agent()).ok);
    let again = start + Duration::from_secs(700);
    assert_eq!(g.app.fade(again).0, false);
    assert!(g.app.agent_said.is_some());
    assert_eq!(g.app.fade(again + Duration::from_secs(31)).0, true, "thirty seconds is the most anything takes to read");
}

/// Seen on the walk of this wave, in a window 1180 points wide on the desk: the toolbar's buttons leave the status
/// line a few words' room, and it was cut after the agent's name, the act and why it was refused unread, with no
/// way to read them before it went. The line says its whole words to a pointer that rests on it.
#[test]
fn a_status_line_the_toolbar_cuts_short_says_its_whole_words_on_a_hover() {
    let g = garden(ok());
    let mut rt = window(g.app);
    let (send, got) = std::sync::mpsc::channel();
    rt.update(move |s, _| { let refused = s.act("screen.open name=no-such-bench", agent()); let _ = send.send((refused.ok, s.agent_said.clone())); });
    rest(&mut rt);
    let (ok, said) = got.recv().unwrap();
    let said = said.expect("said on the status line");
    assert!(!ok && said.contains("screen.open refused"), "{said}");
    let line = rt.elements().into_iter().find(|e| e.key.as_deref() == Some("status")).expect("the status line is on the toolbar");
    assert_eq!(line.text.as_deref(), Some(said.as_str()));
    assert_eq!(line.help.as_deref(), Some(said.as_str()), "the whole of it, however little of it the toolbar has room for");
}

/// A refusal's notice answers what the person did then. Once it has been up long enough to read, their next act
/// puts it away; one that says something of its own leaves that in its place. The clock alone takes no notice away:
/// the window keeps no log to find it in.
#[test]
fn a_refusal_s_notice_goes_when_the_person_next_acts_and_never_before_it_can_be_read() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "open id=onions").ok && act(&mut g.app, "edit").ok);
    write(&mut g.app, "Thin the row to a hand apart");
    let refused = act(&mut g.app, "tile.close tile=reader");
    assert!(!refused.ok);
    let notice = |g: &Garden| g.app.notice.as_ref().map(|notice| (notice.tone, notice.said.clone()));
    assert_eq!(notice(&g), Some((Tone::Problem, refused.said.clone())));
    g.app.fade(Instant::now());
    // An act right after it (the press that focused the tile, a row lit) leaves it: nobody has read it yet.
    assert!(act(&mut g.app, "bar.open").ok && act(&mut g.app, "bar.close").ok);
    assert_eq!(notice(&g), Some((Tone::Problem, refused.said.clone())), "not gone before it can be read");
    // However long nobody acts, it stays.
    g.app.aged(Duration::from_secs(600));
    assert_eq!(g.app.fade(Instant::now()).0, false);
    assert_eq!(notice(&g), Some((Tone::Problem, refused.said.clone())));
    // An agent's act is not the person moving on.
    g.app.act("bar.open words=trash", agent());
    assert!(notice(&g).is_some());
    // The same refusal again is a notice of its own, and its time starts over.
    assert!(!act(&mut g.app, "tile.close tile=reader").ok);
    assert_eq!(notice(&g), Some((Tone::Problem, refused.said.clone())), "the act said the same words itself");
    g.app.fade(Instant::now());
    assert!(act(&mut g.app, "bar.open").ok && act(&mut g.app, "bar.close").ok);
    assert!(notice(&g).is_some(), "said again a moment ago");
    // Read, and the person does something else: it goes.
    g.app.aged(Duration::from_secs(31));
    assert!(act(&mut g.app, "bar.open").ok);
    assert_eq!(notice(&g), None);
    // What is no problem is the person's to put away (a trash's notice holds its Undo).
    assert!(act(&mut g.app, "bar.close").ok && act(&mut g.app, "edit.close discard=true").ok);
    assert!(act(&mut g.app, "note.trash").ok);
    g.app.take();
    assert_eq!(notice(&g).map(|(tone, _)| tone), Some(Tone::Info));
    g.app.fade(Instant::now());
    g.app.aged(Duration::from_secs(600));
    assert!(act(&mut g.app, "bar.open").ok);
    assert_eq!(notice(&g).map(|(tone, _)| tone), Some(Tone::Info));
}

/// The run, on a Mac: the outline's name was drawn under the window's red, yellow and green buttons. Where they sit
/// over the content Rune says how far they reach (`Cx::titlebar_inset`), and the toolbar starts past them. Run here
/// by telling the runtime the inset a Mac's window reports; on a Mac itself this was not run.
#[test]
fn the_toolbar_starts_past_the_window_s_own_buttons_where_they_sit_over_it() {
    let g = garden(ok());
    let mut rt = window(g.app);
    let name = |rt: &rune::Runtime<crate::actions::App>| rect_of(rt, "outline-name").expect("the outline's name is on the toolbar");
    // No buttons over the content (a titled window, full screen, every other platform): the toolbar's own room.
    let plain = name(&rt);
    assert_eq!(plain[0], 10.0);
    // A Mac's window with its content under the title bar: the buttons end 67 points in (7, three on a 23 point
    // pitch, the last 14 wide), and the name starts after them with room between.
    let buttons = rune::Chrome::DEFAULT.titlebar_inset();
    assert_eq!(buttons, 67.0);
    rt.set_titlebar_inset(buttons);
    rest(&mut rt);
    let past = name(&rt);
    assert!(past[0] >= buttons + 8.0, "the name starts at {} and the buttons end at {buttons}", past[0]);
    assert_eq!(past[1], plain[1], "on the same row");
    // The rest of the row keeps its place at the other end, and nothing is pushed off it.
    let width = rect_of(&rt, "toolbar").unwrap()[2];
    assert!(rt.elements().iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("tool/"))).all(|e| e.rect[0] + e.rect[2] <= width), "a button left the row");
    // Full screen takes the buttons off the content: the name is back at the edge.
    rt.set_titlebar_inset(0.0);
    rest(&mut rt);
    assert_eq!(name(&rt)[0], 10.0);
    // A window torn from this one has the same row over its tile (the outline's name, with no button of a screen's),
    // and its own buttons sit over that row as well: it starts past them too.
    let Garden { mut app, .. } = garden(ok());
    assert!(act(&mut app, "tile.tear tile=reader").ok);
    let mut torn = window(app.born().pop().expect("the act asked for a window"));
    assert_eq!(name(&torn)[0], 10.0);
    torn.set_titlebar_inset(buttons);
    rest(&mut torn);
    assert!(name(&torn)[0] >= buttons + 8.0, "a torn window's name starts at {} and its buttons end at {buttons}", name(&torn)[0]);
    // On this platform the frame asks for nothing over the content, so a headless render reports none either.
    assert_eq!(crate::shell::frame().titlebar_inset(), if cfg!(target_os = "macos") { 67.0 } else { 0.0 });
}

/// The run: the empty reader read as documentation for whoever writes a screen. It says what it is in its kind's own
/// words (the service's row, written for the person at the tile), and what to do next as a line an act: the button
/// its action's row labels, the key this window's table binds and what that key does, in the row's words.
#[test]
fn an_empty_reader_says_what_to_do_next_from_the_rows() {
    let g = garden_unopened(ok());
    let reader = g.app.kinds().iter().find(|row| row.serves.iter().any(|name| name == "reader")).expect("a kind serves reader").clone();
    let rt = window(g.app);
    assert_eq!(says(&rt, "tile/reader/empty/about"), vec![reader.about.clone()]);
    // No word of how a screen writes one: that is the extension's page to say.
    for author in ["note=", "mode=", "source=", "tile:", "<"] { assert!(!reader.about.contains(author), "the reader's description is for a person: {}", reader.about) }
    // Each way is its row's: the label, the key and what it does.
    for (part, line) in [("find", "bar.open"), ("new", "note.new")] {
        let bind = crate::keys::bind_of(line).expect("the table binds it");
        assert_eq!(says(&rt, &format!("tile/reader/empty/{part}/does")), vec![format!("{} · {}", bind.cap(), bind.does)], "{line}");
        assert!(rect_of(&rt, &format!("tile/reader/empty/{part}")).is_some());
    }
    // A list about a note nobody shows says what it waits for the same way, and offers nothing it can't do.
    let props = rt.state.kinds().iter().find(|row| row.serves.iter().any(|name| name == "props")).unwrap().clone();
    if rect_of(&rt, "tile/props/empty").is_some() { assert_eq!(says(&rt, "tile/props/empty/about"), vec![props.about.clone()]) }
    for kind in rt.state.kinds().iter().filter(|row| row.fields.get("subject").is_some()) { assert!(!kind.about.contains("source=tile"), "{}: {}", kind.kind, kind.about) }
}

/// The run: scrolled, the Properties tile's first row sat right under its column header's words, as if it slid
/// under them. The strip over a list tile (its title, its chips, a table's column header) stays put; a line under it
/// says where the rows go, and no row is drawn above that line however far the list is scrolled.
#[test]
fn a_list_tile_s_rows_scroll_under_a_line_below_its_column_header() {
    let mut g = garden(ok());
    assert!(act(&mut g.app, "open id=onions").ok);
    // A short window: the properties list is taller than its tile.
    let mut rt = rune::Runtime::new(g.app, crate::shell::view, (1180.0, 400.0), rune::Env { system_dark: true, scale: 1.0 });
    rt.poll = Some(|s, _, tx| { let landed = s.take() | s.ran(); crate::keys::effects(s, tx) | crate::keys::follow(s, tx) | landed });
    for _ in 0..4 { rt.frame(0.0); }
    rest(&mut rt);
    let (columns, edge, scroll) = (rect_of(&rt, "tile/props/columns").expect("a table's column header"), rect_of(&rt, "tile/props/head/edge").expect("the line the rows scroll under"), rect_of(&rt, "tile/props/scroll").unwrap());
    assert!(edge[1] >= columns[1] + columns[3] + 4.0, "the line sits under the header with room between: header {columns:?}, line {edge:?}");
    assert_eq!(scroll[1], edge[1] + edge[3], "and the rows' own scroll starts under it");
    let seen = |rt: &rune::Runtime<crate::actions::App>| rt.elements().into_iter().filter(|e| e.key.as_deref().is_some_and(|key| key.starts_with("tile/props/row/") || key.starts_with("tile/props/group/"))).filter(|e| e.visible[3] > 0.0).map(|e| (e.key.unwrap(), e.visible)).collect::<Vec<_>>();
    assert!(!seen(&rt).is_empty());
    // Scrolled a row and a half, then to its end: whatever is still seen is below the line.
    for step in [-42.0, -400.0] {
        rt.wheel(scroll[0] + 30.0, scroll[1] + 10.0, step);
        rest(&mut rt);
        let rows = seen(&rt);
        assert!(!rows.is_empty(), "rows are still listed");
        for (key, visible) in rows { assert!(visible[1] >= edge[1] + edge[3], "{key} is drawn at {visible:?}, above the line at {}", edge[1] + edge[3]) }
        assert_eq!(rect_of(&rt, "tile/props/columns").unwrap(), columns, "the header stays where it is");
    }
}
