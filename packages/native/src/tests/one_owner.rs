//! The source, scanned: each decision has one place, and this fails when a second one appears.
//!
//! What the compiler already holds is not scanned again: `App`'s state is private to `actions/` (its fields are
//! `pub(in crate::actions)` and it derefs, read-only, to `State`), so a view cannot assign a field. The scans
//! are for the ways round that, and for the parts with one owner by agreement.
use std::path::Path;

/// Every source file of the app but its tests: (path under src/, text).
fn sources() -> Vec<(String, String)> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().path()) {
            let name = entry.strip_prefix(root).unwrap().to_str().unwrap().to_string();
            if entry.is_dir() { if name != "tests" { walk(&entry, root, out) } } else if name.ends_with(".rs") { out.push((name, std::fs::read_to_string(&entry).unwrap())) }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    walk(&root, &root, &mut out);
    out.sort();
    out
}

/// The lines of code that hold `needle`, outside the files allowed to: `path:line: text`.
fn strays(needle: &str, allowed: impl Fn(&str) -> bool) -> Vec<String> {
    sources().iter().filter(|(path, _)| !allowed(path)).flat_map(|(path, text)| {
        text.lines().enumerate().filter(|(_, line)| !line.trim_start().starts_with("//") && line.contains(needle)).map(|(n, line)| format!("{path}:{}: {}", n + 1, line.trim())).collect::<Vec<_>>()
    }).collect()
}

fn none(what: &str, found: Vec<String>) { assert!(found.is_empty(), "{what}:\n{}", found.join("\n")) }

#[test]
fn a_key_is_bound_and_a_chord_is_read_only_in_keys_rs() {
    none("a key handler outside keys.rs: bind the key in its action's row", strays(".on_key(", |path| path == "keys.rs"));
    none("a chord read outside keys.rs", strays("Chord::parse", |path| path == "keys.rs"));
    // The window's own handler is the table's, named once.
    let named: Vec<String> = strays("on_key:", |_| false).into_iter().map(|found| found.splitn(3, ':').enumerate().filter(|(i, _)| *i != 1).map(|(_, part)| part.to_string()).collect::<Vec<_>>().join(":")).collect();
    assert_eq!(named, ["main.rs: on_key: Some(keys::press),"]);
    none("a key matched by hand: bind it in its action's row", strays("Key::", |path| path == "keys.rs"));
}

#[test]
fn state_changes_only_under_actions_and_the_store() {
    let texts = sources();
    let app = &texts.iter().find(|(path, _)| path == "actions/app.rs").expect("the App is defined under actions/").1;
    // The compiler's half: the state and the store are private to actions/, and nothing hands them out to write.
    assert!(app.contains("pub(in crate::actions) st: State,") && app.contains("pub(in crate::actions) store: Store,"));
    none("App handed out to write: only Deref", strays("DerefMut", |_| false));
    none("the state handed out to write", strays("&mut State", |_| false));
    none("the store handed out to write", strays("&mut Store", |path| path == "store.rs"));
    none("state behind a cell, where a view could write it", strays("RefCell", |_| false).into_iter().chain(strays("Cell<", |path| path == "store.rs")).collect());
    // The ways in that are not acts are the kit's own hands and the link's life, each with the callers named here.
    for (hand, callers) in [
        (".field(", vec!["keys.rs"]),
        (".typed(", vec!["keys.rs"]),
        (".held()", vec!["keys.rs"]),
        (".resized(", vec!["shell.rs"]),
        (".effects(", vec!["keys.rs", "control.rs", "main.rs"]),
        (".take()", vec!["main.rs", "store.rs", "client.rs"]),
        (".reconnect()", vec!["main.rs"]),
        (".start()", vec!["main.rs"]),
        (".settle()", vec!["main.rs"]),
        (".script(", vec!["main.rs"]),
    ] {
        // The layout is pure (it holds no App: `a_layout_is_pure` below), so a word that is also a hand's name there is its own.
        none(&format!("{hand} called from somewhere new"), strays(hand, |path| path.starts_with("actions/") || path.starts_with("layout") || callers.contains(&path)));
    }
    // Everywhere else, a handler that gets the App does one thing with it: runs an act line.
    for (path, text) in texts.iter().filter(|(path, _)| !path.starts_with("actions/") && !["store.rs", "keys.rs", "control.rs", "main.rs"].contains(&path.as_str())) {
        for (n, line) in text.lines().enumerate().filter(|(_, line)| line.contains("&mut App") && !line.trim_start().starts_with("//")) {
            let hands_on = line.contains(".act(") || line.contains("s.resized(") || line.contains("pick(s)") || line.contains("run(s)") || line.contains("impl Fn(&mut App)");
            assert!(hands_on, "{path}:{}: a handler that doesn't run an act line: {}", n + 1, line.trim());
        }
    }
}

#[test]
fn a_write_and_a_read_go_through_the_store_and_a_row_through_the_one_list() {
    none("a request built outside the store", strays("link.send(", |path| path == "store.rs"));
    none("a wire write outside an action", strays(".write(", |path| path.starts_with("actions/") || path == "store.rs"));
    none("a one-off request outside an action", strays(".request(", |path| path.starts_with("actions/") || path == "store.rs"));
    none("an attribution written outside the store", strays("\"actorId\"", |path| path == "store.rs"));
    none("rows built by index outside list.rs", strays("virtual_rows(", |path| path == "list.rs"));
}

