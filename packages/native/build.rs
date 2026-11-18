// What the checkout says, read at build time so it is never a second copy to keep in step:
// - the wire protocol's number, from outline-core's protocol.ts;
// - the scenes, one for every `scenes/<name>.act` (a file of act lines).
use std::{env, fs, path::Path};

fn main() {
    let here = env::var("CARGO_MANIFEST_DIR").unwrap();
    let out = env::var("OUT_DIR").unwrap();

    let source = Path::new(&here).join("../outline-core/src/protocol.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).unwrap_or_else(|e| panic!("can't read {}: {e}", source.display()));
    let number = text
        .lines()
        .find_map(|line| line.strip_prefix("export const PROTOCOL = "))
        .and_then(|rest| rest.trim_end_matches(';').trim().parse::<u64>().ok())
        .expect("protocol.ts has no `export const PROTOCOL = <n>;` line");
    fs::write(Path::new(&out).join("protocol.rs"), format!("pub const PROTOCOL: u64 = {number};\n")).unwrap();

    let scenes = Path::new(&here).join("scenes");
    println!("cargo:rerun-if-changed={}", scenes.display());
    let mut names: Vec<String> = fs::read_dir(&scenes).map(|dir| dir.filter_map(|entry| entry.ok()?.file_name().to_str()?.strip_suffix(".act").map(str::to_string)).collect()).unwrap_or_default();
    names.sort();
    let ident = |name: &str| name.replace(|c: char| !c.is_ascii_alphanumeric(), "_");
    let mut code = String::new();
    for name in &names {
        println!("cargo:rerun-if-changed={}", scenes.join(format!("{name}.act")).display());
        code += &format!("fn scene_{}(s: &mut App) {{ s.script(include_str!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/scenes/{name}.act\"))); }}\n", ident(name));
    }
    code += &format!("static SCENES: &[(&str, fn(&mut App))] = &[{}];\n", names.iter().map(|name| format!("({name:?}, scene_{})", ident(name))).collect::<Vec<_>>().join(", "));
    fs::write(Path::new(&out).join("scenes.rs"), code).unwrap();
}
