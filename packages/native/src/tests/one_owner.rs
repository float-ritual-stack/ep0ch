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

/// Which tile an address names is `Layout::resolve` (layout/address.rs, held to the door's resolver by
/// address-contract.json): nothing else reads the address grammar or looks an argument's tile up by name.
#[test]
fn an_address_is_read_by_the_layout_s_resolver_alone() {
    none("an address read outside the grammar's file and the layout's resolver", strays("Address::", |path| path == "actline.rs" || path == "layout/address.rs"));
    none("an argument's tile looked up by name: ask `App::tile_named`", ["named(to)", "named(tile)", "named(&name)", "lands().and_then(|name| app.layout.named"].iter().flat_map(|call| strays(call, |path| path.starts_with("layout") || path == "actions/layout.rs")).collect());
    // Its callers: an act's tile (`App::tile_named`), and in app.rs a follower's source and the screen's `lands` as a name.
    none("the resolver asked from somewhere new", calls("resolve", |path| path.starts_with("layout") || path == "client.rs" || path == "actions/mod.rs" || path == "actions/app.rs"));
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

/// What a tile's kind is and what a screen is are the service's rows (`screens.list`); what a list's rows are is the
/// service's answer (`lists.read`). The window keeps no catalogue, compiles no screen in, asks no other read for a
/// list and builds no act line for a row: a second place that knows any of these is a second vocabulary.
#[test]
fn kinds_screens_and_a_list_s_rows_are_the_service_s_and_the_window_keeps_no_copy() {
    // No catalogue and no screen compiled in; the drawers the two lists replaced are gone.
    for gone in ["static KINDS", "static SOURCES", "fn shipped(", "From::Shipped", "screen::default(", "struct Hits", "struct Matches", "struct TreeLine", "fn tree_of(", "fn level_ask(", "fn inspector("] { none(&format!("{gone} is back"), strays(gone, |_| false)) }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert!(!manifest.join("screens").exists(), "the window ships no screens: they are the screens extension's");
    for gone in ["src/tiles/tree.rs", "src/tiles/about.rs"] { assert!(!manifest.join(gone).exists(), "{gone}: a tree and what is about a note are lists, drawn by tiles/list.rs") }
    none("a screen or a kind catalogue compiled in", strays("include_str!(", |path| path == "main.rs"));
    // Rows come from one read. The reads the window mapped to rows itself are asked by nobody here.
    none("a list read that isn't lists.read: the service lists rows, the window maps none", ["\"tree.search\"", "\"blocks.query\"", "\"blocks.read\"", "\"references.backlinks\"", "\"extensions.list\""].iter().flat_map(|read| strays(read, |_| false)).collect());
    none("lists.read asked from somewhere new (a tile's is App::list_ask, the bar's bar::ask)", strays("\"lists.read\"", |path| path == "actions/app.rs" || path == "bar.rs"));
    none("the screens asked from somewhere new", strays("\"screens.list\"", |path| path == "actions/app.rs"));
    // A row's act line is the row's own: nothing under the list drawer or the bar writes an open for a row.
    none("an act line written for a list's row: run the row's own (`act`)", ["format!(\"open id=", "fn open_line("].iter().flat_map(|line| strays(line, |path| !["tiles/list.rs", "bar.rs", "list.rs"].contains(&path))).collect());
    // A kind is found by the service's row (`App::kind_row`), never compared by name.
    none("a tile's kind compared with a name: ask its row (`App::kind_row`, `App::drawer_of`)", ["spec.kind == \"", "s.kind == \"", "kind: \""].iter().flat_map(|test| strays(test, |path| path.starts_with("layout"))).collect());
    none("a drawer looked up by a name written here: a kind's row names it", calls("drawer", |path| path == "tiles/mod.rs"));
    // What a list tile sends is what its source says it reads: no list of parameters, and no property key, lives here.
    let texts = sources();
    let app = &texts.iter().find(|(path, _)| path == "actions/app.rs").unwrap().1;
    assert!(app.contains("for name in self.source_params(from)?"), "a list's parameters are read from its source's own row");
    none("a property a list is grouped, sorted or filtered by, named in the window", ["work-stage", "work-id", "\"outbox\"", "\"stage\""].iter().flat_map(|key| strays(key, |_| false)).collect());
}

/// The renderer seam: Rune is the shell's, the drawers', the bar's, the one list's, the key table's, the control
/// socket's and main's. The model (the layout, the actions, the screens and kinds, the act-line grammar, the wire's
/// shapes) names no Rune type, so another renderer could draw the same state. The four files left that do are
/// named: each holds a kit editor's text or a waker, not a drawing.
#[test]
fn rune_is_named_only_by_what_draws_and_the_four_files_left() {
    let draws = |path: &str| ["shell.rs", "bar.rs", "list.rs", "keys.rs", "control.rs", "main.rs"].contains(&path) || path.starts_with("tiles/");
    let left = ["actions/app.rs", "actions/draft.rs", "store.rs", "client.rs"];
    none("Rune named in the model: draw it in a drawer, the shell or the bar", ["rune::", "rune_kit::", "use rune"].iter().flat_map(|word| strays(word, |path| draws(path) || left.contains(&path))).collect());
    for path in left { assert!(sources().iter().any(|(p, text)| p == path && text.contains("rune::")), "{path} names Rune no more: take it off the list") }
}

/// Which host and outline the window opens, and where its control socket is, is the door's rule (`resolveTarget`
/// and `placeFor`, asked through resolve.ts): the window reads no outline or host setting itself, and the socket's
/// name is the door's own (`DOORS`), so `--door native` looks where the window serves.
#[test]
fn which_outline_and_host_is_the_door_s_rule_asked_every_time() {
    none("the outline or the host read from the environment here: resolve.ts asks the door's rule", ["EP0CH_SOCKET\"", "EP0CH_WS\"", "EP0CH_MACHINE\"", "\"--machine\""].iter().flat_map(|word| strays(word, |_| false)).collect());
    let script = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("resolve.ts")).unwrap();
    assert!(script.contains("DOORS.native") && !script.contains("\"native.sock\""), "resolve.ts names the control socket by the door's DOORS");
    assert!(script.contains("resolveTarget(named)") && script.contains("placeFor(named)"));
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

/// A page's parts have one drawer, the registry: a primitive is built by its type in `tiles/prim.rs`, and nothing
/// under `tiles/` reads what a part was written as (a figure's kind, a component's name) to decide what to draw.
#[test]
fn a_primitive_is_built_by_the_registry_and_no_drawer_reads_what_a_part_was_written_as() {
    none("a primitive built outside the tiles", strays("prim::build(", |path| path.starts_with("tiles/") || path.starts_with("tests/")));
    none("a registry beside PRIMS", strays("&[Prim]", |path| path == "tiles/prim.rs"));
    let texts = sources();
    let text = |path: &str| texts.iter().find(|(p, _)| p == path).map(|(_, text)| text.as_str()).unwrap_or_else(|| panic!("{path} is there"));
    // The page drawer walks: the spike's own drawings of a component, a figure, the note and its chips are gone.
    for gone in ["fn component(", "fn stat_tiles(", "fn note(", "fn chips(", "Part::", "Frame", "Markdown::new", "Badge::new"] {
        assert!(!text("tiles/page.rs").contains(gone), "tiles/page.rs has `{gone}`: a part is drawn by the registry");
    }
    assert!(text("tiles/page.rs").contains("prim::build(part,") && text("tiles/page.rs").contains("parts::around(page)"), "the page drawer walks its parts through the registry");
    // No builder and no drawer matches a figure's kind or a component's name: what to draw is the primitive's type.
    // (`tiles/tree.rs` and `tiles/about.rs` are the list wave's to rewrite; `tiles/about.rs` still switches on kind names.)
    let code = |path: &str| text(path).lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    for path in ["tiles/prim.rs", "tiles/page.rs", "parts.rs"] {
        for read in ["[\"figure\"]", "\"graph-", "\"figure\")"] { assert!(!code(path).contains(read), "{path} reads `{read}`: a figure is the primitives the service lowered it to") }
        for kind in ["stat", "meter", "rank", "spark", "check", "timeline", "decision", "tabs", "compare", "links", "fields", "view", "use", "box"] {
            for read in [format!("[\"kind\"] == \"{kind}\""), format!("[\"name\"] == \"{kind}\""), format!("Some(\"{kind}\") =>")] {
                // A primitive's own type is `stat` and `box` too, matched once, in the registry's table (`ty: "stat"`).
                assert!(!code(path).contains(&read), "{path} has `{read}`: it decides by what a part was written as");
            }
        }
    }
    assert!(!code("tiles/prim.rs").contains("[\"kind\"]"), "a builder reads no part's kind");
    // The wire of a press has one owner each way: the script noun asks, the store reads the call and answers it.
    none("a button run asked outside its action", strays("\"scripts.sequence\"", |path| path == "actions/script.rs" || path.starts_with("tests/")));
    none("a script's act answered outside the store", strays("\"scripts.answer\"", |path| path == "store.rs" || path.starts_with("tests/")));
    none("the window registered outside the store", strays("\"events.subscribe\"", |path| path == "store.rs" || path.starts_with("tests/")));
    // The renderer seam: the page's model and the script noun hold no Rune, so a second renderer draws the same walk.
    for path in ["parts.rs", "page.rs", "actions/script.rs", "actline.rs", "screen.rs"] {
        for word in ["rune::", "rune_kit", "use rune"] { assert!(!code(path).contains(word), "{path} names Rune (`{word}`): it is the model, drawn by tiles/") }
    }
}
