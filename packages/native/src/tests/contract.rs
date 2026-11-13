//! The contract tables, row for row: what the door's `apply` and `placement` answer (written down by the door's own
//! functions in `outline-core/fixtures/`), asked of `layout::apply` and `layout::place`. A row that answers
//! differently is a second layout decider: it fails here, naming the row.
use serde_json::{Map, Value, json};

use crate::layout::tree::{self, Axis, Dir, Node, Place, Policy, Rect, TileSpec};
use crate::layout::{self, At, By, Ctx, Facts, Fold, Kinds, Layout, Op, Request, Way, Wire};

fn table(name: &str) -> Value {
    let path = format!("{}/../outline-core/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))).unwrap()
}

fn text(v: &Value, k: &str) -> Option<String> { v.get(k).and_then(Value::as_str).map(str::to_string) }
fn flag(v: &Value, k: &str) -> Option<bool> { v.get(k).and_then(Value::as_bool) }
fn number(v: &Value, k: &str) -> Option<f64> { v.get(k).and_then(Value::as_f64) }
fn texts(v: &Value, k: &str) -> Vec<String> { v.get(k).and_then(Value::as_array).map(|l| l.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default() }
fn pairs(v: &Value, k: &str) -> Vec<(String, Value)> { v.get(k).and_then(Value::as_array).map(|l| l.iter().filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1)?.clone()))).collect()).unwrap_or_default() }

fn place_of(v: &Value) -> Place {
    match At::read(v).expect("a place") { At::Split { target, dir, pair, weight } => Place::Split { target, dir, pair, weight }, At::Tabs { target, index, behind } => Place::Tabs { target, index, behind }, At::Edge { dir } => Place::Edge { dir }, other => panic!("{other:?} is no place to move to") }
}

