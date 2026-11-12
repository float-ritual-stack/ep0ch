//! Probe 4's window: a real Rune window (not the test `Runtime`) that serves a control socket.
//!
//! `probe-live --control <socket path>` opens a window of two tiles and listens on the socket. One line in, one line
//! of JSON out:
//!
//! - `act <line>`: runs the line on the UI thread through `AppHandle::update`, recorded as an agent's.
//! - `state`: what the app itself knows (the half of `peek` that needs no frame).
//! - `peek`: the element tree of the next drawn frame, from `App::on_frame_drawn`.
//! - `snap <png path>`: that frame's pixels, drawn a second time into an offscreen target by a `Compositor`.
//! - `hide`, `show`, `quit`: the window's own requests.
//!
//! `tests/live_window.rs` starts it under its own Xvfb and asserts the answers.

use std::cell::RefCell;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc::{Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rune::compose::{Compositor, Frame};
use rune::render::{Offscreen, write_png};
use rune::{App, AppHandle, AppSpec, Cx, El, Runtime, TextEdit, Tx, col, row, text};
use rune_kit::{Kit, TextInput};
use serde_json::{Value, json};

struct Desk {
    title: String,
    focus: &'static str,
    field: TextEdit,
    /// Every act line that ran, with who ran it.
    ran: Vec<String>,
    /// Bumped to ask for a frame when nothing else changed.
    frames_asked: u64,
}

impl Desk {
    /// The dispatcher's stand-in: one line, one actor, one outcome. It never moves `focus` for an agent.
    fn act(&mut self, line: &str, by: &str) -> Value {
        let (verb, rest) = line.split_once(' ').unwrap_or((line, ""));
        let outcome = match verb {
            "note.title" => {
                self.title = rest.to_owned();
                json!({ "ok": true })
            }
            "tile.focus" if by == "person" => match ["beds", "seeds"].into_iter().find(|t| *t == rest) {
                Some(tile) => {
                    self.focus = tile;
                    json!({ "ok": true })
                }
                None => json!({ "ok": false, "refused": format!("no tile named {rest}") }),
            },
            "tile.focus" => json!({ "ok": false, "refused": "an agent's act never takes the person's focus" }),
            _ => json!({ "ok": false, "refused": format!("no action named {verb}") }),
        };
        self.ran.push(format!("{by}: {line}"));
        outcome
    }

    fn facts(&self) -> Value {
        json!({ "title": self.title, "focus": self.focus, "field": self.field.text, "fieldFocused": self.field.focused, "ran": self.ran })
    }
}

fn init() -> Desk {
    Desk { title: "Beds".into(), focus: "beds", field: TextEdit::default(), ran: vec![], frames_asked: 0 }
}

fn tile(s: &Desk, name: &'static str, body: El) -> El {
    col().key(format!("tile/{name}")).focusable(true).grow(1.0).h_full().padding(12.0).gap(8.0).border(if s.focus == name { 2.0 } else { 1.0 }, rune::oklch(0.55, 0.12, 250.0)).child(body)
}

fn view(s: &Desk, cx: &mut Cx<Desk>) -> El {
    let k = Kit::neutral(cx.system_dark());
    let field = TextInput::new(&s.field).placeholder("A seed").on_edit(|s: &mut Desk| &mut s.field).build(&k).key("tile/seeds/field");
    let status = s.ran.last().cloned().unwrap_or_else(|| "nothing ran yet".into());
    col()
        .w_full()
        .h_full()
        .fill(k.c.bg_base)
        .child(row().grow(1.0).min_h(0.0).gap(8.0).padding(8.0)
            .child(tile(s, "beds", text(s.title.clone()).key("tile/beds/title").font(k.ty.ui).color(k.c.text_base)))
            .child(tile(s, "seeds", field)))
        .child(text(status).key("status").color(k.c.text_base))
}

/// What the socket thread is waiting for from the UI thread's next frame.
#[derive(Default)]
struct Waiting {
    peeks: Vec<Sender<Value>>,
    snaps: Vec<(PathBuf, Sender<Value>)>,
}

/// A snap's second half: the pixels are read after the frame that copied them was submitted.
type Readback = Box<dyn FnOnce() -> Value>;

struct Snapper {
    waiting: Arc<Mutex<Waiting>>,
    readbacks: Rc<RefCell<Vec<Readback>>>,
}

impl Compositor<Desk> for Snapper {
    fn render(&mut self, f: &mut Frame<'_, Desk>) {
        let clear = f.rt.clear_color();
        f.ui.prepare(f.device, f.queue, &mut f.rt.text.atlas, &f.rt.instances, f.size);
        f.ui.draw(f.encoder, f.target, clear);
        let snaps = std::mem::take(&mut self.waiting.lock().unwrap().snaps);
        if snaps.is_empty() { return }
        // The same instances, drawn once more into a target this code owns and can read back.
        let (w, h) = f.size;
        let format = f.ui.format();
        let target = Offscreen::with_format(f.device, w, h, format);
        f.ui.draw(f.encoder, &target.view, clear);
        target.copy(f.encoder);
        let device = f.device.clone();
        let bgra = format!("{format:?}").starts_with("Bgra");
        self.readbacks.borrow_mut().push(Box::new(move || {
            let mut rgba = target.read(&device);
            if bgra { for px in rgba.chunks_exact_mut(4) { px.swap(0, 2); } }
            let mut answer = json!({ "ok": true, "width": w, "height": h, "format": format!("{format:?}") });
            for (path, reply) in snaps {
                if let Err(e) = write_png(&path, w, h, &rgba) { answer = json!({ "ok": false, "refused": e.to_string() }); }
                let _ = reply.send(answer.clone());
            }
            answer
        }));
    }
}

fn tree(rt: &Runtime<Desk>) -> Value {
    let elements: Vec<Value> = rt.elements().into_iter().filter(|e| e.key.is_some() || e.text.is_some()).map(|e| {
        json!({ "key": e.key, "path": e.path, "role": e.role, "label": e.label, "text": e.text, "rect": e.rect, "focused": e.focused })
    }).collect();
    json!({ "ok": true, "viewport": [rt.viewport.0, rt.viewport.1], "elements": elements, "facts": rt.state.facts() })
}

/// One connection: a line in, a line out, until the client hangs up.
fn serve(stream: UnixStream, handle: AppHandle<Desk>, waiting: Arc<Mutex<Waiting>>) {
    let mut out = stream.try_clone().expect("clone the control stream");
    let ask_frame = |handle: &AppHandle<Desk>| handle.update(|s, _| s.frames_asked += 1);
    for line in BufReader::new(stream).lines().map_while(Result::ok) {
        let (verb, rest) = line.split_once(' ').unwrap_or((line.as_str(), ""));
        let (tx, rx) = channel::<Value>();
        let mut wait = Duration::from_secs(10);
        match verb {
            "act" => {
                let line = rest.to_owned();
                handle.update(move |s: &mut Desk, _: &mut Tx| { let _ = tx.send(s.act(&line, "agent:probe")); });
            }
            "state" => handle.update_if(move |s: &mut Desk, _: &mut Tx| {
                let _ = tx.send(json!({ "ok": true, "facts": s.facts() }));
                false
            }),
            "peek" => {
                waiting.lock().unwrap().peeks.push(tx);
                ask_frame(&handle);
                wait = Duration::from_secs(3);
            }
            "snap" => {
                waiting.lock().unwrap().snaps.push((PathBuf::from(rest), tx));
                ask_frame(&handle);
                wait = Duration::from_secs(3);
            }
            "hide" => { handle.hide(); let _ = tx.send(json!({ "ok": true })); }
            "show" => { handle.show(); let _ = tx.send(json!({ "ok": true })); }
            "visible" => { let _ = tx.send(json!({ "ok": true, "visible": handle.is_visible() })); }
            "quit" => {
                let _ = writeln!(out, "{}", json!({ "ok": true }));
                handle.quit();
                return;
            }
            _ => { let _ = tx.send(json!({ "ok": false, "refused": format!("no verb named {verb}") })); }
        }
        let answer = rx.recv_timeout(wait).unwrap_or_else(|_| {
            // Whatever waited for a frame that never came is taken back, so a later frame answers only later asks.
            let mut w = waiting.lock().unwrap();
            w.peeks.clear();
            w.snaps.clear();
            json!({ "ok": false, "refused": format!("no frame was drawn in {} s: the window is hidden, covered or minimised", wait.as_secs()) })
        });
        if writeln!(out, "{answer}").is_err() { return }
    }
}

fn main() {
    let args = rune::extra_args();
    let socket = args.iter().position(|a| a == "--control").and_then(|i| args.get(i + 1)).cloned().expect("probe-live --control <socket path>");
    let waiting: Arc<Mutex<Waiting>> = Arc::default();
    let readbacks: Rc<RefCell<Vec<Readback>>> = Rc::default();

    let (peeks, drawn) = (waiting.clone(), readbacks.clone());
    let app = App::new(AppSpec::new("probe-live", (720.0, 420.0), init, view))
        .compositor(Snapper { waiting: waiting.clone(), readbacks: readbacks.clone() })
        // After each drawn frame, on the UI thread, with the runtime as that frame presented it.
        .on_frame_drawn(move |rt: &Runtime<Desk>| {
            for read in std::mem::take(&mut *drawn.borrow_mut()) { read(); }
            let waiters = std::mem::take(&mut peeks.lock().unwrap().peeks);
            if waiters.is_empty() { return }
            let answer = tree(rt);
            for w in waiters { let _ = w.send(answer.clone()); }
        });

    let handle = app.handle();
    let _ = std::fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).unwrap_or_else(|e| panic!("can't listen on {socket}: {e}"));
    std::thread::spawn(move || {
        for stream in listener.incoming().map_while(Result::ok) {
            let (handle, waiting) = (handle.clone(), waiting.clone());
            std::thread::spawn(move || serve(stream, handle, waiting));
        }
    });
    app.run();
}
