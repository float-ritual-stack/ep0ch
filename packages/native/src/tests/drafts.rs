//! A block written in place, as a person works: typed in, completed from the service's list, saved; held on the
//! service while it is open, read and patched under the caret by an agent; kept as it is typed, and found back in
//! its block after a window that ended mid-word. Everything is a key, a press or a line the host says; every
//! assertion that can be is on the wire.
use rune::{Key, Mods};
use serde_json::{Value, json};

use super::support::*;
use crate::actions::{Actor, App, Field, Tone};
use crate::draft::{self, Hold};
use crate::keys::Layer;

/// The last thing the window asked of the host by this action.
fn sent(asked: &Asked, action: &str) -> Option<Value> { asked.borrow().iter().rev().find(|a| a["action"] == action).cloned() }

/// What the service asks the holder of a draft, as its event says it (outline-core's `DraftHolderRequest`).
fn holder_ask(app: &App, kind: &str, request: &str, more: Value) -> Value {
    let mut ask = json!({ "kind": kind, "requestId": request, "holdId": "hold-plot", "blockId": "plot", "targetClientId": app.store().client() });
    for (key, value) in more.as_object().into_iter().flatten() { ask[key.as_str()] = value.clone() }
    json!({ "event": { "domain": "draft", "action": format!("draft.{kind}"), "blockId": "plot", "draft": ask } })
}

/// The service asks the holder, and what follows lands.
fn service_asks(app: &mut App, said: &Said, kind: &str, request: &str, more: Value) {
    let ask = holder_ask(app, kind, request, more);
    host_says(app, said, ask);
}

/// What the window answered the ask `request`.
fn answered(asked: &Asked, request: &str) -> Value {
    asked.borrow().iter().rev().find(|a| a["action"] == "drafts.answer" && a["requestId"] == request).cloned().unwrap_or_else(|| panic!("{request} was answered"))
}

const PLOT: &str = "Plot [type::chore]\nBefore the rain.";

#[test]
fn a_block_is_typed_in_completed_from_the_service_s_list_and_saved() {
    let g = garden(ok());
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    assert_eq!((rt.state.person().layer, words(&rt.state)), (Layer::Draft, PLOT));
    // Nothing is offered until something is typed: a block opened is only read.
    assert!(sent(&asked, "completion.rows").is_none() && rt.state.completing("reader").is_none());
    // A line, then a page's name begun: the service is asked what completes it, with the text and the caret.
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "See [[s");
    let typed_so_far = format!("{PLOT}\nSee [[s");
    let ask = sent(&asked, "completion.rows").expect("the service is asked what completes the words");
    assert_eq!((ask["text"].as_str(), ask["cursor"].as_u64(), ask["near"].as_str(), ask.get("target")), (Some(format!("{typed_so_far}]]").as_str()), Some(typed_so_far.encode_utf16().count() as u64), Some("plot"), None), "the text and the caret (the brackets came with their closers, the caret inside), never a token found here");
    // Its list is open over the block, the service's rows as it merged them, and the keys are the list's.
    let found = rt.state.completing("reader").expect("the list is open").clone();
    assert_eq!(found.rows.iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["Seed list", "Shed", "Sowing calendar"]);
    assert_eq!(rt.state.person().layer, Layer::Complete);
    // The hint row under the block's field says the keys of the layer they are in: the list's, while it is open.
    assert!(rt.find("tile/reader/editor-keys").is_some());
    let hints: Vec<String> = rt.elements().into_iter().filter_map(|e| e.text).collect();
    assert!(["put the list away", "write the lit row"].iter().all(|does| hints.iter().any(|said| said == does)) && !hints.iter().any(|said| said == "leave the editor, when everything is saved"), "the list's keys, not the draft's: {hints:?}");
    for n in 1..=3 { assert!(rt.find(&format!("tile/reader/complete-option-{n}")).is_some(), "row {n} of the list is drawn") }
    // One more letter narrows it: asked again for what is there now.
    typed(&mut rt, "h");
    assert_eq!(rt.state.completing("reader").unwrap().rows.iter().map(|row| row.label.as_str()).collect::<Vec<_>>(), ["Shed"]);
    chord(&mut rt, Key::Backspace, Mods::default());
    // Down lights the next row; Return writes it over what was typed, as one step, and the caret is after it.
    chord(&mut rt, Key::Down, Mods::default());
    assert_eq!(draft(&rt.state).unwrap().completing.lit, 1);
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), format!("{PLOT}\nSee [[shed]]"));
    assert_eq!((rt.state.person().layer, rt.state.completing("reader").is_none()), (Layer::Draft, true), "the list is put away once a row is written");
    let picked = sent(&asked, "completion.picked").expect("the choice is counted where every client's are");
    assert_eq!((picked["key"].as_str(), picked["insert"].as_str(), picked["outcome"].as_str(), picked["row"]["insertion"].as_str()), (Some("[["), Some("pick-shed"), Some("accepted"), Some("[[shed]]")));
    typed(&mut rt, " for the fork.");
    assert_eq!(words(&rt.state), format!("{PLOT}\nSee [[shed]] for the fork."), "typing goes on after what was written");
    // Escape puts a list away and leaves the words and the block; more typed opens it again; a press on a row writes it.
    typed(&mut rt, " And [[so");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((rt.state.person().layer, draft(&rt.state).is_some(), words(&rt.state).ends_with("And [[so]]")), (Layer::Draft, true, true));
    typed(&mut rt, "w");
    assert_eq!(rt.state.completing("reader").map(|found| found.rows.len()), Some(1));
    press(&mut rt, "tile/reader/complete-option-1");
    assert!(words(&rt.state).ends_with("And [[sowing-calendar]]"), "{}", words(&rt.state));
    // A name nothing has is said in the list, and Return is the field's: a line is typed, and nothing is lost.
    typed(&mut rt, " [[zz");
    assert_eq!(rt.state.completing("reader").and_then(|found| found.message.clone()).as_deref(), Some("no page by that name yet"));
    chord(&mut rt, Key::Enter, Mods::default());
    assert!(words(&rt.state).ends_with("[[zz\n"));
    // Saved as typed, the reference that names nothing included.
    chord(&mut rt, Key::Command('s'), primary());
    let saved = sent(&asked, "update").expect("the save chord saved");
    assert_eq!(saved["text"].as_str(), Some(words(&rt.state)));
    assert!(saved["text"].as_str().unwrap().contains("[[zz") && !unsaved(&rt.state) && draft(&rt.state).is_some());
}