#[test]
fn a_label_and_a_keycap_come_from_the_rows() {
    // No keycap is written out: a view asks the table.
    none("a keycap written by hand: ask keys::cap", ["⌘", "⌥", "⌃", "⇧", "Ctrl+", "Cmd+"].iter().flat_map(|cap| strays(cap, |path| path == "keys.rs")).collect());
    // A button names its act line and nothing else; what it is called is the row's.
    none("a button with a label of its own: name its act line", strays("Button::new(\"", |_| false));
    // The spike's parts that decided on their own are gone.
    for gone in ["enum Finder", "enum Tag", "Notice::Trashed", "fn palette(", "fn scene_", "fn on_key("] { none(&format!("{gone} is back"), strays(gone, |_| false)) }
}

/// The lines of code that call the function `name` (the word, not the end of a longer one), outside the files allowed to.
fn calls(name: &str, allowed: impl Fn(&str) -> bool) -> Vec<String> {
    let needle = format!("{name}(");
    strays(&needle, allowed).into_iter().filter(|found| {
        let line = found.splitn(3, ':').nth(2).unwrap_or("");
        line.match_indices(&needle).any(|(at, _)| !line[..at].chars().next_back().is_some_and(|c| c.is_alphanumeric() || c == '_'))
    }).collect()
}

