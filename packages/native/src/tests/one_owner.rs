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
        (".pane(", vec!["view.rs"]),
        (".effects(", vec!["keys.rs", "control.rs", "main.rs"]),
        (".take()", vec!["main.rs", "store.rs", "client.rs"]),
        (".reconnect()", vec!["main.rs"]),
        (".start()", vec!["main.rs"]),
        (".settle()", vec!["main.rs"]),
        (".script(", vec!["main.rs"]),
    ] {
        none(&format!("{hand} called from somewhere new"), strays(hand, |path| path.starts_with("actions/") || callers.contains(&path)));
    }
    // Everywhere else, a handler that gets the App does one thing with it: runs an act line.
    for (path, text) in texts.iter().filter(|(path, _)| !path.starts_with("actions/") && !["store.rs", "keys.rs", "control.rs", "main.rs"].contains(&path.as_str())) {
        for (n, line) in text.lines().enumerate().filter(|(_, line)| line.contains("&mut App") && !line.trim_start().starts_with("//")) {
            let hands_on = line.contains(".act(") || line.contains("s.pane(") || line.contains("pick(s)") || line.contains("run(s)") || line.contains("impl Fn(&mut App)");
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
