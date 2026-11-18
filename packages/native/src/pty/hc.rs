//! herdr-core (`hc`), asked the three things the terminal's crates don't ask it: to start a terminal that outlives
//! what started it, at the size its tile has; to list every terminal it keeps with what each reports of itself;
//! and to end one. Attaching is Moonframe's (`moonframe.rs`): its backend finds a terminal by the labels this
//! writes on it, and streams it.
//!
//! - **Why this is here, beside the client Moonframe brings.** That client's `terminal.run` carries no
//!   `outlive_parent`, `no_parent` or `size`, lists through a connection it keeps to itself, and ends nothing; and
//!   Moonframe hands out no way to its connection. The manual `hc --skill` prints says a terminal ends with its
//!   parent unless it is started to outlive it, that an API client that knows its pane's size says so when it
//!   runs one, and that how a program stands is what it reported (OSC 7501), read from the core's list. So those
//!   three calls are made here, as plain requests on a connection of their own, opened for each call.
//! - **The protocol**, as herdr-gpui's client speaks it (`sheprd-core-client`: `connection.rs`, `frame.rs`,
//!   `endpoint.rs`): a `hello` as one JSON line each way, then frames `[channel u32 LE][kind u8][len u32 LE][payload]`
//!   with JSON-RPC on channel 0. No stream channel is opened here, so no credit is owed and nothing arrives unasked.
//! - **Where the core listens** is found as `hc` finds it: `HC_SOCKET`, else `socket` in its config, else the
//!   user's runtime folder, else beside the session's state (`HC_SESSION`, `default` when unset). The same rule
//!   Moonframe's client follows, written a second time because that one can't be reached from here.
//! - **Nothing here starts, stops or restarts a core.** Moonframe's backend starts one when `hc` is installed and
//!   none runs; this only joins it.
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

/// The protocol generation spoken (herdr-gpui's client: `hello.rs`).
const GENERATION: u32 = 1;
/// A frame's header, and the kind that carries a JSON-RPC message on channel 0.
const HEADER: usize = 9;
const DATA: u8 = 0;
/// How long a call waits for its answer: the window's thread makes some of them.
const ANSWER: Duration = Duration::from_secs(3);

/// Where one core session listens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    pub socket: PathBuf,
    pub session: String,
}

impl Endpoint {
    /// The endpoint in an environment read through `var`; `run_user` is `/run/user/<uid>` where that folder is,
    /// and `config` reads herdr-core's `config.toml` when there is one.
    pub fn found_in(var: &dyn Fn(&str) -> Option<OsString>, run_user: Option<PathBuf>, config: &dyn Fn(&Path) -> Option<String>) -> Option<Endpoint> {
        let set = |name: &str| var(name).filter(|value| !value.is_empty());
        let session = set("HC_SESSION").map(|raw| raw.to_string_lossy().trim().to_string()).filter(|name| !name.is_empty()).unwrap_or_else(|| "default".to_string());
        if session == "." || session == ".." || session.chars().any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c)) { return None }
        let home = set("HOME").map(PathBuf::from);
        let state_home = set("XDG_STATE_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|home| home.join(".local/state")))?;
        let config_home = set("XDG_CONFIG_HOME").map(PathBuf::from).or_else(|| home.as_ref().map(|home| home.join(".config")))?;
        let configured = || config(&config_home.join("herdr-core").join("config.toml")).and_then(|text| socket_in(&text));
        let socket = set("HC_SOCKET").map(PathBuf::from).or_else(configured).unwrap_or_else(|| {
            let name = format!("{session}.sock");
            match set("XDG_RUNTIME_DIR").map(PathBuf::from).or(run_user) {
                Some(run) => run.join("herdr-core").join(name),
                None => state_home.join("herdr-core").join(&session).join(name),
            }
        });
        Some(Endpoint { socket, session })
    }

    /// The endpoint in this process's environment.
    pub fn found() -> Option<Endpoint> {
        use std::os::unix::fs::MetadataExt;
        // (The user's id is the owner of the process's own folder: no call for it without a crate.)
        let run_user = std::fs::metadata("/proc/self").ok().map(|own| PathBuf::from(format!("/run/user/{}", own.uid()))).filter(|dir| dir.is_dir());
        Endpoint::found_in(&|name| std::env::var_os(name), run_user, &|path| std::fs::read_to_string(path).ok())
    }
}