#[test]
fn a_draft_is_held_on_the_service_answers_what_it_asks_and_takes_a_placed_patch_under_the_caret() {
    let Garden { mut app, asked, said, .. } = garden(ok());
    assert!(act(&mut app, "edit").ok);
    // Held on the service as this window, at the revision it read: an agent's patch on the note comes here now.
    let hold = sent(&asked, "drafts.hold").expect("the draft is held");
    assert_eq!((hold["blockId"].as_str(), hold["clientId"].as_str(), hold["revision"].as_u64(), hold["leaseMs"].as_u64()), (Some("plot"), Some(app.store().client()), Some(3), Some(15_000)));
    assert_eq!(draft(&app).unwrap().hold_id(), Some("hold-plot"));
    assert!(act(&mut app, "draft.paste text=\"\n\nSow the peas by the sh\"").ok);
    let typed = format!("{PLOT}\n\nSow the peas by the sh");
    assert_eq!(words(&app), typed);

    // Read: the draft as it is now, typing and all, and the line the caret is on.
    service_asks(&mut app, &said, "read", "r1", json!({}));
    assert_eq!(answered(&asked, "r1")["answer"], json!({ "text": typed, "revision": 3, "cursorLine": 3 }));

    // A patch: this window finds no passage itself. It says what it holds, and where the caret is, for the service to place it.
    service_asks(&mut app, &said, "patch", "r2", json!({ "patchId": "p1", "revision": 3, "patches": [{ "observed": "Before the rain.", "replacement": "Before the frost comes." }], "mutation": { "author": "agent", "actorId": "tidy" } }));
    let stands = answered(&asked, "r2")["answer"].clone();
    assert_eq!((stands["applied"].as_bool(), stands["draft"]["text"].as_str(), stands["draft"]["revision"].as_u64(), stands["draft"]["cursor"].as_u64(), stands["draft"]["anchor"].as_u64(), stands["draft"]["busy"].as_bool()),
        (Some(false), Some(typed.as_str()), Some(3), Some(typed.len() as u64), Some(typed.len() as u64), Some(false)));
    assert_eq!(words(&app), typed, "nothing changed yet");

    // The spans the service placed, for the text it was told: replaced under the caret, said on the tile with who, and
    // nothing of the person's is taken: the caret is still at the end of what they typed, and the field has the keys.
    let version = stands["draft"]["version"].clone();
    let (start, end) = (typed.find("Before").unwrap(), typed.find("Before").unwrap() + "Before the rain.".len());
    let place = json!({ "patchId": "p1", "version": version, "spans": [{ "start": start, "end": end, "replacement": "Before the frost comes." }], "mutation": { "author": "agent", "actorId": "tidy" }, "did": "edited text above your cursor" });
    service_asks(&mut app, &said, "place", "r3", place.clone());
    assert_eq!(answered(&asked, "r3")["answer"], json!({ "applied": true }));
    let patched = "Plot [type::chore]\nBefore the frost comes.\n\nSow the peas by the sh";
    let session = draft(&app).unwrap();
    assert_eq!((words(&app), session.buf.ends(), session.buf.takes_keys()), (patched, (patched.len(), patched.len()), true));
    assert_eq!(session.told.as_ref().map(|told| told.line()).as_deref(), Some("an agent (tidy) edited text above your cursor"));
    assert_eq!(app.agent_said.as_deref(), Some("an agent (tidy) edited text above your cursor"), "said on the status line too, as any agent's act is");
    assert_eq!(session.lit().iter().map(|lit| &patched[lit.clone()]).collect::<Vec<_>>(), ["Before the frost comes."], "what it wrote is lit until the text changes");
    assert!(unsaved(&app) && draft(&app).unwrap().revision == 3, "the saved note is as it was: the patch is in the draft");

    // The same spans again name a text that is gone (it was typed in since, here by the patch itself): refused, and the
    // window says what it holds now, for the service to place it again.
    service_asks(&mut app, &said, "place", "r4", place);
    let again = answered(&asked, "r4")["answer"].clone();
    assert_eq!((again["applied"].as_bool(), again["reason"].as_str(), again["draft"]["text"].as_str()), (Some(false), Some("the draft was typed in since it was read"), Some(patched)));
    assert_eq!(words(&app), patched);

    // A selection is the person's too: a patch above it moves both its ends with the text and keeps what is selected.
    let (from, to) = (patched.find("peas").unwrap(), patched.find("peas").unwrap() + 4);
    app.field(&Field::Draft("reader".into())).select(from, to);
    let now = draft(&app).unwrap().stands(false);
    service_asks(&mut app, &said, "place", "r5", json!({ "patchId": "p2", "version": now["version"], "spans": [{ "start": 0, "end": 4, "replacement": "The plot" }], "mutation": { "author": "agent", "actorId": "tidy" }, "did": "edited text above your cursor" }));
    let (anchor, caret) = draft(&app).unwrap().buf.ends();
    assert_eq!((answered(&asked, "r5")["answer"]["applied"].as_bool(), &words(&app)[anchor..caret]), (Some(true), "peas"));

    // A patch taken back (it didn't land everywhere): asked as a revert, placed by the service as the spans that undo it.
    service_asks(&mut app, &said, "revert", "r6", json!({ "patchId": "p2" }));
    assert_eq!((answered(&asked, "r6")["answer"]["reverted"].as_bool(), answered(&asked, "r6")["answer"]["draft"]["text"].as_str()), (Some(false), Some(words(&app))));
    let now = draft(&app).unwrap().stands(false);
    service_asks(&mut app, &said, "place", "r7", json!({ "patchId": "p2", "version": now["version"], "revert": true, "did": "An edit that didn't land everywhere was taken back out of your draft", "spans": [{ "start": 0, "end": 8, "replacement": "Plot" }] }));
    assert_eq!(draft(&app).unwrap().told.as_ref().map(|told| told.line()).as_deref(), Some("An edit that didn't land everywhere was taken back out of your draft"), "what happened is the service's word, said as sent");
    assert_eq!((answered(&asked, "r7")["answer"]["applied"].as_bool(), words(&app)), (Some(true), patched));

    // A patch the saved note took too (an agent's property stamp): the draft stands on that revision, and the hold says so.
    let stamped = "Plot [type::chore] [stage::sown]\nBefore the rain.";
    let now = draft(&app).unwrap().stands(false);
    service_asks(&mut app, &said, "place", "r8", json!({ "patchId": "p3", "version": now["version"], "spans": [{ "start": 18, "end": 18, "replacement": " [stage::sown]" }], "mutation": { "author": "agent", "actorId": "tidy" }, "did": "set a property: saved, and in your draft beside your words", "standsOn": { "revision": 4, "text": stamped } }));
    assert_eq!((draft(&app).unwrap().revision, draft(&app).unwrap().base.as_str()), (4, stamped));
    assert_eq!(sent(&asked, "drafts.heartbeat").map(|beat| (beat["holdId"].clone(), beat["revision"].clone())), Some((json!("hold-plot"), json!(4))));

    // An ask about a note this window holds no draft of is said so, never answered as if it did.
    let mut stray = holder_ask(&app, "read", "r9", json!({}));
    stray["event"]["draft"]["blockId"] = json!("shed");
    host_says(&mut app, &said, stray);
    assert!(answered(&asked, "r9")["error"].as_str().is_some_and(|why| why.contains("holds no draft of that note")));

    // Closed, by name over unsaved text: the hold is let go.
    assert!(act(&mut app, "edit.close discard=true").ok);
    assert_eq!(sent(&asked, "drafts.release").map(|release| release["holdId"].clone()), Some(json!("hold-plot")));
    assert!(draft(&app).is_none());
}

