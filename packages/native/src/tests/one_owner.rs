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
        (".revealed()", vec!["keys.rs"]),
        (".take()", vec!["main.rs", "store.rs", "client.rs"]),
        (".reconnect()", vec!["main.rs"]),
        (".beat()", vec!["main.rs"]),
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
            // (`act_in` is an act line run from the tile it was pressed in: the dispatcher's own, as `act` is.)
            let hands_on = line.contains(".act(") || line.contains(".act_in(") || line.contains("s.resized(") || line.contains("pick(s)") || line.contains("run(s)") || line.contains("impl Fn(&mut App)");
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
    none("a rule about unsaved text outside the layout, the draft session and its own actions", strays(".unsaved()", |path| ["draft.rs", "actions/draft.rs", "tiles/page.rs"].contains(&path)));
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
    // A field's own flag is the field's (`keys::Text`): given where a draft or the bar opens, and by the arrangement settling.
    none("a field's focus flag set outside the field's own type", strays(".focused = ", |path| path == "keys.rs"));
    none("a field given or denied the keys outside the arrangement's own file", strays(".give_keys(", |path| ["actions/layout.rs", "keys.rs"].contains(&path)));
    none("a field made with the keys outside the draft's own file", strays("Text::focused(", |path| ["actions/draft.rs", "keys.rs"].contains(&path)));
    let texts = sources();
    let text = |name: &str| &texts.iter().find(|(path, _)| path == name).unwrap_or_else(|| panic!("{name}")).1;
    assert!(text("shell.rs").contains("keys::tile("), "each tile's root is made to hold the keys by keys::tile");
    assert!(text("main.rs").contains("keys::follow(s, tx)"), "the window's poll runs the reconciler");
    assert!(text("keys.rs").contains("self.draft_on(&self.layout.focus)"), "the person's layer is read from the tile with the keys");
}

/// Which tile an address names is `Layout::resolve` (layout/address.rs, held to the door's resolver by
/// address-contract.json): nothing else reads the address grammar or looks an argument's tile up by name.
#[test]
fn an_address_is_read_by_the_layout_s_resolver_alone() {
    none("an address read outside the grammar's file and the layout's resolver", strays("Address::", |path| path == "actline.rs" || path == "layout/address.rs"));
    none("an argument's tile looked up by name: ask `App::tile_named`", ["named(to)", "named(tile)", "named(&name)"].iter().flat_map(|call| strays(call, |path| path.starts_with("layout") || path == "actions/layout.rs")).collect());
    // Its callers: an act's tile (`App::tile_named`), and in app.rs a follower's source.
    none("the resolver asked from somewhere new", calls("resolve", |path| path.starts_with("layout") || path == "client.rs" || path == "actions/mod.rs" || path == "actions/app.rs"));
    let texts = sources();
    let app = &texts.iter().find(|(path, _)| path == "actions/app.rs").unwrap().1;
    assert_eq!(app.matches(".resolve(").count(), 1, "app.rs asks the resolver for a follower's source alone: where a screen's opens land is the layout's `lands`");
}