/// `socket = "<path>"` at the top of herdr-core's config (a config `hc` cannot read is ignored there too).
fn socket_in(config: &str) -> Option<PathBuf> {
    for line in config.lines().map(str::trim) {
        // A table's own keys are not the top's.
        if line.starts_with('[') { return None }
        let Some(value) = line.strip_prefix("socket").map(str::trim_start).and_then(|rest| rest.strip_prefix('=')) else { continue };
        let value = value.split('#').next().unwrap_or("").trim();
        let unquoted = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))?;
        return Some(PathBuf::from(unquoted));
    }
    None
}

/// What a terminal reports of itself (one OSC 7501 report, in the program's own words).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub state: String,
    pub msg: String,
}

/// A terminal as the core lists it (`terminal.list`): the fields this window reads.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Terminal {
    /// `t7` here, `box/t7` on a machine the core added.
    pub address: String,
    pub name: Option<String>,
    pub labels: BTreeMap<String, String>,
    /// `live` or `finished`.
    pub state: String,
    pub status: Option<Status>,
    /// What runs in front now, else what it was started with.
    pub runs: String,
    pub cwd: String,
    pub parent: Option<String>,
}

impl Terminal {
    fn read(v: &Value) -> Option<Terminal> {
        let text = |v: &Value| v.as_str().unwrap_or("").to_string();
        let words = |v: &Value| v.as_array().map(|argv| argv.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default();
        let front = &v["foreground"];
        Some(Terminal {
            address: v["address"].as_str()?.to_string(),
            name: v["name"].as_str().map(str::to_string),
            labels: v["labels"].as_object().into_iter().flatten().filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string()))).collect(),
            state: text(&v["state"]),
            status: v["status"]["state"].as_str().map(|state| Status { state: state.to_string(), msg: text(&v["status"]["msg"]) }),
            runs: [words(&front["argv"]), text(&front["name"]), words(&v["argv"]), text(&v["title"])].into_iter().find(|said| !said.is_empty()).unwrap_or_default(),
            cwd: [text(&front["cwd"]), text(&v["cwd"])].into_iter().find(|cwd| !cwd.is_empty()).unwrap_or_default(),
            parent: v["parent"].as_str().map(str::to_string),
        })
    }

    pub fn live(&self) -> bool { self.state == "live" }
}

/// What `terminal.run` is asked: the machine's own shell (no `argv`, no `line`) in a terminal that is nobody's
/// child and outlives whatever started it, at the size its tile has.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Run {
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub labels: BTreeMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

impl Run {
    fn params(&self) -> Value {
        let mut params = json!({ "labels": self.labels, "size": { "cols": self.cols.max(1), "rows": self.rows.max(1) }, "no_parent": true, "outlive_parent": true });
        if let Some(name) = &self.name { params["name"] = json!(name) }
        if let Some(cwd) = &self.cwd { params["cwd"] = json!(cwd) }
        params
    }
}

/// One connection to a core, for one or a few calls.
pub struct Core {
    stream: UnixStream,
    next: u64,
}

impl Core {
    /// Joins a running core. One that is not running is an error: this never starts one.
    pub fn connect(endpoint: &Endpoint) -> Result<Core, String> {
        let mut stream = UnixStream::connect(&endpoint.socket).map_err(|e| format!("herdr-core is not listening at {}: {e}", endpoint.socket.display()))?;
        stream.set_read_timeout(Some(Duration::from_millis(50))).and_then(|()| stream.set_write_timeout(Some(ANSWER))).map_err(|e| e.to_string())?;
        let hello = json!({ "jsonrpc": "2.0", "id": 0, "method": "hello", "params": { "framed": true, "generation": GENERATION } });
        stream.write_all(format!("{hello}\n").as_bytes()).and_then(|()| stream.flush()).map_err(|e| e.to_string())?;
        // The answer is one line; whatever was read past it would be a frame's start, and none comes unasked.
        let (until, mut line) = (Instant::now() + ANSWER, Vec::new());
        let mut byte = [0u8; 1];
        while !line.ends_with(b"\n") {
            if Instant::now() > until { return Err("herdr-core did not answer the handshake".into()) }
            match stream.read(&mut byte) { Ok(0) => return Err("herdr-core closed the connection".into()), Ok(_) => line.push(byte[0]), Err(e) if waiting(&e) => {}, Err(e) => return Err(e.to_string()) }
        }
        let answer: Value = serde_json::from_slice(&line).map_err(|e| format!("herdr-core's handshake doesn't read: {e}"))?;
        let result = answered(&answer)?;
        if result["framed"] != true { return Err("herdr-core did not switch to framed mode".into()) }
        if result["generation"].as_u64().is_some_and(|theirs| theirs > u64::from(GENERATION)) { return Err(format!("herdr-core speaks protocol generation {}: this window speaks {GENERATION}", result["generation"])) }
        Ok(Core { stream, next: 1 })
    }