/// An operation as a row writes it. `kind_of`: the kind of a tile the row names by id alone.
fn op_of(v: &Value, kind_of: &dyn Fn(&str) -> String) -> Op {
    let tile = || text(v, "tile").unwrap_or_default();
    let spec = |id: String, kind: Option<String>| { let kind = kind.unwrap_or_else(|| kind_of(&id)); TileSpec::new(id, kind) };
    match v["op"].as_str().unwrap() {
        "open" if v.get("placement").is_some() => Op::OpenNote { request: Request::read(&v["placement"]), tile: spec(tile(), Some(text(v, "kind").unwrap_or_else(|| "reader".into()))), name: text(v, "name") },
        "open" => Op::Open { tile: spec(tile(), text(v, "kind")), name: text(v, "name"), loose: flag(v, "loose") == Some(true), alt: flag(v, "alt") == Some(true), deliberate: flag(v, "deliberate"), at: At::read(&v["at"]).expect("an at"), keys: flag(v, "keys") != Some(false), link: text(v, "link"), verb: text(v, "verb"), select_from: texts(v, "selectFrom") },
        "close" => Op::Close { tile: tile(), gone: flag(v, "gone") == Some(true), heir: flag(v, "heir") == Some(true) },
        "release" => Op::Release { tile: tile() },
        "peek.release" => Op::PeekRelease { tile: tile() },
        "replace" => Op::Replace { tile: tile(), with: spec(text(v, "with").unwrap(), text(v, "kind")), name: text(v, "name"), link: text(v, "link"), verb: text(v, "verb"), select_from: texts(v, "selectFrom") },
        "take" => Op::Take { tile: tile(), heir: v.get("heir").map(|h| (spec(text(h, "id").unwrap(), Some(kind_of(&tile()))), text(h, "name"))) },
        "group" => Op::Group { tile: text(v, "tile"), node: text(v, "node"), take: texts(v, "take"), with: spec(text(v, "with").unwrap(), text(v, "kind")), name: text(v, "name") },
        "ungroup" => Op::Ungroup {
            tile: tile(), tree: tree::revive(&v["tree"], &mut |leaf| spec(text(leaf, "id").unwrap(), None)),
            names: pairs(v, "names").into_iter().map(|(id, name)| (id, name.as_str().unwrap().to_string())).collect(),
            folds: pairs(v, "folds").into_iter().map(|(id, f)| (id, Fold { by: text(&f, "by"), flat: text(&f, "dir").as_deref() == Some("h") })).collect(),
            agents: pairs(v, "agents").into_iter().map(|(id, l)| (id, l.as_str().unwrap().to_string())).collect(),
            wires: v.get("wires").and_then(Value::as_array).map(|l| l.iter().map(|w| Wire { from: text(w, "from").unwrap(), verb: text(w, "verb").unwrap(), to: text(w, "to").unwrap(), rule: text(w, "rule") }).collect()).unwrap_or_default(),
        },
        "move" => Op::Move { tile: tile(), to: place_of(&v["to"]) },
        "swap" => Op::Swap { tile: tile(), with: text(v, "with").unwrap() },
        "float" => Op::Float { tile: tile(), at: v.get("at").and_then(At::read) },
        "place" => Op::Nudge { tile: text(v, "tile"), dx: number(v, "dx"), dy: number(v, "dy"), col: number(v, "col"), row: number(v, "row"), cols: number(v, "cols"), rows: number(v, "rows") },
        "pin" => Op::Pin { tile: tile(), on: flag(v, "on"), edge: text(v, "edge").as_deref().and_then(Dir::read), container: text(v, "container") },
        "slide" => Op::Slide { tile: tile(), open: flag(v, "open"), container: text(v, "container"), beside: flag(v, "beside") == Some(true) },
        "collapse" => Op::Collapse { tile: tile(), on: flag(v, "on"), dir: text(v, "dir") },
        "room" => Op::Room { tile: tile() },
        "alt.hold" => Op::AltHold { tile: tile() },
        "resize" => Op::Resize { split: text(v, "split"), path: text(v, "path"), border: number(v, "border").unwrap(), share: number(v, "share").unwrap() },
        "shares" => Op::Shares { split: text(v, "split").unwrap(), shares: v["shares"].as_array().unwrap().iter().filter_map(Value::as_f64).collect() },
        "grow" => Op::Grow { tile: tile(), axis: if text(v, "axis").as_deref() == Some("col") { Axis::Col } else { Axis::Row }, by: number(v, "by").unwrap() },
        "even" => Op::Even,
        "gather" => Op::Gather { tile: tile(), node: text(v, "node"), side: text(v, "side").unwrap() },
        "lock" => Op::Lock { on: flag(v, "on") },
        "agents" => Op::Agents { tile: tile(), level: text(v, "level") },
        "opened" => Op::Opened { tile: tile(), from: text(v, "from").unwrap(), typing: flag(v, "typing") == Some(true) },
        "policy" => Op::Policy { tile: text(v, "tile"), node: text(v, "node"), set: v["set"].as_object().cloned().unwrap_or_default(), clear: texts(v, "clear") },
        "link" => Op::Link { tile: tile(), to: text(v, "to"), verb: text(v, "verb"), remove: flag(v, "remove") == Some(true), rule: text(v, "rule"), across: text(v, "across") },
        "focus" => Op::Focus { tile: tile(), quiet: flag(v, "quiet") == Some(true) },
        "reveal" => Op::Reveal { tile: tile() },
        "tab" => Op::Tab { tile: tile(), by: v.get("by").and_then(Value::as_i64) },
        "zoom" => Op::Zoom { tile: tile(), on: flag(v, "on"), reach: text(v, "reach") },
        "load" => Op::Load { name: text(v, "name").unwrap(), to: None, keys: false },
        "fill" => Op::Fill {
            container: text(v, "container").unwrap(), order: texts(v, "order"),
            fresh: v.get("fresh").and_then(Value::as_array).map(|l| l.iter().map(|t| (spec(text(t, "id").unwrap(), text(t, "kind")), text(t, "name"))).collect()).unwrap_or_default(),
            drop: texts(v, "drop"), weights: pairs(v, "weights").into_iter().map(|(id, w)| (id, w.as_f64().unwrap())).collect(),
            names: pairs(v, "names").into_iter().map(|(id, n)| (id, n.as_str().unwrap().to_string())).collect(), select: texts(v, "select"),
        },
        "source" => Op::Source { container: text(v, "container").unwrap(), source: text(v, "source").unwrap() },
        "flow.widen" => Op::FlowWiden { tile: tile() },
        "flow.travel" => Op::FlowTravel { tile: tile(), dir: v["dir"].as_i64().unwrap() },
        "flow.hold" => Op::FlowHold { tile: tile(), on: flag(v, "on") },
        "rename" => Op::Rename { tile: tile(), name: text(v, "name").unwrap() },
        "names" => Op::Names,
        "remember" => Op::Remember { key: text(v, "key").unwrap(), policy: Policy::of(v.get("policy")) },
        other => panic!("the table asks an operation this window has no Op for: {other}"),
    }
}

