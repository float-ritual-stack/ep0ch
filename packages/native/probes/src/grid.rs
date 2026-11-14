//! Probe 7's terminal: a grid of cells and a canned stream that fills it. No pty, no parser: what a VT parser
//! (libghostty-vt, in the design) would hand the `pty` drawer each frame.

use unicode_width::UnicodeWidthChar;

/// Sixteen colours, sRGB: the stream's `fg` and `bg` index it. 0 is the ground, 7 the ink.
pub const PALETTE: [[u8; 3]; 16] = [
    [24, 26, 31], [224, 108, 117], [152, 195, 121], [229, 192, 123], [97, 175, 239], [198, 120, 221], [86, 182, 194], [220, 223, 228],
    [92, 99, 112], [240, 140, 150], [170, 215, 140], [240, 210, 150], [130, 195, 250], [215, 150, 235], [120, 200, 210], [255, 255, 255],
];

/// How a cell sits on the column grid.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Wide {
    /// One column.
    No,
    /// The first of the two columns a wide character takes.
    Lead,
    /// The second: nothing is drawn from it.
    Tail,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Cell {
    pub ch: char,
    pub wide: Wide,
    pub fg: u8,
    pub bg: u8,
    pub bold: bool,
}

pub const BLANK: Cell = Cell { ch: ' ', wide: Wide::No, fg: 7, bg: 0, bold: false };

#[derive(Clone, PartialEq)]
pub struct Grid {
    pub cols: usize,
    pub rows: usize,
    pub cells: Vec<Cell>,
}

/// A run of cells in one row that share their colours and weight.
pub struct Run<'a> {
    pub col: usize,
    pub cells: &'a [Cell],
}

impl Grid {
    pub fn new(cols: usize, rows: usize) -> Grid { Grid { cols, rows, cells: vec![BLANK; cols * rows] } }

    pub fn row(&self, r: usize) -> &[Cell] { &self.cells[r * self.cols..(r + 1) * self.cols] }

    /// Writes `text` into row `r` from column `col`, a wide character taking two cells, and answers the next column.
    /// What doesn't fit is dropped; a wide character that would straddle the edge leaves a blank.
    pub fn put(&mut self, r: usize, mut col: usize, text: &str, fg: u8, bg: u8, bold: bool) -> usize {
        for ch in text.chars() {
            let width = ch.width().unwrap_or(0);
            if width == 0 { continue }
            if col + width > self.cols {
                if col < self.cols { self.cells[r * self.cols + col] = Cell { bg, ..BLANK }; }
                return self.cols;
            }
            let at = r * self.cols + col;
            self.cells[at] = Cell { ch, wide: if width == 2 { Wide::Lead } else { Wide::No }, fg, bg, bold };
            if width == 2 { self.cells[at + 1] = Cell { ch: ' ', wide: Wide::Tail, fg, bg, bold }; }
            col += width;
        }
        col
    }

    pub fn clear_row(&mut self, r: usize, bg: u8) {
        for cell in &mut self.cells[r * self.cols..(r + 1) * self.cols] { *cell = Cell { bg, ..BLANK }; }
    }

    /// The row's text as one string: a wide character once, its tail cell skipped.
    pub fn text(&self, r: usize) -> String { self.row(r).iter().filter(|c| c.wide != Wide::Tail).map(|c| c.ch).collect() }

    /// The row cut where colour or weight changes.
    pub fn runs(&self, r: usize) -> Vec<Run<'_>> {
        let row = self.row(r);
        let mut runs = Vec::new();
        let mut start = 0;
        for i in 1..=row.len() {
            let same = i < row.len() && (row[i].fg, row[i].bg, row[i].bold) == (row[start].fg, row[start].bg, row[start].bold);
            if !same {
                runs.push(Run { col: start, cells: &row[start..i] });
                start = i;
            }
        }
        runs
    }

    /// How many rows differ from `other`'s.
    pub fn rows_changed(&self, other: &Grid) -> usize { (0..self.rows).filter(|&r| self.row(r) != other.row(r)).count() }
}