/// Time asks two things of a held draft, and `beat` is where: its hold renewed before the lease runs out, and the
/// service told the person typed once the keys have gone quiet (it reads the draft back then, and runs a request
/// line written there). Nothing is told while they type.
#[test]
fn a_held_draft_is_renewed_and_the_service_is_told_once_the_keys_go_quiet() {
    let Garden { mut app, asked, .. } = garden(ok());
    assert_eq!(app.beat(), None, "nothing is held: nothing to ask again for");
    assert!(act(&mut app, "edit").ok);
    assert_eq!(app.beat(), Some(draft::BEAT));
    assert!(act(&mut app, "draft.paste text=\" Sow\"").ok);
    assert_eq!((app.beat(), sent(&asked, "drafts.touch")), (Some(draft::QUIET / 2), None), "typed just now: asked again soon, and nothing told yet");
    std::thread::sleep(draft::QUIET + std::time::Duration::from_millis(50));
    assert_eq!(app.beat(), Some(draft::BEAT));
    assert_eq!(sent(&asked, "drafts.touch").map(|touch| touch["holdId"].clone()), Some(json!("hold-plot")));
    assert!(sent(&asked, "drafts.heartbeat").is_none(), "the lease is renewed when it is due, not before");
    // A link made again ended every hold with the old one: each draft is held again.
    let holds = || asked.borrow().iter().filter(|a| a["action"] == "drafts.hold").count();
    let before = holds();
    app.start();
    app.settle();
    assert_eq!((holds(), draft(&app).unwrap().hold_id()), (before + 1, Some("hold-plot")));
}