/// The context a row is asked in: who acts and how they stand, where the person is, what each tile is.
fn ctx_of<'a>(case: &Value, actor: &Value, standing: Option<&Value>, default_person: bool, facts: &'a dyn Fn(&str) -> Facts, area: Rect, (kinds, attention): &Asked) -> Ctx<'a> {
    let agent = actor["kind"] == "agent";
    let by = if agent { By::Agent(text(actor, "id").unwrap_or_default()) } else { By::Person };
    let stands = |k: &str, default: bool| standing.and_then(|s| flag(s, k)).unwrap_or(default);
    let person = if default_person { &Value::Null } else { &case["person"] };
    let extra = &case["ctx"];
    Ctx {
        by, standing: stands("standing", !agent), keys: stands("keys", !agent), protect_typing: stands("protectTyping", agent),
        typing_in: text(person, "typingIn"), busy: flag(person, "busy") == Some(true), yolo: flag(person, "yolo") == Some(true), here: flag(person, "here"),
        facts, area, kinds: kinds.clone(), expected: extra.get("expected").cloned(), screen_host: text(extra, "screenHost"), other_names: texts(extra, "otherNames"), empties: flag(extra, "empties") == Some(true), lands: None,
        beside: extra.get("beside").and_then(Value::as_object).map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect()).unwrap_or_default(),
        opened: extra.get("opened").and_then(Value::as_object).map(|m| m.iter().map(|(k, v)| (k.clone(), texts(v, "ids"), text(v, "active"))).collect()).unwrap_or_default(),
        own: extra.get("self").map(|s| (text(s, "name").unwrap_or_default(), text(s, "chip"), text(s, "covered"))),
        home: text(extra, "home"), screen: extra.get("screen").map(|s| s.as_str().map(str::to_string)), outward: text(extra, "outward"), fresh_action: text(extra, "freshAction"),
        // (The door's own: an open makes a `reader`.)
        sprout: Some("reader".into()),
        // What gets the person's attention is the asker's own act: the table says the one its rows were asked with.
        attention: attention.clone(),
    }
}

/// A saved leaf as a row's result holds one: what the layout itself keeps of a tile.
fn lean(v: &Value) -> Value {
    match v {
        Value::Object(map) if map.get("t") == Some(&json!("leaf")) => Value::Object(map.iter().filter(|(k, _)| ["t", "kind", "name", "id", "collapsed", "agents", "altReader", "wires"].contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), lean(v))).collect()),
        Value::Array(list) => Value::Array(list.iter().map(lean).collect()),
        other => other.clone(),
    }
}

/// The layout as a row's result writes it.
fn saved(l: &Layout) -> Value {
    let mut out = match lean(&l.save()) { Value::Object(map) => map, _ => Map::new() };
    out.insert("also".into(), l.also());
    Value::Object(out)
}

/// Where two values differ: equal but for a share within 1e-9, as the tables say to compare them.
fn differs(got: &Value, want: &Value, at: &str) -> Option<String> {
    match (got, want) {
        (Value::Number(a), Value::Number(b)) => ((a.as_f64().unwrap() - b.as_f64().unwrap()).abs() > 1e-9).then(|| format!("{at}: {a}, the door says {b}")),
        (Value::Object(a), Value::Object(b)) => a.keys().chain(b.keys()).find_map(|k| match (a.get(k), b.get(k)) { (Some(x), Some(y)) => differs(x, y, &format!("{at}.{k}")), (Some(x), None) => Some(format!("{at}.{k}: {x}, which the door doesn't say")), (None, Some(y)) => Some(format!("{at}.{k}: missing; the door says {y}")), (None, None) => None }),
        (Value::Array(a), Value::Array(b)) => if a.len() != b.len() { Some(format!("{at}: {} items, the door has {}: {got} / {want}", a.len(), b.len())) } else { a.iter().zip(b).enumerate().find_map(|(i, (x, y))| differs(x, y, &format!("{at}[{i}]"))) },
        (a, b) => (a != b).then(|| format!("{at}: {a}, the door says {b}")),
    }
}