/// Line `n` of a made-up allotment's log, written into row `r`. Six kinds in turn: a plain log line, a box-drawn
/// table's rule and row, a line of CJK, a line with emoji, and a line of many short colour runs.
pub fn line(grid: &mut Grid, r: usize, n: u64) {
    grid.clear_row(r, 0);
    let bed = 1 + n % 23;
    let crops = ["carrots", "onions", "beans", "kale", "leeks", "beets", "chard"];
    let crop = crops[(n / 6 % crops.len() as u64) as usize];
    match n % 6 {
        0 => {
            let mut c = grid.put(r, 0, &format!("{:02}:{:02}:{:02} ", 6 + n / 3600 % 12, n / 60 % 60, n % 60), 8, 0, false);
            c = grid.put(r, c, "sow   ", 2, 0, true);
            c = grid.put(r, c, &format!("bed {bed:<3} "), 4, 0, false);
            c = grid.put(r, c, &format!("{crop:<10}"), 7, 0, false);
            c = grid.put(r, c, &format!("{} rows  ", 2 + n % 7), 3, 0, false);
            grid.put(r, c, if n % 5 == 0 { "dry: water first" } else { "ok" }, if n % 5 == 0 { 1 } else { 10 }, 0, false);
        }
        1 => {
            grid.put(r, 0, "┌──────────┬────────────┬──────────────────────┬─────────┐", 8, 0, false);
        }
        2 => {
            let done = (n / 6 % 20) as usize;
            let mut c = grid.put(r, 0, "│", 8, 0, false);
            c = grid.put(r, c, &format!(" bed {bed:<4} "), 12, 0, true);
            c = grid.put(r, c, "│", 8, 0, false);
            c = grid.put(r, c, &format!(" {crop:<10} "), 7, 0, false);
            c = grid.put(r, c, "│ ", 8, 0, false);
            c = grid.put(r, c, &"█".repeat(done), 2, 0, false);
            c = grid.put(r, c, &"░".repeat(20 - done), 8, 0, false);
            c = grid.put(r, c, " │", 8, 0, false);
            c = grid.put(r, c, &format!(" {:>3} %   ", done * 5), 3, 0, false);
            grid.put(r, c, "│", 8, 0, false);
        }
        3 => {
            let mut c = grid.put(r, 0, &format!("畑 {bed} 番 "), 6, 0, false);
            c = grid.put(r, c, "にんじん 人参 ", 7, 0, false);
            c = grid.put(r, c, &format!("収穫まで {} 日 ", 3 + n % 40), 3, 0, false);
            grid.put(r, c, "水やり済み", 0, 2, false);
        }
        4 => {
            let mut c = grid.put(r, 0, "🌱 seedlings  ", 2, 0, false);
            c = grid.put(r, c, &format!("🥕 {crop:<9}"), 3, 0, false);
            c = grid.put(r, c, "🍅 tomatoes  ", 1, 0, false);
            grid.put(r, c, &format!("🌧 rain in {} h", 1 + n % 9), 4, 0, false);
        }
        _ => {
            // Many short runs, as coloured `ls` output or highlighted source has: one per word.
            let words = ["shed", "hose", "fork", "twine", "trowel", "barrow", "cloche", "dibber", "rake", "sieve"];
            let mut c = 0;
            let mut i = n;
            while c + 8 < grid.cols {
                let word = words[(i % words.len() as u64) as usize];
                c = grid.put(r, c, word, (1 + i % 14) as u8, if i % 9 == 0 { 8 } else { 0 }, i % 4 == 0);
                c = grid.put(r, c, " ", 7, 0, false);
                i += 1;
            }
        }
    }
}

/// Frame `tick` of the canned stream as a full-screen program would leave it: a log that scrolled one line (so
/// every row but the last changed) over a status row.
pub fn scroll(grid: &mut Grid, tick: u64) {
    for r in 0..grid.rows - 1 { line(grid, r, tick + r as u64); }
    let last = grid.rows - 1;
    grid.clear_row(last, 4);
    let c = grid.put(last, 0, &format!(" allotment  tick {tick}  "), 15, 4, true);
    grid.put(last, c, "q quit  / find  畑 beds  🌱 sow", 0, 4, false);
}

/// Frame `tick` of someone typing at a prompt: only the row before the status row changes.
pub fn prompt(grid: &mut Grid, tick: u64) {
    let r = grid.rows - 2;
    grid.clear_row(r, 0);
    let c = grid.put(r, 0, "plot> ", 2, 0, true);
    let typed = "sow bed 14 with carrots and note the 人参 row 🥕";
    let shown: String = typed.chars().take(1 + (tick as usize % typed.chars().count())).collect();
    let c = grid.put(r, c, &shown, 7, 0, false);
    grid.put(r, c, "█", 7, 0, false);
}