/// An agent's way into a draft is the service's `draft.patch`, sent from here as the agent: recorded as its own, and
/// what the service answers is said. The editor itself is never an agent's: its rows say so, and the dispatcher refuses.
#[test]
fn an_agent_s_patch_goes_through_the_service_as_the_agent_and_the_editor_stays_the_person_s() {
    let Garden { mut app, asked, .. } = garden(ok());
    assert!(act(&mut app, "edit").ok);
    let tidy = || Actor::Agent("tidy".into());
    let patch = app.act("draft.patch observed=\"Before the rain.\" replacement=\"Before the frost.\"", tidy());
    assert!(patch.ok, "{}", patch.said);
    let wire = sent(&asked, "draft.patch").expect("the patch went to the service");
    assert_eq!((wire["blockId"].as_str(), wire["revision"].as_u64(), wire["patches"][0]["observed"].as_str(), wire["patches"][0]["replacement"].as_str(), wire["mutation"]["author"].as_str(), wire["mutation"]["actorId"].as_str()),
        (Some("plot"), Some(3), Some("Before the rain."), Some("Before the frost."), Some("agent"), Some("tidy")));
    for line in ["edit", "edit.save", "edit.close discard=true", "draft.paste text=x", "complete.accept", "complete.enter", "complete.move by=1", "complete.dismiss"] {
        let refused = app.act(line, tidy());
        assert!(!refused.ok && refused.said.starts_with("the editor is the person's"), "{line}: {}", refused.said);
    }
    assert_eq!((words(&app), draft(&app).map(|d| d.buf.takes_keys())), (PLOT, Some(true)));
}

