//! Probe 4: can a LIVE window (not only the test `Runtime`) return its element tree and a PNG, for `peek` and `snap`
//! over a control socket, and what does `AppHandle::update` offer for running an act line from another thread?
//!
//! The window is `src/bin/probe-live.rs`. This test starts an X server of its own (Xvfb) and the window on it, then
//! talks to the window's control socket as `ep0ch act --door native` would. It needs Xvfb, libxkbcommon-x11 and a
//! Vulkan driver (`VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json` for lavapipe), so it is ignored by default:
//!
//! ```text
//! cargo test --test live_window -- --ignored --nocapture
//! ```

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use ep0ch_native_probes::median_max;
use serde_json::Value;

/// A process this test started, stopped by its own pid when dropped: a start that fails part way (no Vulkan driver,
/// no libxkbcommon-x11) leaves nothing running behind it.
struct Kid(Child);

impl Drop for Kid {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The window and its X server: both this test's own children. The window is stopped first, then its server.
struct Live {
    window: Kid,
    /// Held for its drop, which stops the server.
    _xvfb: Kid,
    control: BufReader<UnixStream>,
    dir: PathBuf,
}

impl Live {
    fn start() -> Live { Live::try_start("--control").unwrap_or_else(|(why, _)| panic!("{why}")) }

