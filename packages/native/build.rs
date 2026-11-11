// The wire protocol this app speaks is the checkout's own: read from outline-core's protocol.ts at build time, so a
// bump there is a rebuild here and never a second number to keep in step.
use std::{env, fs, path::Path};

fn main() {
    let source = Path::new(&env::var("CARGO_MANIFEST_DIR").unwrap()).join("../outline-core/src/protocol.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).unwrap_or_else(|e| panic!("can't read {}: {e}", source.display()));
    let number = text
        .lines()
        .find_map(|line| line.strip_prefix("export const PROTOCOL = "))
        .and_then(|rest| rest.trim_end_matches(';').trim().parse::<u64>().ok())
        .expect("protocol.ts has no `export const PROTOCOL = <n>;` line");
    fs::write(Path::new(&env::var("OUT_DIR").unwrap()).join("protocol.rs"), format!("pub const PROTOCOL: u64 = {number};\n")).unwrap();
}