    /// One call on channel 0, and its answer.
    fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next;
        self.next += 1;
        let payload = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string().into_bytes();
        let mut frame = Vec::with_capacity(HEADER + payload.len());
        frame.extend_from_slice(&0u32.to_le_bytes());
        frame.push(DATA);
        frame.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        frame.extend_from_slice(&payload);
        self.stream.write_all(&frame).and_then(|()| self.stream.flush()).map_err(|e| format!("{method}: {e}"))?;
        let until = Instant::now() + ANSWER;
        loop {
            let (channel, kind, payload) = self.frame(until).map_err(|why| format!("{method}: {why}"))?;
            if channel != 0 || kind != DATA { continue }
            let message: Value = serde_json::from_slice(&payload).map_err(|e| format!("{method}: an answer that doesn't read: {e}"))?;
            if message["id"].as_u64() == Some(id) { return answered(&message).cloned().map_err(|why| format!("{method}: {why}")) }
        }
    }

    fn frame(&mut self, until: Instant) -> Result<(u32, u8, Vec<u8>), String> {
        let mut header = [0u8; HEADER];
        self.fill(&mut header, until)?;
        let len = u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as usize;
        if len > 16 << 20 { return Err(format!("a {len}-byte frame is over herdr-core's own limit")) }
        let mut payload = vec![0u8; len];
        self.fill(&mut payload, until)?;
        Ok((u32::from_le_bytes([header[0], header[1], header[2], header[3]]), header[4], payload))
    }

    fn fill(&mut self, into: &mut [u8], until: Instant) -> Result<(), String> {
        let mut at = 0;
        while at < into.len() {
            if Instant::now() > until { return Err("herdr-core did not answer in time".into()) }
            match self.stream.read(&mut into[at..]) { Ok(0) => return Err("herdr-core closed the connection".into()), Ok(read) => at += read, Err(e) if waiting(&e) => {}, Err(e) => return Err(e.to_string()) }
        }
        Ok(())
    }

    /// Every live terminal the core keeps: this machine's, then each connected machine's.
    pub fn list(&mut self) -> Result<Vec<Terminal>, String> {
        let listed = self.call("terminal.list", json!({ "all": false }))?;
        Ok(listed["terminals"].as_array().into_iter().flatten().filter_map(Terminal::read).filter(Terminal::live).collect())
    }

    /// Starts a terminal: its address.
    pub fn run(&mut self, run: &Run) -> Result<String, String> {
        let started = self.call("terminal.run", run.params())?;
        started["address"].as_str().map(str::to_string).ok_or_else(|| "terminal.run answered no address".to_string())
    }

    /// Ends a terminal's program (the core hangs up, then escalates).
    pub fn kill(&mut self, address: &str) -> Result<(), String> { self.call("terminal.kill", json!({ "terminal": address })).map(drop) }
}

fn waiting(error: &std::io::Error) -> bool { matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut | std::io::ErrorKind::Interrupted) }

/// A JSON-RPC answer's result, or the core's refusal in its own words (`{error: {message, data: {kind, hint}}}`).
fn answered(message: &Value) -> Result<&Value, String> {
    match message.get("error") {
        Some(error) => Err([error["message"].as_str(), error["data"]["hint"].as_str()].into_iter().flatten().collect::<Vec<_>>().join(" · ")),
        None => Ok(&message["result"]),
    }
}

/// A terminal name the core takes for `key` (1 to 32 of `a-z 0-9 - _ .`, starting with a letter or digit, and not
/// shaped like an address): what reads in `hc ls`. None when none fits: the labels find it either way.
pub fn name_for(key: &str) -> Option<String> {
    let name: String = key.chars().map(|c| match c.to_ascii_lowercase() { c @ ('a'..='z' | '0'..='9' | '-' | '_') => c, '/' | '.' => '.', _ => '-' }).take(32).collect();
    let first = name.chars().next()?;
    let like_address = first == 't' && name.len() > 1 && name[1..].chars().all(|c| c.is_ascii_digit());
    (first.is_ascii_alphanumeric() && !like_address).then_some(name)
}