/// A row's scene as it starts: its layout read, its setup applied, the person's keys where the row says.
fn start<'a>(case: &'a Value, area: Rect, kinds: &Asked, facts: &dyn Fn(&str) -> Facts) -> Layout {
    let mut l = Layout::read(&case["layout"]);
    for step in case.get("setup").and_then(Value::as_array).into_iter().flatten() {
        let actor = step.get("actor").cloned().unwrap_or_else(|| json!({ "kind": "user" }));
        let ctx = ctx_of(case, &actor, None, true, facts, area, kinds);
        let op = op_of(&step["op"], &|id| facts(id).kind);
        l = layout::apply(&l, &op, &ctx).unwrap_or_else(|why| panic!("{}: its setup step was refused: {}", case["name"], why.reason)).layout;
    }
    if let Some(focus) = text(&case["person"], "focus") { l.focus = l.named(&focus).unwrap_or(focus) }
    l
}

fn area_of(table: &Value, case: &Value) -> Rect { Rect::read(case.get("area").unwrap_or(&table["area"])).expect("an area") }
/// What every row of a table was asked with: the tile kinds there are, and the act that gets the person's attention.
type Asked = (Option<Kinds>, Option<Way>);
fn kinds_of(table: &Value) -> Asked { (table.get("kinds").map(|k| Kinds { all: texts(k, "all"), notes: texts(k, "notes") }), table.get("attention").and_then(Way::read)) }
fn facts_of(case: &Value) -> impl Fn(&str) -> Facts + '_ { |id: &str| case["tiles"].get(id).map_or_else(|| Facts { kind: "tile".into(), ..Facts::default() }, Facts::read) }

fn applied(r: &Result<layout::Applied, layout::Refusal>, with_answer: bool) -> Value {
    match r {
        Ok(done) => { let mut out = json!({ "ok": true, "layout": saved(&done.layout) }); if with_answer { out["changed"] = json!(done.changed); out["answer"] = Value::Object(done.answer.clone()); } out }
        // A refusal is its reason and its ways out, each an act: never a key, which is each door's own to say.
        Err(why) => json!({ "ok": false, "refusal": why.json() }),
    }
}

#[test]
fn every_row_of_the_layout_contract_answers_as_the_door_does() {
    let table = table("layout-contract");
    let kinds = kinds_of(&table);
    let (mut wrong, mut asked) = (Vec::new(), 0);
    for case in table["cases"].as_array().unwrap() {
        asked += 1;
        let facts = facts_of(case);
        let area = area_of(&table, case);
        let l = start(case, area, &kinds, &facts);
        let ctx = ctx_of(case, &case["actor"], Some(&case["standing"]), false, &facts, area, &kinds);
        let op = op_of(&case["op"], &|id| facts(id).kind);
        let got = applied(&layout::apply(&l, &op, &ctx), true);
        if let Some(why) = differs(&got, &case["result"], "") { wrong.push(format!("{} ({}): {why}", case["name"], case["op"]["op"])) }
    }
    assert!(asked >= 329, "the table has its rows: {asked}");
    // What a close leaves of its note is among them: a tile here, one across an edge, and none.
    let heirs: Vec<&Value> = table["cases"].as_array().unwrap().iter().filter(|case| case["op"]["heir"] == true).collect();
    assert!(heirs.len() >= 18 && heirs.iter().any(|case| case["result"]["answer"]["heir"].is_string()) && heirs.iter().any(|case| case["result"]["answer"]["heirAcross"].is_string()) && heirs.iter().any(|case| case["result"]["answer"].get("note").is_none()), "the close that asks who keeps its note is asked every way");
    assert!(wrong.is_empty(), "{} of {asked} rows answer differently:\n{}", wrong.len(), wrong.join("\n"));
}

