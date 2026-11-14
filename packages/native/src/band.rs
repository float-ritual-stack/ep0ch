//! A heading style's glyph track, as cells: what a band is drawn in and what a track is one row of (the door's
//! `figures/banner.ts`, its `cell` rule ported once; no Rune here). The service says which pattern (a `band` or a
//! `track` primitive's `pattern`); this says what each cell of a row holds, and `tiles/band.rs` draws the cells.
//! The same text draws the same band every time: the pattern is seeded by the words it is drawn for.

/// What one cell of a track holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    Blank,
    /// A shade of the track's own dim, 1 (lightest) to 3.
    Shade(u8),
    /// A small dot in the track's dim.
    Dot,
    /// A mark in the page's ink: an uptime strip's down day, a bright dot.
    Mark,
    /// A ruled line across the cell, single or doubled.
    Line,
    Double,
}

/// The door's small stable hash (`Math.imul` and `>>>` on 32 bits).
fn hash(xs: &[u32]) -> u32 {
    let mut h: u32 = 0x9e37_79b9;
    for x in xs { h = (h ^ x).wrapping_mul(0x85eb_ca6b); h ^= h >> 13; h = h.wrapping_mul(0xc2b2_ae35); h ^= h >> 16; }
    h
}

/// What a pattern is drawn from: the words it stands for, so it stays put.
pub fn seed_of(words: &str) -> u32 { words.chars().fold(7, |h, ch| hash(&[h, ch as u32])) }

/// How far each row's run goes, as a share of the room it fades across, by how many rows the band has.
const RUNS: [&[f32]; 3] = [&[0.75], &[0.8, 0.55], &[0.85, 0.6, 0.35]];

/// The share of its room row `r` of `rows` runs across before it thins out.
pub fn run(rows: usize, r: usize) -> f32 { let rows = rows.clamp(1, 3); RUNS[rows - 1][r.min(rows - 1)] }

/// One cell: row `r` of `rows`, column `c` counted from the edge the row fades from, `fade` how far into the row's
/// run the cell is (0 at that edge, 1 at the run's end, past it sparse dots). The heaviest shade is 3 (2 for a
/// heading deeper than `###`). A pattern nobody here knows is a ruled line.
pub fn cell(pattern: &str, rows: usize, r: usize, c: usize, fade: f32, level: u64, seed: u32) -> Ink {
    let top: i64 = if level <= 3 { 3 } else { 2 };
    let shade = |s: i64| Ink::Shade(s.clamp(1, top) as u8);
    let (r32, c32) = (r as u32, c as u32);
    match pattern {
        "stack" => {
            if fade < 1.0 { return shade(top - (fade * top as f32).floor() as i64) }
            // Past the run: a dot every few columns, the gaps widening as it thins out.
            let gap = 3 + ((fade - 1.0) * 4.0).floor() as usize;
            if fade < 1.8 && (c + r) % gap == 0 { Ink::Dot } else { Ink::Blank }
        }
        "waffle" => {
            if c % 2 == 1 { return Ink::Blank }
            let roll = hash(&[seed, r32, c32]) % 10;
            shade(if roll < 5 { 1 } else if roll < 8 { 2 } else { 3 })
        }
        "uptime" => {
            // A bar a column, every row of it the same day's: up, degraded or down.
            if c % 2 == 1 { return Ink::Blank }
            let roll = hash(&[seed, c32]) % 20;
            if roll < 16 { shade(top - 1) } else if roll < 19 { shade(1) } else { Ink::Mark }
        }
        "dots" => if (c + r) % 2 == 1 { Ink::Blank } else if hash(&[seed, r32, c32]) % 9 == 0 { Ink::Mark } else { Ink::Dot },
        _ => if rows > 1 && r != rows / 2 { Ink::Double } else { Ink::Line },
    }
}

/// The first `cols` cells of row `r`, counted from the edge it fades from, in a room `room` cells across.
pub fn strip(pattern: &str, rows: usize, r: usize, cols: usize, room: usize, level: u64, seed: u32) -> Vec<Ink> {
    let run = (run(rows, r) * room as f32).max(1.0);
    (0..cols).map(|c| cell(pattern, rows, r, c, c as f32 / run, level, seed)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The door's rule, by its own numbers: a stack's run goes from the heaviest shade to the lightest and thins
    /// out into dots; a waffle and an uptime strip leave every other column blank; a rule is a line, doubled off
    /// the middle row; and the same words draw the same cells.
    #[test]
    fn a_track_s_cells_follow_the_door_s_rule() {
        let seed = seed_of("Your calls");
        assert_eq!(seed, seed_of("Your calls"));
        assert_ne!(seed, seed_of("Your beds"));
        let stack = strip("stack", 1, 0, 24, 16, 2, seed);
        assert_eq!(stack[0], Ink::Shade(3));
        assert!(stack[..12].windows(2).all(|pair| match (pair[0], pair[1]) { (Ink::Shade(a), Ink::Shade(b)) => a >= b, _ => false }), "{stack:?}");
        assert!(stack[12..].iter().all(|ink| matches!(ink, Ink::Dot | Ink::Blank)) && stack[12..].contains(&Ink::Dot), "{stack:?}");
        for pattern in ["waffle", "uptime"] {
            let cells = strip(pattern, 1, 0, 24, 16, 2, seed);
            assert!(cells.iter().enumerate().all(|(c, ink)| (c % 2 == 1) == (*ink == Ink::Blank)), "{pattern}: {cells:?}");
        }
        let dots = strip("dots", 1, 0, 24, 16, 2, seed);
        assert!(dots.iter().enumerate().all(|(c, ink)| if c % 2 == 1 { *ink == Ink::Blank } else { matches!(ink, Ink::Dot | Ink::Mark) }), "{dots:?}");
        assert!(strip("rule", 1, 0, 4, 16, 2, seed).iter().all(|ink| *ink == Ink::Line));
        assert_eq!((cell("rule", 3, 0, 0, 0.0, 2, seed), cell("rule", 3, 1, 0, 0.0, 2, seed)), (Ink::Double, Ink::Line));
        // A heading deeper than ### never takes the heaviest shade.
        assert_eq!(cell("stack", 1, 0, 0, 0.0, 4, seed), Ink::Shade(2));
    }
}