    /// Starts the X server and the window, which is given the socket's path after `flag`. When the window ends or
    /// never serves the socket, answers why, with the X server's pid so a test can see it was stopped.
    fn try_start(flag: &str) -> Result<Live, (String, u32)> {
        let dir = std::env::temp_dir().join(format!("ep0ch-probe-live-{}-{flag}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // -displayfd: the server picks a free display and writes its number, so nothing guesses one.
        let mut xvfb = Kid(Command::new("Xvfb")
            .args(["-displayfd", "1", "-screen", "0", "1280x800x24", "-nolisten", "tcp"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("Xvfb starts (install xvfb to run this probe)"));
        let mut display = String::new();
        BufReader::new(xvfb.0.stdout.take().unwrap()).read_line(&mut display).unwrap();
        let socket = dir.join("native.sock");
        let mut window = Kid(Command::new(env!("CARGO_BIN_EXE_probe-live"))
            .args([flag, socket.to_str().unwrap()])
            .env("DISPLAY", format!(":{}", display.trim()))
            .env_remove("WAYLAND_DISPLAY")
            .env("VK_ICD_FILENAMES", std::env::var("VK_ICD_FILENAMES").unwrap_or_else(|_| "/usr/share/vulkan/icd.d/lvp_icd.json".into()))
            .stderr(Stdio::inherit())
            .spawn()
            .expect("the window starts"));
        let deadline = Instant::now() + Duration::from_secs(60);
        // Returning drops both children, which stops them.
        let failed = |why: String, xvfb: &Kid| {
            let _ = std::fs::remove_dir(&dir);
            Err((why, xvfb.0.id()))
        };
        let stream = loop {
            if let Ok(s) = UnixStream::connect(&socket) { break s }
            // A window that ended will never serve: say so now, not when the minute is up.
            if let Some(status) = window.0.try_wait().unwrap() { return failed(format!("the window ended ({status}) before it served {}", socket.display()), &xvfb) }
            if Instant::now() > deadline { return failed(format!("the window never served {}", socket.display()), &xvfb) }
            std::thread::sleep(Duration::from_millis(50));
        };
        Ok(Live { window, _xvfb: xvfb, control: BufReader::new(stream), dir })
    }

    /// One line to the window, its one line of JSON back, and how long that took.
    fn ask(&mut self, line: &str) -> (Value, f64) {
        let t = Instant::now();
        writeln!(self.control.get_mut(), "{line}").unwrap();
        let mut answer = String::new();
        self.control.read_line(&mut answer).unwrap();
        (serde_json::from_str(&answer).unwrap_or_else(|e| panic!("{line}: {e}: {answer}")), t.elapsed().as_secs_f64() * 1000.0)
    }

    fn element(&mut self, key: &str) -> Value {
        let (tree, _) = self.ask("peek");
        assert_eq!(tree["ok"], true, "{tree}");
        tree["elements"].as_array().unwrap().iter().find(|e| e["key"] == key).unwrap_or_else(|| panic!("nothing in the live tree is keyed {key}")).clone()
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        // The window first, so it writes nothing more into the folder; its `Kid` and the server's stop them again
        // after this, which does nothing.
        let _ = self.window.0.kill();
        let _ = self.window.0.wait();
        let _ = std::fs::remove_file(self.dir.join("native.sock"));
        for name in ["one.png", "two.png", "hidden.png"] { let _ = std::fs::remove_file(self.dir.join(name)); }
        let _ = std::fs::remove_dir(&self.dir);
    }
}

/// Width and height from a PNG's header, after checking it is one.
fn png_size(path: &Path) -> (u32, u32) {
    let mut head = [0u8; 24];
    std::fs::File::open(path).unwrap().read_exact(&mut head).unwrap();
    assert_eq!(&head[..8], b"\x89PNG\r\n\x1a\n", "{} is a PNG", path.display());
    (u32::from_be_bytes(head[16..20].try_into().unwrap()), u32::from_be_bytes(head[20..24].try_into().unwrap()))
}

#[test]
#[ignore = "needs Xvfb, libxkbcommon-x11 and a Vulkan driver: cargo test --test live_window -- --ignored"]
fn a_live_window_answers_act_peek_and_snap_over_its_control_socket() {
    let mut live = Live::start();

    // act: a line run on the UI thread by AppHandle::update, from the socket's thread.
    let (state, _) = live.ask("state");
    assert_eq!(state["facts"]["title"], "Beds");
    let (outcome, _) = live.ask("act note.title Onions");
    assert_eq!(outcome["ok"], true);
    let (state, _) = live.ask("state");
    assert_eq!(state["facts"]["title"], "Onions");
    assert_eq!(state["facts"]["ran"][0], "agent:probe: note.title Onions", "recorded as the agent's");
    // An agent's act takes no focus: the dispatcher refuses the one line that would.
    let (refused, _) = live.ask("act tile.focus seeds");
    assert_eq!(refused["ok"], false);
    assert_eq!(live.ask("state").0["facts"]["focus"], "beds");

    // peek: the element tree of a frame the window really drew, with the keys a test Runtime gives.
    let title = live.element("tile/beds/title");
    assert_eq!(title["text"], "Onions");
    assert_eq!(title["role"], "text");
    let rect = title["rect"].as_array().unwrap();
    assert!(rect[2].as_f64().unwrap() > 0.0 && rect[3].as_f64().unwrap() > 0.0, "{title}");
    assert_eq!(live.element("status")["text"], "agent:probe: tile.focus seeds", "and the screen says who acted");
    assert!(live.element("tile/seeds/field")["path"].as_str().unwrap().ends_with("tile/seeds/tile/seeds/field"));

    // snap: the same frame's pixels as a PNG, and a different PNG once an act changed the screen.
    let (one, two, hidden) = (live.dir.join("one.png"), live.dir.join("two.png"), live.dir.join("hidden.png"));
    let (snap, _) = live.ask(&format!("snap {}", one.display()));
    assert_eq!(snap["ok"], true, "{snap}");
    assert_eq!(png_size(&one), (snap["width"].as_u64().unwrap() as u32, snap["height"].as_u64().unwrap() as u32));
    assert_eq!(png_size(&one), (720, 420), "the window's points at scale 1");
    live.ask("act note.title Leeks and a long row of shallots");
    assert_eq!(live.ask(&format!("snap {}", two.display())).0["ok"], true);
    assert_ne!(std::fs::read(&one).unwrap(), std::fs::read(&two).unwrap(), "the second picture shows the new title");

    // What each costs, from a client's side of the socket.
    let acts: Vec<f64> = (0..100).map(|i| live.ask(&format!("act note.title Bed {i}")).1).collect();
    let peeks: Vec<f64> = (0..20).map(|_| live.ask("peek").1).collect();
    let snaps: Vec<f64> = (0..20).map(|_| live.ask(&format!("snap {}", two.display())).1).collect();
    let ((act, act_worst), (peek, peek_worst), (snap, snap_worst)) = (median_max(acts), median_max(peeks), median_max(snaps));
    println!("live window over its control socket: act median {act:.2} ms (worst {act_worst:.2}), peek median {peek:.2} ms (worst {peek_worst:.2}), snap median {snap:.2} ms (worst {snap_worst:.2})");

    // A hidden window draws no frame: acts and state still answer, the tree and the picture do not.
    live.ask("hide");
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(live.ask("act note.title Hidden beds").0["ok"], true, "AppHandle::update runs while no window shows");
    assert_eq!(live.ask("state").0["facts"]["title"], "Hidden beds");
    let (peek, _) = live.ask("peek");
    assert_eq!(peek["ok"], false, "{peek}");
    assert!(peek["refused"].as_str().unwrap().contains("no frame was drawn"));
    assert_eq!(live.ask(&format!("snap {}", hidden.display())).0["ok"], false);
    assert!(!hidden.exists());
    live.ask("show");
    assert_eq!(live.element("tile/beds/title")["text"], "Hidden beds", "shown again, the tree is back with what ran meanwhile");

    // quit: the app's own way out, and the process ends by itself.
    assert_eq!(live.ask("quit").0["ok"], true);
    let deadline = Instant::now() + Duration::from_secs(10);
    while live.window.0.try_wait().unwrap().is_none() {
        assert!(Instant::now() < deadline, "the window quit when asked");
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(live.window.0.try_wait().unwrap().unwrap().success());
}

#[test]
#[ignore = "needs Xvfb: cargo test --test live_window -- --ignored"]
fn a_window_that_ends_before_it_serves_fails_at_once_and_leaves_no_x_server_running() {
    let t = Instant::now();
    // The window reads its socket's path after `--control`; given another flag it ends before it opens anything.
    let Err((why, xvfb)) = Live::try_start("--no-control") else { panic!("a window with no control socket served one") };
    assert!(why.contains("the window ended"), "{why}");
    assert!(t.elapsed() < Duration::from_secs(20), "said when the window ended, not when the minute was up: {:?}", t.elapsed());
    assert!(!Path::new(&format!("/proc/{xvfb}")).exists(), "the X server this test started (pid {xvfb}) is still running");
}