#[test]
fn every_row_of_the_place_contract_lands_where_the_door_lands_it() {
    let table = table("place-contract");
    let kinds = kinds_of(&table);
    let mut wrong = Vec::new();
    let rows = table["cases"].as_array().unwrap();
    for case in rows {
        let facts = |id: &str| if id == "sprout" && case["tiles"].get(id).is_none() { Facts { kind: "reader".into(), notes: true, ..Facts::default() } } else { facts_of(case)(id) };
        let area = area_of(&table, case);
        let l = start(case, area, &kinds, &facts);
        let ctx = ctx_of(case, &case["actor"], Some(&case["standing"]), false, &facts, area, &kinds);
        let landing = layout::place(&l, &Request::read(&case["request"]), &TileSpec::new("sprout", "reader"), &ctx);
        let mut lands = json!({ "tile": landing.tile, "kind": landing.kind, "why": landing.why });
        if landing.new { lands["new"] = json!(true) }
        if let Some(keeps) = &landing.keeps { lands["keeps"] = json!(keeps) }
        if let Some(Err(why)) = &landing.after { lands["refusal"] = why.json() }
        let mut got = json!({ "lands": lands, "placement": landing.placement.json() });
        if let Some(after) = &landing.after { got["after"] = applied(after, false) }
        let want: Value = Value::Object(["lands", "placement", "after"].iter().filter_map(|k| case.get(*k).map(|v| (k.to_string(), v.clone()))).collect());
        if let Some(why) = differs(&got, &want, "") { wrong.push(format!("{}: {why}", case["name"])) }
    }
    assert!(rows.len() >= 85, "the table has its rows: {}", rows.len());
    assert!(wrong.is_empty(), "{} of {} rows land differently:\n{}", wrong.len(), rows.len(), wrong.join("\n"));
}

/// Both of the door's saved forms read as one tree, and what is saved is the form written with `kids`.
#[test]
fn a_split_saved_as_ratio_a_b_reads_as_the_same_tree_as_weights_and_kids() {
    let leaf = |name: &str, kind: &str| json!({ "t": "leaf", "kind": kind, "name": name });
    let old = json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "ratio": 0.3, "a": leaf("beds", "tree"), "b": { "t": "split", "dir": "col", "ratio": 0.6, "a": leaf("bed", "reader"), "b": leaf("log", "activity") } } });
    let new = json!({ "focus": "bed", "root": { "t": "split", "dir": "row", "weights": [0.3, 0.7], "kids": [leaf("beds", "tree"), { "t": "split", "dir": "col", "weights": [0.6, 0.4], "kids": [leaf("bed", "reader"), leaf("log", "activity")] }] } });
    let (a, b) = (Layout::read(&old), Layout::read(&new));
    assert_eq!(differs(&a.save(), &b.save(), ""), None);
    assert!(matches!(a.tree(), Node::Split { kids, .. } if kids.len() == 2), "{:?}", a.tree());
    assert_eq!(a.save()["root"]["kids"][1]["kids"][0]["name"], "bed", "it saves the form written with kids");
    assert_eq!(differs(&Layout::read(&a.save()).save(), &a.save(), ""), None, "and what it saves reads back as itself");
}

/// Every row of the address table: which tile an address names among the tiles a window has, why none, or the
/// refusal when several do, as outline-core's resolver answers.
#[test]
fn every_address_names_the_tile_the_door_s_resolver_names() {
    use crate::layout::address::{Candidate, Named, named};
    let table: Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/../outline-core/fixtures/address-contract.json", env!("CARGO_MANIFEST_DIR"))).unwrap()).unwrap();
    let text = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);
    let tiles: Vec<Candidate> = table["tiles"].as_array().unwrap().iter().map(|t| Candidate {
        id: text(t, "id").unwrap(), name: text(t, "name").unwrap(), role: text(t, "role").unwrap(), slots: t["slots"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect(),
        screen: text(t, "screen").unwrap(), from: text(t, "from"), copied_from: text(t, "copiedFrom"), used_at: t.get("usedAt").and_then(Value::as_f64), where_: text(t, "where").unwrap(),
    }).collect();
    let cases = table["cases"].as_array().unwrap();
    assert!(cases.len() >= 25, "the table has its rows: {}", cases.len());
    let mut kinds = std::collections::BTreeSet::new();
    for case in cases {
        let address = case["address"].as_str().unwrap();
        let got = named(address, &tiles, case.get("from").and_then(Value::as_str));
        let (kind, want) = ["tile", "none", "refused", "name"].iter().find_map(|k| case.get(*k).map(|v| (*k, v.as_str().unwrap().to_string()))).unwrap_or_else(|| panic!("{case}"));
        kinds.insert(kind);
        let said = match got { Ok(Named::Tile(at)) => ("tile", tiles[at].id.clone()), Ok(Named::None(why)) => ("none", why), Ok(Named::Name(name)) => ("name", name), Err(why) => ("refused", why) };
        assert_eq!(said, (kind, want), "{case}");
    }
    assert_eq!(kinds.into_iter().collect::<Vec<_>>(), ["name", "none", "refused", "tile"], "every kind of answer is asked");
}