/// Who acts, and whether, is `rule()` in actions/mod.rs, from what the row declares (`touches`, `while`, `person`).
/// No action's run refuses an agent for whose the thing is: the two left are named, each with why it is not the
/// row's to say. (The editor is the person's on every row that opens, types in, saves or closes a draft: W5.)
#[test]
fn no_action_refuses_an_agent_in_its_own_run_but_the_ones_named() {
    let found: Vec<String> = sources().iter().filter(|(path, _)| path.starts_with("actions/") && path != "actions/mod.rs").flat_map(|(path, text)| {
        text.lines().filter(|line| !line.trim_start().starts_with("//") && line.contains("refused(") && (line.contains("an agent") || line.contains("person's"))).map(|line| format!("{path}: {}", line.split("refused(").nth(1).unwrap_or("").chars().take(40).collect::<String>())).collect::<Vec<_>>()
    }).collect();
    assert_eq!(found, [
        // An agent's pick is its own (it runs the row as itself); what it must name is the request's shape.
        "actions/bar.rs: \"an agent's pick names its row: source= ",
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
    none("lists.read asked from somewhere new (`App::ask_of` makes every one: a tile's and the bar's)", strays("\"lists.read\"", |path| path == "actions/app.rs"));
    none("the screens asked from somewhere new", strays("\"screens.list\"", |path| path == "actions/app.rs"));
    // A row's act line is the row's own: nothing anywhere writes an open for a row, a child or a link.
    none("an act line written for a row: run the row's own (`act`)", ["format!(\"open id=", "fn open_line(", "tile.emit"].iter().flat_map(|line| strays(line, |_| false)).collect());
    // A kind is found by the service's row (`App::kind_row`), never compared by name.
    none("a tile's kind compared with a name: ask its row (`App::kind_row`, `App::drawer_of`)", ["spec.kind == \"", "s.kind == \"", "kind: \""].iter().flat_map(|test| strays(test, |path| path.starts_with("layout"))).collect());
    none("a drawer looked up by a name written here: a kind's row names it", calls("drawer", |path| path == "tiles/mod.rs"));
    // What a list tile sends is what its source says it reads: no list of parameters, and no property key, lives here.
    let texts = sources();
    let app = &texts.iter().find(|(path, _)| path == "actions/app.rs").unwrap().1;
    assert!(app.contains("for name in self.source_params(from)?") && app.matches("source_params(from)?").count() == 1, "a list's parameters are read from its source's own row, in the one place a list is asked");
    none("a property a list is grouped, sorted or filtered by, named in the window", ["work-stage", "work-id", "\"outbox\"", "\"stage\""].iter().flat_map(|key| strays(key, |_| false)).collect());
}

/// The renderer seam: Rune is the shell's, the drawers', the bar's, the one list's, the key table's, the control
/// socket's and main's. Everything else is the model (the layout, the actions and the window's state, the store
/// and the link, the screens and kinds, the act-line grammar, the wire's shapes, a page's walk, a question's
/// terms) and names no Rune type, so another renderer could draw the same state. What the state holds of a
/// renderer's (a field's text as its editor has it, a decoded picture) is a type of the seam's own (`keys::Text`,
/// `tiles::picture::Pictures`), and a waker is the link's own word for one (`client::Waker`).
#[test]
fn rune_is_named_only_behind_the_renderer_seam() {
    let seam = |path: &str| ["shell.rs", "bar.rs", "list.rs", "keys.rs", "control.rs", "main.rs"].contains(&path) || path.starts_with("tiles/");
    none("Rune named in the model: draw it in a drawer, the shell or the bar, or hold it behind a type of the seam's", ["rune::", "rune_kit", "use rune", "TextEdit", "ImageCache", "&mut Tx"].iter().flat_map(|word| strays(word, seam)).collect());
    // The model, by name: each is there, and none of them is in the seam's list by another route.
    let texts = sources();
    for path in ["actions/app.rs", "actions/mod.rs", "actions/draft.rs", "actions/script.rs", "draft.rs", "store.rs", "client.rs", "screen.rs", "actline.rs", "page.rs", "parts.rs", "query.rs", "layout.rs"] {
        assert!(texts.iter().any(|(p, _)| p == path) && !seam(path), "{path} is the model's");
    }
    // What the state holds of a renderer's is made and reached only through the seam's own types.
    none("a decoded picture named outside the tiles: the state holds `Pictures`, a builder draws a `Shown`", strays("Shown::", |path| path.starts_with("tiles/")));
    none("the editor behind a field's text reached outside keys.rs", [".0.text", ".0.focused", "field(field).0"].iter().flat_map(|reach| strays(reach, |path| path == "keys.rs")).collect());
}

/// The second sweep's owners, each held by a scan of the source: the deciders that were folded can't come back
/// without one of these naming the line. (`sweep2.rs` holds the same by what the window does.)
#[test]
fn the_second_sweep_s_deciders_each_have_one_place() {
    let texts = sources();
    let text = |path: &str| texts.iter().find(|(p, _)| p == path).map(|(_, text)| text.as_str()).unwrap_or_else(|| panic!("{path} is there"));
    let code = |path: &str| text(path).lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");

    // How a request is written as an act line: `actline::word`, which every line written here goes through.
    none("a second writer of an act line's word", strays("pub fn word(value", |path| path == "actline.rs"));
    none("a value quoted for an act line by hand (JSON's quoting reads back as another value)", ["json!(value).to_string()", "json!(s).to_string()"].iter().flat_map(|quote| strays(quote, |_| false)).collect());
    none("a request written as a line outside the grammar's own file (build a `Request` and call `act_request`)", calls("line_of", |path| path == "actline.rs" || path == "parts.rs" || path == "tiles/page.rs" || path == "tiles/prim.rs"));
    assert!(!code("actions/script.rs").contains("app.act(") && code("actions/script.rs").matches("act_from(").count() == 2, "a button's act and a script's call are requests handed to the dispatcher from the tile they were pressed in, never a line read again");
    // Where a press happened is no name for a tile: what comes from a tile goes through `App::act_from`, the one place
    // that says whether it is about that tile, and nothing writes a `tile=` onto a line or a request for it.
    // (The shell's drag names the tile dragged, and the grammar's own file writes a request's `tile` back as its word.)
    none("a tile written onto a line for where it was pressed (hand the request to `App::act_from`)", ["{} tile={}", "{line} tile={}", "{act} tile={}"].iter().flat_map(|written| strays(written, |path| path == "shell.rs" || path == "actline.rs")).collect());
    none("a request aimed at the tile it comes from outside the dispatcher (`App::act_from`)", ["request.tile = Some(", "tile: Some(app.layout.name("].iter().flat_map(|aimed| strays(aimed, |_| false)).collect());
    assert_eq!(code("actions/mod.rs").matches("req.tile = Some(").count(), 1, "the dispatcher's `act_from` is the one place a request takes the tile it comes from");

    // What a list is, and how its rows sit under headers: one port of `listSections`, one drawer of a row.
    none("a second copy of a list's sections", strays("fn sections(", |path| path == "page.rs"));
    none("a list's sections asked outside the list drawer", strays(".sections()", |path| path == "tiles/list.rs"));
    for gone in ["fn rows(", "fn line(", "[\"groups\"]", "\"headers\"", "[\"group\"]"] { assert!(!code("tiles/prim.rs").contains(gone), "tiles/prim.rs has `{gone}`: a list on a page is drawn by the list drawer (`list::on_page`)") }
    assert!(code("tiles/prim.rs").contains("super::list::on_page("));
    assert!(!code("parts.rs").contains("page.children"), "parts.rs makes no rows: the notes under a note are the list the service answered (`under`)");

    // What a press runs: the act line the service wrote on the row or the primitive (`act`), and nothing else.
    for path in ["parts.rs", "tiles/prim.rs", "tiles/list.rs", "tiles/page.rs", "tiles/mod.rs"] {
        for read in ["[\"do\"]", "[\"link\"]", "[\"links\"]", "\"link\")", "\"do\")", "fn opens(", "fn runs(", "fn says(", "fn emit("] { assert!(!code(path).contains(read), "{path} has `{read}`: a press is the `act` the service wrote, by the one rule (outline-core's actOf)") }
    }

    // Which tile an act is about: `App::target`, asked by the dispatcher for every act; an action runs in `App::about`.
    none("a tile chosen for an act outside `App::target`", ["aimed.clone().filter(", "aimed.clone().or_else("].iter().flat_map(|chain| strays(chain, |path| path == "actions/app.rs")).collect());
    none("the aimed tile read by an action (ask `App::about`; an open reads where it comes from, a focus the tile it names)", strays("app.aimed", |path| ["actions/nav.rs", "actions/tile.rs"].contains(&path)));
    for path in ["actions/list.rs", "actions/tree.rs", "actions/script.rs"] { assert!(!code(path).contains("layout.focus"), "{path} reads the keys' tile itself: `App::about` is the tile the dispatcher found") }
    assert_eq!(code("actions/mod.rs").matches("self.target(action.about)").count(), 1, "the dispatcher asks the one rule, once an act");

    // Which action picks a row: `list::pick`, under both names.
    assert!(code("actions/tree.rs").contains("run: super::list::pick") && !code("actions/tree.rs").contains("fn pick("), "tree.pick is list.pick's run");
    assert!(!code("tiles/list.rs").contains("tree.pick"), "the list drawer says one pick for every list");

    // Where a screen's `lands` points: `Layout::lands`, read by placement and by `App::landing`.
    none("a screen's `lands` read outside `App::landing` and the layout's context", strays(".lands()", |path| ["actions/app.rs", "actions/layout.rs", "screen.rs"].contains(&path)));
    assert_eq!(code("actions/app.rs").matches(".lands()").count(), 1, "app.rs reads `lands` in `landing` alone");
    none("`lands` looked up as a tile's name beside the layout's own reading", ["named(lands)", "named(&lands)"].iter().flat_map(|call| strays(call, |path| path == "layout.rs")).collect());
    assert_eq!(code("layout.rs").matches("named(lands)").count(), 1, "layout.rs reads `lands` as a name in `Layout::lands` alone");

    // Which new-note rule applies: `Spec::new_note`, asked once.
    none("a screen's new-note rules read outside the one reader and its one asker", calls("new_note", |path| ["screen.rs", "actions/note.rs"].contains(&path)));
    assert_eq!(code("actions/note.rs").matches(".new_note(").count(), 1, "the rule is asked once, with the kind the tile is");

    // Which kind a name is: the service's rows, by the kind a tile carries or the name the row says it serves.
    for gone in ["fn is(&self, kind", "fn saved(&self)", ".replaces.iter()"] { none(&format!("{gone}: which kind serves a name is the service's word (`serves`)"), strays(gone, |_| false)) }
    none("the kind an open makes, named in the layout: whoever asks says it (`Ctx.sprout`)", ["k == \"reader\"", "unwrap_or(\"reader\")"].iter().flat_map(|kind| strays(kind, |_| false)).collect());

    // What a follower's subject is when unsaid: `follows` reads `subject` alone.
    assert!(code("actions/app.rs").contains("pub fn follows(&self, tile: &str) -> bool { self.field_of(tile, \"subject\").and_then(Value::as_str) == Some(\"follows\") }"), "a tile follows only when it says so");

    // What the bar lists, and what a facet pick adds to a question.
    none("a bar source found by how its row is drawn: a source says `bar` of itself", ["group.as_deref() == Some(\"bar\")", "mark.as_deref() == Some(\"main\")"].iter().flat_map(|mark| strays(mark, |_| false)).collect());
    none("the source a question is asked of, named here: the service says which carries facets (`bar::questions`)", ["const QUESTIONS", "scope=query query="].iter().flat_map(|name| strays(name, |path| path == "actions/bar.rs")).collect());
    assert!(!code("actions/bar.rs").contains("const QUESTIONS"));
    none("a picked value written as a term outside `query.rs`", ["format!(\"{key}={}\"", "fn term("].iter().flat_map(|term| strays(term, |path| path == "query.rs")).collect());

    // What a screen is while it is open: the service's row (`App::spec_now`); the file keeps no copy of its spec.
    assert!(!code("actions/layout.rs").contains("\"spec\""), "the arrangement's file holds the screen's name and its note's revision, never its spec");
    none("the open screen's own copy of its spec read where the service's row is the word (`App::spec_now`)", strays("screen.spec", |path| ["actions/app.rs", "actions/screen.rs", "screen.rs"].contains(&path)));
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
    // (That the page's model and the script noun hold no Rune is `rune_is_named_only_behind_the_renderer_seam`.)
}

/// A block being written (W5): one session a block, held by the App; the holder's side of the service's draft
/// protocol asked by the draft's own actions and answered by the store; what completes a word asked in one place,
/// with the text and the caret; and nothing in the window that finds a passage, a token or a block of the text.
#[test]
fn a_block_being_written_has_one_session_and_the_window_finds_no_passage_and_no_token() {
    let texts = sources();
    let text = |path: &str| texts.iter().find(|(p, _)| p == path).map(|(_, text)| text.as_str()).unwrap_or_else(|| panic!("{path} is there"));
    let code = |path: &str| text(path).lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    // The spike's whole-note editor is gone, and so is a field with a scroll of its own inside the page's.
    for gone in ["struct Editing", "pub editor: Text", "pub editing: Option<Editing>", "st.editing", "Field::Draft =>", "editor-scroll", ".auto_grow("] { none(&format!("{gone} is back: a block is written in place, a session each"), strays(gone, |_| false)) }
    // The hold: asked for, renewed, touched and let go by the draft's own actions; what the service asks of it is
    // landed and answered by the store.
    none("a draft's hold asked outside the draft's own actions", ["\"drafts.hold\"", "\"drafts.heartbeat\"", "\"drafts.touch\"", "\"drafts.release\""].iter().flat_map(|ask| strays(ask, |path| path == "actions/draft.rs")).collect());
    none("a holder's answer sent outside the store", strays("\"drafts.answer\"", |path| path == "store.rs"));
    none("a patch sent to the service outside the draft's own action", strays("\"draft.patch\"", |path| path == "actions/draft.rs" || path == "store.rs"));
    // Where a patch goes, and whether it may, is the service's (outline-core's placeDraftPatch): the window compares no
    // passage and knows no paragraph. It hands over its text and takes back ranges.
    none("a passage named outside the action that sends one to the service", strays("observed", |path| path == "actions/draft.rs"));
    for path in ["draft.rs", "actions/draft.rs", "tiles/page.rs", "keys.rs"] {
        for read in [".find(observed", "split(\"\\n\\n\")", "starts_with(\"- \")", "starts_with('#')", "\"[[\"", "\"((\"", "\"::\"", "::]"] { assert!(!code(path).contains(read), "{path} has `{read}`: the window reads no Blockdown; a token and a block of the text are the service's to find") }
    }
    none("a second map of an offset through placed spans (`draft::map_cursor`, held by core-contract.json)", strays("fn map_cursor(", |path| path == "draft.rs"));
    // Completions: one ask, made by the session from the text and the caret; the rows are drawn and written as served.
    none("what completes a word asked outside the session", strays("\"completion.rows\"", |path| path == "draft.rs"));
    assert!(code("draft.rs").contains("\"text\": text, \"cursor\": utf16_of(text, caret)") && !code("draft.rs").contains("\"target\""), "the service is handed the text and the caret, never a token found here");
    none("a completion row made here: the list is the service's rows, drawn and written as served", ["CompletionRow {", "insert: format!"].iter().flat_map(|made| strays(made, |path| path == "page.rs")).collect());
    // What is typed is kept by one writer, in one file beside the arrangement's.
    none("what is being written kept outside the session's own file", strays(".drafts.json", |path| path == "draft.rs"));
    // The guards in open() are gone: where an open lands beside a draft is the layout's rule, from the one fact.
    for word in ["drafts", "unsaved", "draft_on", "draft_of"] { assert!(!code("actions/nav.rs").contains(word), "actions/nav.rs reads `{word}`: an open asks the layout, which reads the tile's fact (`Facts.editing`)") }
    assert_eq!(texts.iter().filter(|(_, text)| text.lines().any(|line| !line.trim_start().starts_with("//") && line.contains("editing = self.draft_on(tile)"))).count(), 1, "the one fact the layout reads of a draft is made in `App::facts`");
    // The block's source is one field, built in one place, through the key table's adapter.
    none("a block's field built outside the page drawer", strays("keys::area(", |path| path == "tiles/page.rs"));
}

/// About the note (W6): what is listed of a note's comments, proposals and revisions is the service's, and so is
/// what changed (a `diff`); the window writes each through one action, writes no act line for a row's own press,
/// compares no two texts, and has one session type for everything written. The keys screen has no table of its
/// own: the window hands the service its rows, in one place.
#[test]
fn what_is_about_a_note_is_listed_and_diffed_by_the_service_and_written_by_one_action_each() {
    let texts = sources();
    let text = |path: &str| texts.iter().find(|(p, _)| p == path).map(|(_, text)| text.as_str()).unwrap_or_else(|| panic!("{path} is there"));
    let code = |path: &str| text(path).lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
    // Each write about a note is asked by its own action, in the one file, and nowhere else.
    for write in ["\"annotations.batch\"", "\"annotations.reply\"", "\"annotations.lifecycle\"", "\"draft.proposal.apply\"", "\"draft.proposal.dismiss\"", "\"block.revisions\""] {
        none(&format!("{write} asked outside the action that writes it (actions/review.rs; the store records who made a block)"), strays(write, |path| path == "actions/review.rs" || path == "store.rs"));
    }
    // The reads that list them are asked by nobody here: a tile asks `lists.read`, as for any list.
    none("a note's threads, proposals or revisions read by the window itself: they are lists the service answers", ["\"annotations.list\"", "\"draft.proposals.list\"", "\"proposals.outcomes\"", "\"components.schemas\""].iter().flat_map(|read| strays(read, |_| false)).collect());
    // A row's own press is the act line its cell carries: no drawer and no model writes one for it.
    none("an act line written for a row's own press: run the cell's own (`act`)", ["\"proposal.apply id=", "\"proposal.dismiss id=", "\"reply thread=", "\"resolve thread=", "\"revision.restore revision=", "format!(\"reply ", "format!(\"proposal."].iter().flat_map(|line| strays(line, |path| path == "actions/review.rs")).collect());
    for path in ["tiles/list.rs", "tiles/diff.rs", "tiles/page.rs", "tiles/prim.rs"] { for word in ["\"Apply\"", "\"Dismiss\"", "\"Reply\"", "\"Resolve\"", "\"Restore\""] { assert!(!code(path).contains(word), "{path} has {word}: a press is called what its row's cell says") } }
    // A change is drawn as served: one builder, in the registry, which compares nothing.
    assert!(code("tiles/prim.rs").contains("ty: \"diff\"") && code("tiles/prim.rs").contains("build: super::diff::build"), "the diff primitive is the registry's, built in tiles/diff.rs");
    none("a second drawer of a change", strays("\"del\"", |path| path == "tiles/diff.rs"));
    none("two texts compared in the window: the service finds what changed (`diff`)", ["fn diff(", "diff_lines", "DiffState", "FileDiff", "similar::", "from_texts"].iter().flat_map(|word| strays(word, |_| false)).collect());
    for compared in [".lines()", ".zip(", "split('\\n')", "char_indices"] { assert!(!code("tiles/diff.rs").contains(compared), "tiles/diff.rs has `{compared}`: it draws the lines it is given") }
    // One session type, whatever is written: a comment and a reply are a `DraftSession` that says what it writes,
    // shown by the one field the page drawer builds, kept in the one file.
    assert_eq!(texts.iter().map(|(_, text)| text.lines().filter(|line| !line.trim_start().starts_with("//") && line.contains("struct ") && line.contains("Session")).count()).sum::<usize>(), 1, "one session type: `draft::DraftSession`");
    none("a second editor: a comment's words are a draft's, in the field the page drawer builds", ["Composer", "CommentDraft", "ReplyDraft", "struct Comment"].iter().flat_map(|word| strays(word, |_| false)).collect());
    assert_eq!(code("tiles/page.rs").matches("keys::area(").count(), 1, "one field, for a block's text and for what is written about it");
    none("what a draft writes decided outside the session, its actions and the drawer that shows it", strays("Writes::", |path| ["draft.rs", "actions/draft.rs", "actions/review.rs"].contains(&path)));
    // A selection is told to the window by the reader that shows the words, as an act line; nothing else reads one.
    none("a selection read outside the page drawer", ["on_selection_change", ".text_selection()", "SelectionChange"].iter().flat_map(|word| strays(word, |path| path == "tiles/page.rs")).collect());
    none("the words selected written outside the action that hears them", strays(".passage = ", |path| path == "actions/review.rs" || path == "actions/app.rs"));
    // A press leaves a selection as it is in one place, the toolbar (its button that comments is pressed for the words
    // selected), and the words are let go without the reader saying so in one, the bar put away.
    none("a press that keeps the selection outside the toolbar", strays("keeps_text_selection", |path| path == "shell.rs"));
    none("the words selected let go outside the bar's own actions", calls("let_go", |path| path == "actions/bar.rs" || path == "actions/app.rs"));
    // One name a send: made in one place, and a request is named by it in one.
    none("a send named outside the session and the action that sends", calls("send_name", |path| path == "draft.rs" || path == "actions/review.rs"));
    none("a request about a note named outside the action that sends it", calls("request_id", |path| path == "actions/review.rs"));
    // Which reader a press in a list about a note means: the dispatcher's `act_from`, asking `App::home_of`.
    none("the reader a list follows chosen for an act outside the dispatcher", calls("home_of", |path| path == "actions/mod.rs" || path == "actions/app.rs"));
    // The keys screen: the rows are handed over where a list is asked, and the window keeps no list of its keys for a screen.
    assert_eq!(texts.iter().map(|(_, text)| text.matches("super::rows()").count()).sum::<usize>(), 1, "the window's action rows are handed to the service in the one place a list is asked (`App::ask_of`)");
    assert!(code("actions/app.rs").contains("ROWS => Some(super::rows().clone())"));
    // A screen's own keys: read from its spec by the key table alone, each key's name read as a chord by one reader.
    none("a screen's keys read outside the key table (`App::screen_keys`, through `Spec::keys`)", strays("[\"keys\"]", |path| path == "screen.rs").into_iter().chain(calls("screen_keys", |path| path == "keys.rs")).collect());
    none("a key's name read as a chord outside the key table", calls("chord_named", |path| path == "keys.rs"));
    none("a keys screen drawn from a table of the window's own: it is a list tile over `lists.read from=actions`", ["fn keys_screen(", "fn keys_tile(", "fn library("].iter().flat_map(|word| strays(word, |_| false)).collect());
}