/// What the tile says of a held draft, and how each thing that ends a draft ends its hold. A hold the service
/// refuses is said on the tile with why, and writing goes on.
#[test]
fn the_tile_says_how_the_draft_is_held_and_who_changed_it() {
    let g = garden(ok());
    let (asked, said) = (g.asked.clone(), g.said.clone());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    let texts = |rt: &rune::Runtime<App>| rt.elements().into_iter().filter_map(|e| e.text).collect::<Vec<_>>().join("\n");
    assert!(texts(&rt).contains("Held on the service: an agent's edit lands here"), "{}", texts(&rt));
    let now = draft(&rt.state).unwrap().stands(false);
    let place = holder_ask(&rt.state, "place", "r1", json!({ "patchId": "p1", "version": now["version"], "spans": [{ "start": 19, "end": 35, "replacement": "Before the frost." }], "mutation": { "author": "agent", "actorId": "compost-agent" }, "did": "edited text above your cursor" }));
    said.borrow_mut().push_back(place);
    rest(&mut rt);
    assert_eq!(answered(&asked, "r1")["answer"]["applied"], true);
    assert!(texts(&rt).contains("an agent (compost-agent) edited text above your cursor"), "who changed the text is said on its tile: {}", texts(&rt));
    assert!(rt.find("tile/reader/told").is_some() && rt.find("tile/reader/held").is_some());
    assert_eq!(peeked(&rt.state)["editing"]["said"], json!({ "who": "an agent (compost-agent)", "did": "edited text above your cursor" }), "and peek says it");
}

/// The reader's facts as `peek` says them.
fn peeked(app: &App) -> Value {
    crate::control::peek(app)["screen"]["tiles"].as_array().unwrap().iter().find(|tile| tile["name"] == "reader").map(|tile| tile["facts"].clone()).unwrap()
}