// ── outline-core's own rules, as this window ports them: every row of `core-contract.json` ─────────────────────────

/// What outline-core's `listSections` answers, asked of the one copy of it here (`ListView::sections`): the same
/// sections, in the same order, with the same rows and headers. The list drawer draws these for a tile and a page.
#[test]
fn every_list_s_sections_are_the_ones_every_renderer_draws() {
    let rows = table("core-contract")["sections"].as_array().unwrap().clone();
    assert!(rows.len() >= 6);
    for case in &rows {
        let view: crate::page::ListView = serde_json::from_value(case["list"].clone()).unwrap_or_else(|e| panic!("{}: {e}", case["name"]));
        let got: Vec<Value> = view.sections().into_iter().map(|section| {
            let head = section.head.map(|g| {
                let mut head = json!({ "name": g.name, "label": g.label });
                if let Some(glyph) = g.glyph { head["glyph"] = json!(glyph) }
                if g.counted { head["count"] = json!(g.count) }
                if let Some(note) = g.note { head["note"] = json!(note) }
                head
            });
            json!({ "head": head, "rows": section.rows.iter().map(|at| view.rows[*at].id.clone()).collect::<Vec<_>>() })
        }).collect();
        // (A header says what a renderer reads of it: its name, label, glyph, count and note.)
        let want: Vec<Value> = case["sections"].as_array().unwrap().iter().map(|section| {
            let head = section["head"].as_object().map(|head| Value::Object(head.iter().filter(|(k, _)| ["name", "label", "glyph", "count", "note"].contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()));
            json!({ "head": head, "rows": section["rows"] })
        }).collect();
        assert_eq!(json!(got), json!(want), "{}", case["name"]);
    }
}

/// Which of a screen's new-note rules applies is outline-core's `newNoteRule`, asked of `Spec::new_note` with the
/// kind a tile carries (or none): the same rule, by its place, for every row.
#[test]
fn every_new_note_rule_is_the_one_outline_core_picks() {
    let rows = table("core-contract")["newNote"].as_array().unwrap().clone();
    assert!(rows.len() >= 8);
    for case in &rows {
        let spec = if case["newNote"].is_null() { json!({}) } else { json!({ "newNote": case["newNote"] }) };
        let picked = crate::screen::Spec(&spec).new_note(case["kind"].as_str());
        let at = picked.and_then(|rule| case["newNote"].as_array().unwrap().iter().position(|r| r == rule));
        assert_eq!(json!(at), case["rule"], "{}", case["name"]);
    }
}

/// A screen opened on a target is outline-core's `targetFilled`, asked of `Spec::filled`: a tile in the tree, in a
/// tab set or among the floats carries the words; a blank argument, another argument's name or a tile the layout
/// hasn't leave the spec as it is.
#[test]
fn every_screen_opened_on_a_target_is_filled_as_outline_core_fills_it() {
    let rows = table("core-contract")["targets"].as_array().unwrap().clone();
    assert!(rows.len() >= 6);
    for case in &rows {
        let mut filled = case["spec"].clone();
        for (arg, words) in case["args"].as_object().into_iter().flatten() { filled = crate::screen::Spec(&filled).filled(arg, words.as_str().unwrap_or("")); }
        assert_eq!(filled, case["filled"], "{}", case["name"]);
    }
}

/// A question narrowed by picked values is outline-core's `selectionQuery` (the door's facets write a selection
/// with it), asked of `query::narrowed`: the same words, quotes and groups for every row.
#[test]
fn every_question_narrowed_by_picks_is_written_as_outline_core_writes_it() {
    let rows = table("core-contract")["terms"].as_array().unwrap().clone();
    assert!(rows.len() >= 8);
    for case in &rows {
        let picks: Vec<(String, String)> = case["picks"].as_array().unwrap().iter().map(|pick| (pick[0].as_str().unwrap().to_string(), pick[1].as_str().unwrap().to_string())).collect();
        assert_eq!(json!(crate::query::narrowed(case["raw"].as_str().unwrap(), &picks)), case["query"], "{} narrowed by {:?}", case["raw"], picks);
    }
}

/// Where an offset of a draft is once a patch's placed spans are replaced is outline-core's `mapCursor` (the door
/// moves its cursor by it), asked of `draft::map_cursor`: the same place for every offset of every row, so a patch
/// that lands under the caret leaves it where the door would.
#[test]
fn a_caret_beside_a_placed_patch_goes_where_outline_core_s_map_cursor_puts_it() {
    use crate::draft::{Caret, Placed, map_cursor};
    let rows = table("core-contract")["cursor"].as_array().unwrap().clone();
    assert!(rows.len() >= 8);
    for case in &rows {
        let spans: Vec<Placed> = case["spans"].as_array().unwrap().iter().map(|span| Placed {
            start: span["start"].as_u64().unwrap() as usize, end: span["end"].as_u64().unwrap() as usize, len: span["replacement"].as_str().unwrap().encode_utf16().count(),
            caret: match span["caret"].as_str() { Some("stays") => Caret::Stays, Some("apart") => Caret::Apart, _ => Caret::Moves },
        }).collect();
        for at in case["at"].as_array().unwrap() {
            let (offset, want) = (at[0].as_u64().unwrap() as usize, at[1].as_u64().unwrap() as usize);
            assert_eq!(map_cursor(offset, &spans), want, "{}: offset {offset}", case["name"]);
        }
    }
}

/// A draft's lines one level in or out is outline-core's `indentText` (the door's Tab asks the same rule of its
/// lines), asked of `draft::indent`: the same edits and the same place for the selection's two ends, for every row.
/// The table's offsets are UTF-16 units and the window's are bytes, so each is read and written both ways.
#[test]
fn a_draft_s_lines_go_a_level_in_or_out_as_outline_core_s_indent_text_moves_them() {
    use crate::draft::{byte_of, indent, utf16_of};
    let rows = table("core-contract")["indent"].as_array().unwrap().clone();
    assert!(rows.len() > 20);
    for case in &rows {
        let (name, text) = (&case["name"], case["text"].as_str().unwrap());
        let at = |v: &Value| byte_of(text, v.as_u64().unwrap() as usize).unwrap_or_else(|| panic!("{name}: an offset inside a character"));
        let did = indent(text, case["dir"] == -1, at(&case["anchor"]), at(&case["cursor"]));
        let spans: Vec<Value> = did.edits.iter().map(|(start, end, with)| json!({ "start": utf16_of(text, *start), "end": utf16_of(text, *end), "replacement": with })).collect();
        assert_eq!(json!(spans), case["spans"], "{name}: the spans");
        let mut after = text.to_string();
        for (start, end, with) in did.edits.iter().rev() { after.replace_range(*start..*end, with) }
        assert_eq!(after, case["after"]["text"].as_str().unwrap(), "{name}: the text");
        assert_eq!(json!({ "anchor": utf16_of(&after, did.anchor), "cursor": utf16_of(&after, did.caret) }), json!({ "anchor": case["after"]["anchor"], "cursor": case["after"]["cursor"] }), "{name}: the selection");
        assert_eq!(did.edits.len() as u64, case["lines"].as_u64().unwrap(), "{name}: the lines moved");
    }
}

/// A key a screen names (outline-core's `isKeyName`, the door's one name for a key) reads as a chord here: every
/// name there is, a capital as Shift with its letter. The two this window has no chord for (a modifier alone, and
/// Hyper, which no key here is) read as none, and such a key is listed and never pressed.
/// A refusal said: the reason, then its ways joined as outline-core's `whySaid` joins them (", or" for another way,
/// ", then" for one that follows, a way with no words left out). The window's `ways_said` is that rule by port.
#[test]
fn every_refusal_is_said_from_its_reason_and_its_ways_as_outline_core_says_it() {
    let rows = table("core-contract")["ways"].as_array().unwrap().clone();
    assert!(rows.len() >= 7);
    for row in &rows {
        let ways: Vec<Way> = row["why"]["ways"].as_array().unwrap().iter().map(|way| Way::read(way).expect("a way")).collect();
        let said: Vec<Option<String>> = row["said"].as_array().unwrap().iter().map(|words| words.as_str().map(str::to_string)).collect();
        // (Each way's own words are the table's: the window's are its keys and act lines, which `tests/ways.rs` asks.)
        let joined = crate::actions::ways_said(&ways, |way| ways.iter().position(|each| std::ptr::eq(each, way)).and_then(|at| said.get(at).cloned().flatten()));
        let reason = row["why"]["reason"].as_str().unwrap();
        let whole = if joined.is_empty() { reason.to_string() } else { format!("{reason} · {joined}") };
        assert_eq!(whole, row["whole"].as_str().unwrap(), "{}", row["name"]);
    }
}

/// How long something said stays up is the door's rule for its status bar (outline-core's `staysMs`): the window's
/// status line and its notice are timed by the port, row for row.
#[test]
fn what_is_said_stays_up_as_long_as_outline_core_says() {
    let rows = table("core-contract")["stays"].as_array().unwrap().clone();
    assert!(rows.len() >= 8);
    for row in rows { assert_eq!(crate::actions::stays(row["columns"].as_u64().unwrap() as usize).as_millis() as u64, row["ms"].as_u64().unwrap(), "{row}") }
}

#[test]
fn a_key_as_a_screen_names_it_reads_as_a_chord() {
    use crate::keys::chord_named;
    use rune::{Chord, ChordMod};
    let rows = table("core-contract")["keyNames"].as_array().unwrap().clone();
    assert!(rows.len() >= 40);
    for row in rows.iter().filter(|row| row["named"] == true) {
        let key = row["key"].as_str().unwrap();
        let none = key == "ctrl" || key.starts_with("hyper+");
        assert_eq!(chord_named(key).is_none(), none, "{key}");
    }
    assert_eq!(chord_named("L"), Some(Chord::parse("shift+l").unwrap()));
    assert!(chord_named("alt+L").is_some_and(|chord| chord.has(ChordMod::Alt) && chord.has(ChordMod::Shift)));
    assert_ne!(chord_named("l"), chord_named("L"));
    assert_eq!(chord_named("pgup"), Some(Chord::parse("pageup").unwrap()));
    assert_eq!(chord_named("esc"), Some(Chord::parse("escape").unwrap()));
    assert_eq!(chord_named("ctrl+l"), Some(Chord::parse("ctrl+l").unwrap()));
    assert_eq!(chord_named("+"), Some(Chord::parse("plus").unwrap()));
}

/// Who may run an action: every row of the door's actor table (`actor-contract.json`, made by its `actorRule`), asked
/// of the one check this window makes (`actions::rule`). The person, an agent, and a script's run with and without
/// the invitation the person's press minted, wherever the person is: both dispatchers answer alike whether the act
/// runs. (Why not is each door's to word.)
#[test]
fn the_actor_rule_answers_every_row_of_the_door_s_table() {
    use crate::actions::{Actor, ActionRow, rule};
    use crate::keys::{Layer, Whereabouts};
    let rows = table("actor-contract");
    let cases = rows["cases"].as_array().unwrap();
    assert!(cases.len() >= 200, "the table has its rows: {}", cases.len());
    let mut refused = 0;
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let row: ActionRow = serde_json::from_value(case["row"].clone()).unwrap_or_else(|e| panic!("{name}: its row is no action row: {e}"));
        let by = match case["actor"]["kind"].as_str() { Some("user") => Actor::Person, _ => Actor::Agent(text(&case["actor"], "id").unwrap()) };
        let at = &case["where"];
        let typing_in = text(at, "typingIn");
        let person = Whereabouts { layer: if typing_in.is_some() { Layer::Draft } else { Layer::Tile }, focus: text(at, "focus").unwrap(), busy: flag(at, "busy") == Some(true), why: text(at, "why"), typing_in, idle: number(at, "idle").map(|ms| std::time::Duration::from_millis(ms as u64)), takes_keys: false };
        let answer = rule(&row, &by, by.is_person() || flag(case, "invited") == Some(true), &person, case["tile"].as_str().unwrap());
        assert_eq!(answer.is_ok(), case["refused"].is_null(), "{name}: the door says {}, this window {answer:?}", case["refused"]);
        refused += answer.is_err() as usize;
    }
    assert!(refused >= 40, "the rows that refuse ran: {refused}");
    // Each actor of the table is asked: the person, an agent, a script uninvited and a script on a press.
    for (kind, invited) in [("user", false), ("agent", false), ("agent", true)] { assert!(cases.iter().any(|c| c["actor"]["kind"] == kind && c["invited"] == invited), "{kind}, invited {invited}") }
}
