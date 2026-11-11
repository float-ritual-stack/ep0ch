//! The link to the bridge (`bridge/main.ts`): a child process that speaks one JSON object a line. The app asks and
//! goes on drawing; a reader thread queues each answer and event and wakes the window, and `poll` takes them on the
//! UI thread. Nothing here knows what a note is.
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

type Inbox = Arc<(Mutex<VecDeque<Value>>, Condvar)>;
type Wake = Arc<Mutex<Option<rune::Waker>>>;
/// A stand-in bridge for tests: it answers each ask where it stands.
#[cfg(test)]
pub type Fake = Box<dyn FnMut(&Value) -> Result<Value, (String, String)>>;

pub struct Bridge {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    #[cfg(test)]
    fake: Option<Fake>,
    inbox: Inbox,
    wake: Wake,
    next: u64,
}

impl Bridge {
    /// Starts `bun <bridge> <args>`. A bridge that can't start says so as its first event, like any other failure.
    pub fn spawn(bun: &str, script: &str, args: &[String]) -> Bridge {
        let inbox: Inbox = Arc::default();
        let wake: Wake = Arc::default();
        let said = |inbox: &Inbox, error: String| inbox.0.lock().unwrap().push_back(json!({ "event": "fatal", "error": error }));
        let spawned = Command::new(bun).arg(script).args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(e) => {
                said(&inbox, format!("can't start the bridge ({bun} {script}): {e}"));
                return Bridge { child: None, stdin: None, #[cfg(test)] fake: None, inbox, wake, next: 0 };
            }
        };
        let stdin = child.stdin.take();
        let (out, err) = (child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let deliver = |inbox: &Inbox, wake: &Wake, v: Value| {
            inbox.0.lock().unwrap().push_back(v);
            inbox.1.notify_all();
            let w = wake.lock().unwrap().clone();
            if let Some(w) = w { w() }
        };
        {
            let (inbox, wake) = (inbox.clone(), wake.clone());
            std::thread::spawn(move || {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Ok(v) = serde_json::from_str::<Value>(&line) { deliver(&inbox, &wake, v) }
                }
                deliver(&inbox, &wake, json!({ "event": "connection", "state": "lost", "detail": "the bridge ended" }));
            });
        }
        {
            // What the bridge says on stderr before it dies is why (no outline named, no host answering).
            let (inbox, wake) = (inbox.clone(), wake.clone());
            std::thread::spawn(move || {
                let said: Vec<String> = BufReader::new(err).lines().map_while(Result::ok).collect();
                if !said.is_empty() { deliver(&inbox, &wake, json!({ "event": "stderr", "error": said.join("\n") })) }
            });
        }
        Bridge { child: Some(child), stdin, #[cfg(test)] fake: None, inbox, wake, next: 0 }
    }

    #[cfg(test)]
    pub fn fake(fake: Fake) -> Bridge {
        Bridge { child: None, stdin: None, fake: Some(fake), inbox: Arc::default(), wake: Arc::default(), next: 0 }
    }

    /// What the bridge would say unasked (a change in the outline, a lost connection), for a test to land.
    #[cfg(test)]
    pub fn say(&self, event: Value) { self.inbox.0.lock().unwrap().push_back(event) }

    pub fn set_waker(&self, waker: rune::Waker) { *self.wake.lock().unwrap() = Some(waker) }

    /// Sends an ask and returns its id; the answer comes through `drain` (or `wait`).
    pub fn ask(&mut self, mut ask: Value) -> u64 {
        self.next += 1;
        let id = self.next;
        ask["id"] = json!(id);
        #[cfg(test)]
        if let Some(fake) = &mut self.fake {
            let answer = match fake(&ask) {
                Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                Err((kind, error)) => json!({ "id": id, "ok": false, "kind": kind, "error": error }),
            };
            self.inbox.0.lock().unwrap().push_back(answer);
            return id;
        }
        let sent = match &mut self.stdin {
            Some(stdin) => writeln!(stdin, "{ask}").and_then(|()| stdin.flush()).map_err(|e| format!("the bridge is gone: {e}")),
            None => Err("no bridge is running".to_string()),
        };
        if let Err(error) = sent {
            self.inbox.0.lock().unwrap().push_back(json!({ "id": id, "ok": false, "kind": "unavailable", "error": error }));
        }
        id
    }

    /// Everything that has arrived, oldest first.
    pub fn drain(&self) -> Vec<Value> { self.inbox.0.lock().unwrap().drain(..).collect() }

    /// Waits until the answer to `id` is in the inbox (left there for `drain`), or `timeout` passes: for a headless
    /// render, which has no later frame to land an answer in.
    pub fn wait(&self, id: u64, timeout: Duration) -> bool {
        let until = Instant::now() + timeout;
        let mut inbox = self.inbox.0.lock().unwrap();
        loop {
            let fatal = |v: &Value| v["event"] == "fatal" || v["state"] == "lost";
            if inbox.iter().any(|v| v["id"].as_u64() == Some(id) || fatal(v)) { return true }
            let left = until.saturating_duration_since(Instant::now());
            if left.is_zero() { return false }
            inbox = self.inbox.1.wait_timeout(inbox, left).unwrap().0;
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        // Closing its stdin is how the bridge is told to finish; it is this process's own child.
        self.stdin = None;
        if let Some(child) = &mut self.child { let _ = child.wait(); }
    }
}