/// What is typed is kept as it is typed. A window that ends without saving (it is dropped here: nothing closes the
/// draft, nothing saves it) leaves the text in its file, and the next window finds it back in its block, in the
/// tile it was written in, with the caret where it was, and says so.
#[test]
fn a_window_that_ends_mid_word_finds_the_text_back_in_its_block() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-drafts-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let kept = dir.join("native-garden.layout.json");
    let file = dir.join("native-garden.drafts.json");
    {
        let mut rt = window(garden_kept(ok(), &kept).app);
        assert!(!file.exists(), "a block that is only read keeps nothing");
        press(&mut rt, "tile/reader/edit");
        assert!(!file.exists(), "nor one opened and not typed in");
        typed(&mut rt, " Sow the pe");
        let written: Value = serde_json::from_slice(&std::fs::read(&file).expect("what is typed is kept as it is typed")).unwrap();
        assert_eq!((written["drafts"][0]["note"].as_str(), written["drafts"][0]["text"].as_str(), written["drafts"][0]["base"].as_str(), written["drafts"][0]["revision"].as_u64(), written["drafts"][0]["tile"].as_str()),
            (Some("plot"), Some("Plot [type::chore]\nBefore the rain. Sow the pe"), Some(PLOT), Some(3), Some("reader")));
        // The window ends here, mid-word.
    }
    let g = garden_kept(ok(), &kept);
    let asked = g.asked.clone();
    let mut rt = window(g.app);
    let back = draft(&rt.state).expect("the draft is back");
    assert_eq!((back.note.as_str(), rt.state.layout.name(&back.tile).as_str(), back.buf.words(), back.revision, back.unsaved()), ("plot", "reader", "Plot [type::chore]\nBefore the rain. Sow the pe", 3, true));
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Info && n.said.contains("is back in its block") && n.said.contains("saves it")), "{:?}", rt.state.notice);
    assert!(rt.find("tile/reader/source").is_some() && rt.find("tile/reader/discard").is_some(), "in its block, where it was written, with unsaved text");
    assert_eq!((rt.state.person().layer, sent(&asked, "drafts.hold").map(|hold| hold["blockId"].clone())), (Layer::Draft, Some(json!("plot"))), "the keys are in it and it is held again");
    // The word is finished where it was left, and saved at the revision the draft stands on; the file keeps it no longer.
    typed(&mut rt, "as.");
    assert_eq!(words(&rt.state), "Plot [type::chore]\nBefore the rain. Sow the peas.");
    chord(&mut rt, Key::Command('s'), primary());
    let saved = sent(&asked, "update").unwrap();
    assert_eq!((saved["text"].as_str(), saved["expectedRevision"].as_u64()), (Some("Plot [type::chore]\nBefore the rain. Sow the peas."), Some(3)));
    assert!(!file.exists(), "saved text is the service's: nothing is left to bring back");
    drop(rt);
    // A draft closed with its text dropped, by name, is not brought back either.
    let mut rt = window(garden_kept(ok(), &kept).app);
    assert!(draft(&rt.state).is_none());
    press(&mut rt, "tile/reader/edit");
    typed(&mut rt, " scrap");
    assert!(file.exists());
    press(&mut rt, "tile/reader/discard");
    assert!(draft(&rt.state).is_none() && !file.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

/// A save the service refuses over a draft that came back keeps every word with why: the note moved on while the
/// window was shut, and the text is still in front of the person, and still in the file.
#[test]
fn a_draft_brought_back_onto_a_note_that_moved_on_keeps_its_text_when_the_save_is_refused() {
    let dir = std::env::temp_dir().join(format!("ep0ch-native-drafts-moved-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let kept = dir.join("native-garden.layout.json");
    {
        let mut rt = window(garden_kept(ok(), &kept).app);
        press(&mut rt, "tile/reader/edit");
        typed(&mut rt, " Mine.");
    }
    let saves = ok();
    *saves.borrow_mut() = Err(("stale-revision", "Block changed since editing began: plot".into()));
    let mut rt = window(garden_kept(saves, &kept).app);
    chord(&mut rt, Key::Command('s'), primary());
    assert!(rt.state.notice.as_ref().is_some_and(|n| n.tone == Tone::Problem && n.said.contains("changed since you opened it")));
    assert_eq!(words(&rt.state), "Plot [type::chore]\nBefore the rain. Mine.");
    assert!(dir.join("native-garden.drafts.json").exists(), "and it is still kept");
    let _ = std::fs::remove_dir_all(&dir);
}

/// The offsets the wire counts in are UTF-16 units; the field's are bytes. A patch placed in a text with letters
/// that are more than one of either lands on the same letters.
#[test]
fn a_placed_span_lands_on_the_same_letters_whatever_they_are() {
    let text = "Crème brûlée 🍮 for the fête";
    assert_eq!((draft::utf16_of(text, text.find("for").unwrap()), draft::byte_of(text, 16), draft::byte_of(text, 14)), (16, text.find("for"), None), "an offset inside the pudding names no place");
    let Garden { mut app, asked, said, .. } = garden(ok());
    assert!(act(&mut app, "edit").ok);
    write(&mut app, text);
    let now = draft(&app).unwrap().stands(false);
    assert_eq!(now["cursor"].as_u64(), Some(text.encode_utf16().count() as u64));
    service_asks(&mut app, &said, "place", "r1", json!({ "patchId": "p1", "version": now["version"], "spans": [{ "start": 6, "end": 12, "replacement": "caramel" }, { "start": 16, "end": 19, "replacement": "à" }] }));
    assert_eq!((answered(&asked, "r1")["answer"]["applied"].as_bool(), words(&app)), (Some(true), "Crème caramel 🍮 à the fête"));
    assert_eq!(draft(&app).unwrap().buf.ends().1, words(&app).len(), "the caret is still at the end of what was typed");
    assert!(matches!(draft(&app).unwrap().hold, Hold::Held { .. }));
}

// ── how Rune's editor carries a block (PROBES.md §12 says what these found) ─────────────────────────────────────

/// A placed patch is one step of the field's own way back: the editor's undo takes it out whole and leaves the caret
/// where it was, the next undo takes back the typing before it, and redo puts both back.
#[test]
fn the_field_s_own_undo_takes_an_agent_s_patch_back_as_one_step() {
    let g = garden(ok());
    let said = g.said.clone();
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    typed(&mut rt, " One");
    let now = draft(&rt.state).unwrap().stands(false);
    said.borrow_mut().push_back(holder_ask(&rt.state, "place", "r1", json!({ "patchId": "p1", "version": now["version"], "spans": [{ "start": 19, "end": 35, "replacement": "Before the frost." }], "mutation": { "author": "agent", "actorId": "tidy" }, "did": "edited text above your cursor" })));
    rest(&mut rt);
    let at = |rt: &rune::Runtime<App>| (words(&rt.state).to_string(), draft(&rt.state).unwrap().buf.ends().1);
    assert_eq!(at(&rt), ("Plot [type::chore]\nBefore the frost. One".to_string(), 40));
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt), ("Plot [type::chore]\nBefore the rain. One".to_string(), 39), "the patch is gone, whole, and the caret is where it was before it");
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, format!("{PLOT} "), "then the word typed before it");
    chord(&mut rt, Key::Command('z'), primary());
    assert_eq!(at(&rt).0, PLOT, "then the space before the word: a step ends where a word begins");
    for _ in 0..3 { chord(&mut rt, Key::Command('z'), Mods { shift: true, ..primary() }) }
    assert_eq!(at(&rt), ("Plot [type::chore]\nBefore the frost. One".to_string(), 40), "and redo puts both back");
}