/// The arrangement has one decider. `layout.rs` and what is under it are pure: no Rune, no socket, no App. Only an
/// action issues an operation, only `reshape`'s file asks `apply`, and only the open action's asks `place`.
#[test]
fn the_layout_is_pure_and_only_an_action_changes_it_or_places_an_open() {
    let texts = sources();
    let layout: Vec<&(String, String)> = texts.iter().filter(|(path, _)| path.starts_with("layout")).collect();
    assert!(layout.len() >= 4, "layout.rs and its parts: {:?}", layout.iter().map(|(path, _)| path).collect::<Vec<_>>());
    for (path, text) in &layout {
        for word in ["rune::", "rune_kit", "crate::store", "crate::client", "crate::actions", "crate::keys", "UnixStream", "App"] {
            let found: Vec<String> = text.lines().enumerate().filter(|(_, line)| !line.trim_start().starts_with("//") && line.contains(word)).filter(|(_, line)| word != "App" || line.split(|c: char| !c.is_alphanumeric()).any(|w| w == "App")).map(|(n, line)| format!("{path}:{}: {}", n + 1, line.trim())).collect();
            none(&format!("the layout is pure: {word} in it"), found);
        }
    }
    none("an operation issued outside an action: run an act line", strays("Op::", |path| path.starts_with("actions/") || path.starts_with("layout")));
    none("the layout applied outside the one place an action reshapes it (actions/layout.rs)", calls("apply", |path| path == "actions/layout.rs" || path.starts_with("layout")));
    // (`client::place` is where the outline is: another word.)
    none("an open placed outside the open action (actions/nav.rs)", ["layout::place(", "layout::placement(", "layout::{place", "layout::place;", "placement::place"].iter().flat_map(|call| strays(call, |path| path == "actions/nav.rs" || path.starts_with("layout"))).collect());
    assert_eq!(calls("place", |path| !path.starts_with("actions/")).len(), 1, "one call of place( under actions/: the open action's");
    // A drawer is handed a TileCx and speaks by act lines: nothing under tiles/ is handed the layout to change, or the wire.
    none("a drawer handed the layout to change", strays("&mut Layout", |path| !path.starts_with("tiles/")));
    none("a drawer that reaches the wire", ["crate::client", ".write(", ".request(", "UnixStream"].iter().flat_map(|word| strays(word, |path| !path.starts_with("tiles/"))).collect());
    // The parts the spike decided the window's shape with are gone, and the shell uses none of the kit's fixed panes.
    for gone in ["SplitView", "PaneState", "fn sidebar(", "fn toolbar(s: &App, k: &Kit) -> Toolbar", "pub back: Vec<String>", "mod view;"] { none(&format!("{gone} is back"), strays(gone, |_| false)) }
    assert!(!std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/view.rs").exists(), "view.rs is split into shell.rs and tiles/");
}

/// Whether the arrangement changes has one decider, `layout::apply`, for a step undone and a screen opened as for
/// a split: nothing but `actions/layout.rs` holds the arrangement to write, issues a load, or keeps a rule of the
/// layout's beside it (the last tile staying, a share's limits, what unsaved text blocks).
#[test]
fn nothing_beside_the_layout_decides_whether_the_arrangement_changes() {
    none("the arrangement written outside the one place that asks the layout (actions/layout.rs)", strays("st.layout =", |path| path == "actions/layout.rs"));
    none("a load issued outside actions/layout.rs: `App::replace` asks the layout", strays("Op::Load", |path| path == "actions/layout.rs" || path.starts_with("layout")));
    none("the last tile staying, said outside the layout", strays("last tile", |path| path.starts_with("layout")));
    none("a share's limits outside the layout (layout/step.rs keeps them)", [".clamp(0.08", "0.92)"].iter().flat_map(|limit| strays(limit, |path| path.starts_with("layout"))).collect());
    // What unsaved text blocks is the layout's to say, from the fact it is handed (`App::facts`): the draft's own
    // actions ask whether there is any, and nothing else does.
    none("a rule about unsaved text outside the layout and the draft's own actions", strays(".unsaved()", |path| ["actions/app.rs", "actions/draft.rs", "tiles/page.rs"].contains(&path)));
}

/// What Esc does is the key table's rows (`keys::esc_steps`): nothing turns an Escape into an act line by hand. A
/// border's drag has its own way back (a resize to where it was), never the undo of some other change.
#[test]
fn esc_is_the_key_table_s_and_a_drag_s_way_back_is_not_the_undo() {
    none("layout.undo run from outside its own row (a key, its bar row)", strays("\"layout.undo\"", |path| path == "actions/layout.rs"));
    none("Escape read outside the key table", ["Key::Escape", "ChordKey::Escape"].iter().flat_map(|key| strays(key, |path| path == "keys.rs")).collect());
    let texts = sources();
    let shell = &texts.iter().find(|(path, _)| path == "shell.rs").expect("shell.rs").1;
    assert!(shell.contains("d.cancelled() && d.data < 0.0).then(|| line(-d.data))"), "a border's drag let go with Escape says layout.resize, back to the share at the press");
}

/// Which tile has the keys is `Layout.focus`, changed only in `apply`; Rune's focus follows it through the one
/// reconciler in keys.rs, the only caller of `Tx::focus`, and a tile's root is made to hold the keys there too.
#[test]
fn rune_s_focus_follows_the_layout_s_through_keys_rs_alone() {
    none("Rune's focus set outside keys.rs: `keys::follow` is the one reconciler", ["tx.focus(", ".return_focus(", "tx.blur("].iter().flat_map(|call| strays(call, |path| path == "keys.rs")).collect());
    none("the layout's focus written outside the layout", strays(".focus = ", |path| path.starts_with("layout")));
    // A field's own flag is set where a draft or the bar opens, and by the arrangement settling: nowhere else.
    none("a field's focus flag set outside the draft's and the arrangement's own files", strays(".focused = ", |path| ["actions/draft.rs", "actions/layout.rs"].contains(&path)));
    let texts = sources();
    let text = |name: &str| &texts.iter().find(|(path, _)| path == name).unwrap_or_else(|| panic!("{name}")).1;
    assert!(text("shell.rs").contains("keys::tile("), "each tile's root is made to hold the keys by keys::tile");
    assert!(text("main.rs").contains("keys::follow(s, tx)"), "the window's poll runs the reconciler");
    assert!(text("keys.rs").contains("e.tile == self.layout.focus"), "the person's layer is read from the tile with the keys");
}

/// Who acts, and whether, is `rule()` in actions/mod.rs, from what the row declares (`touches`, `while`, `person`).
/// No action's run refuses an agent for whose the thing is: the three left are named, each with why it is not the
/// row's to say.
#[test]
fn no_action_refuses_an_agent_in_its_own_run_but_the_ones_named() {
    let found: Vec<String> = sources().iter().filter(|(path, _)| path.starts_with("actions/") && path != "actions/mod.rs").flat_map(|(path, text)| {
        text.lines().filter(|line| !line.trim_start().starts_with("//") && line.contains("refused(") && (line.contains("an agent") || line.contains("person's"))).map(|line| format!("{path}: {}", line.split("refused(").nth(1).unwrap_or("").chars().take(40).collect::<String>())).collect::<Vec<_>>()
    }).collect();
    assert_eq!(found, [
        // An agent's pick is its own (it runs the row as itself); what it must name is the request's shape.
        "actions/bar.rs: \"an agent's pick names its row: source= ",
        // The draft session's rule, while the person is the only holder there is: W5's session takes it.
        "actions/draft.rs: format!(\"the editor is the person's: an ",
        // Which row an agent may fold depends on the note the person has open: no row can say that ahead.
        "actions/tree.rs: \"the person's note is under that row: an",
    ], "an action refuses an agent in its own run: say whose it is on its row (`ActionRow::person`), and `rule()` refuses");
}

/// Before `run`, Rune has published no headless run (`headless_run()` is None until the app's state is made), so
/// what `main` decides before it is asked of `rune::is_headless()`, which reads the arguments: a headless render
/// (`--snap`, `--tree`) serves no control socket beside a window's.
#[test]
fn main_asks_whether_the_run_is_headless_the_way_that_answers_before_run() {
    let texts = sources();
    let main = &texts.iter().find(|(path, _)| path == "main.rs").expect("main.rs").1;
    let body = main.split("fn main()").nth(1).expect("main.rs has main");
    assert!(!body.contains("headless_run()"), "main asks headless_run() before run, where it is always None");
    assert!(body.contains("rune::is_headless()"), "main asks rune::is_headless() whether to serve the control socket");
}