/// An agent's patch never changes what the person's keys do. A completion list they put away stays away when a
/// patch lands above it: the keys are still the draft's, and Return is still a line, never a row that an agent's
/// act brought back up under their hands.
#[test]
fn an_agent_s_patch_never_opens_the_list_the_person_put_away() {
    let g = garden(ok());
    let (asked, said) = (g.asked.clone(), g.said.clone());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "See [[s");
    assert_eq!(rt.state.person().layer, Layer::Complete);
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!(rt.state.person().layer, Layer::Draft, "put away: the keys are the draft's");
    let now = draft(&rt.state).unwrap().stands(false);
    said.borrow_mut().push_back(holder_ask(&rt.state, "place", "r1", json!({ "patchId": "p1", "version": now["version"], "spans": [{ "start": 19, "end": 35, "replacement": "Before the frost." }], "mutation": { "author": "agent", "actorId": "tidy" }, "did": "edited text above your cursor" })));
    rest(&mut rt);
    assert_eq!(answered(&asked, "r1")["answer"]["applied"], true);
    assert_eq!((rt.state.person().layer, rt.state.completing("reader").is_none()), (Layer::Draft, true), "the patch landed above, and the list is still away");
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), "Plot [type::chore]\nBefore the frost.\nSee [[s\n]]", "Return is a line, as it was before the patch (the closers that came with the brackets go down with it)");
    // What the person types opens it again, as ever.
    chord(&mut rt, Key::Backspace, Mods::default());
    typed(&mut rt, "h");
    assert_eq!((rt.state.person().layer, rt.state.completing("reader").map(|found| found.rows.len())), (Layer::Complete, Some(1)));
}

/// Marked text an input method holds is the person's and not yet typed: a patch that arrives then is turned away
/// with why (replacing text under a composition would drop it), Return is the input method's, and what it commits
/// lands where the caret was.
#[test]
fn a_patch_waits_while_an_input_method_is_composing() {
    use rune::Ime;
    let g = garden(ok());
    let (asked, said) = (g.asked.clone(), g.said.clone());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    rt.ime(Ime::Enabled);
    rt.ime(Ime::Preedit("か".into(), Some((0, 3)), Vec::new()));
    rest(&mut rt);
    assert_eq!(words(&rt.state), PLOT, "what is being composed is not text yet");
    let now = draft(&rt.state).unwrap().stands(false);
    for (kind, request, more) in [("patch", "r1", json!({ "patchId": "p1", "revision": 3, "patches": [] })), ("place", "r2", json!({ "patchId": "p1", "version": now["version"], "spans": [{ "start": 0, "end": 4, "replacement": "The plot" }] }))] {
        said.borrow_mut().push_back(holder_ask(&rt.state, kind, request, more));
        rest(&mut rt);
        let answer = answered(&asked, request)["answer"].clone();
        assert!(answer["applied"] == false && answer["reason"].as_str().unwrap().contains("composing") && answer.get("draft").is_none(), "{kind}: {answer}");
    }
    chord(&mut rt, Key::Enter, Mods::default());
    assert_eq!(words(&rt.state), PLOT, "Return mid-composition is the input method's: no line is typed");
    rt.ime(Ime::Commit("家".into()));
    rest(&mut rt);
    assert_eq!(words(&rt.state), format!("{PLOT}家"));
}

/// A block's field has no scroll of its own: it grows with its text inside the page's, and the page's scroll is the
/// one that follows the caret, so a line typed below the window's edge is in view.
#[test]
fn the_page_s_scroll_follows_the_caret_in_a_block_longer_than_the_window() {
    let mut rt = window(garden(ok()).app);
    press(&mut rt, "tile/reader/edit");
    let long: String = (0..200).map(|i| format!("- bed {i}: sow the peas and lift the onions before the frost\n")).collect();
    rt.update(|s, _| write(s, &long));
    rest(&mut rt);
    typed(&mut rt, "here");
    let (tile, field) = (rect_of(&rt, "tile/reader").unwrap(), rect_of(&rt, "tile/reader/source").unwrap());
    assert!(field[3] > tile[3] * 3.0, "the field is as tall as its text: {field:?}");
    let bottom = field[1] + field[3];
    assert!(bottom > tile[1] && bottom < tile[1] + tile[3] + 40.0, "the end of the text, where the caret is, is in the tile's view: field {field:?} in {tile:?}");
}

/// What a key costs in a long block, for the record (PROBES.md §12). `cargo test --release measure_a_long_block -- --ignored --nocapture`.
#[test]
#[ignore = "a measurement: prints, asserts nothing"]
fn measure_a_long_block() {
    for lines in [100, 300, 1000, 3000] {
        let mut rt = window(garden(ok()).app);
        press(&mut rt, "tile/reader/edit");
        let long: String = (0..lines).map(|i| format!("- bed {i}: sow the peas and lift the onions before the frost\n")).collect();
        rt.update(|s, _| write(s, &long));
        rest(&mut rt);
        let field = Field::Draft("reader".into());
        let timed = |rt: &mut rune::Runtime<App>, what: &mut dyn FnMut(&mut rune::Runtime<App>)| { let t = std::time::Instant::now(); for _ in 0..20 { what(rt) } t.elapsed().as_secs_f64() * 50.0 };
        let typing = timed(&mut rt, &mut |rt| { rt.key(rune::KeyEvent { key: Key::Text("x".into()), mods: Mods::default() }); rt.frame(1.0 / 60.0); });
        let own = { let field = field.clone(); timed(&mut rt, &mut |rt| { let field = field.clone(); rt.update(move |s, _| s.typed(&field)); }) };
        let arrow = timed(&mut rt, &mut |rt| { rt.key(rune::KeyEvent { key: Key::Left, mods: Mods::default() }); rt.frame(1.0 / 60.0); });
        let idle = timed(&mut rt, &mut |rt| { rt.frame(1.0 / 60.0); });
        eprintln!("| {lines} | {:.0} KB | {typing:.1} | {own:.2} | {arrow:.1} | {idle:.1} |", long.len() as f64 / 1024.0);
    }
}

/// A list with nothing to choose from (a name nothing has yet: only the service's word on it) takes none of the
/// keys a choice is made with: Up and Down move the caret, Tab and Return are the field's, and no action of the
/// list's runs. Escape still puts it away, before it leaves the editor.
#[test]
fn a_list_with_nothing_to_choose_from_keeps_only_escape() {
    let g = garden(ok());
    let mut rt = window(g.app);
    press(&mut rt, "tile/reader/edit");
    chord(&mut rt, Key::Enter, Mods::default());
    typed(&mut rt, "See [[zz");
    assert!(rt.state.completing("reader").is_some_and(|found| found.rows.is_empty() && found.message.is_some()), "the list says there is no such page");
    assert_eq!(rt.state.person().layer, Layer::Said);
    chord(&mut rt, Key::Escape, Mods::default());
    assert_eq!((rt.state.person().layer, rt.state.completing("reader").is_none(), draft(&rt.state).is_some()), (Layer::Draft, true, true), "Escape puts the list away and leaves the block");
    assert_eq!(crate::keys::hints(Layer::Said).first().map(|(_, does)| *does), Some("put the list away"), "a list with only a word to say: Escape is its own");
    assert_eq!(crate::keys::hints(Layer::Said)[1..], crate::keys::hints(Layer::Draft)[1..], "and every other key is the draft's still");
    typed(&mut rt, "z");
    assert_eq!(rt.state.person().layer, Layer::Said, "typed on, it says so again");
    let (steps, end) = (rt.state.steps.len(), words(&rt.state).len());
    chord(&mut rt, Key::Up, Mods::default());
    rest(&mut rt);
    assert!(draft(&rt.state).unwrap().buf.ends().1 < end - "See [[zzz".len(), "Up moved the caret to the line above: {:?}", draft(&rt.state).unwrap().buf.ends());
    assert_eq!(rt.state.steps.len(), steps, "and no action of the list's ran: {:?}", rt.state.steps.last().map(|step| (step.line(), step.said.clone())));
}
