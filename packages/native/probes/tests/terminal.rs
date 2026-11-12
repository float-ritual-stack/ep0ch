//! Probe 7: the terminal measurement. A cell grid drawn three ways, fed by a canned stream, timed headless, with
//! the question the `pty` drawer turns on: do wide cells (CJK, emoji) stay on the column grid?
//!
//! - **Rich:** each row is one mono text with a span per run of colour. The cheapest thing Rune offers.
//! - **Split:** a row is cut only where a wide character sits: each stretch of one-column cells is one mono text of
//!   a fixed width, each wide character a box two cells wide, each run of background a rect behind them.
//! - **Image:** the grid is rasterised on the CPU into one `Pixels` image (`src/raster.rs`).
//!
//! `cargo test --release --test terminal measure -- --nocapture --test-threads 1` prints the table PROBES.md quotes.
//! With `EP0CH_PROBE_SNAPS=<folder>` set, the tests also write what each way drew as PNGs there.

use std::cell::Cell as Counter;
use std::path::PathBuf;
use std::rc::Rc;

use ep0ch_native_probes::grid::{self, Grid, PALETTE, Wide};
use ep0ch_native_probes::offstage::Offstage;
use ep0ch_native_probes::raster::Raster;
use ep0ch_native_probes::*;
use rune::{Color, Cx, El, Family, Pixels, Runtime, Span, TextStyle, col, el, memo, row, text};

const FONT: f32 = 13.0;
const LINE: f32 = 17.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Draw {
    Rich,
    Split,
    Image,
}

struct Term {
    grid: Grid,
    draw: Draw,
    /// A cell in points.
    cell: (f32, f32),
    style: TextStyle,
    colors: [Color; 16],
    pixels: Pixels,
    row_builds: Rc<Counter<u32>>,
}

fn style() -> TextStyle { TextStyle { line_height: LINE, ..TextStyle::new(FONT, 400.0).family(Family::Mono) } }

fn colors() -> [Color; 16] { PALETTE.map(|[r, g, b]| rune::color::hex(&format!("#{r:02x}{g:02x}{b:02x}")).unwrap()) }

/// The spans that colour `cells`, a stretch of one row, as byte ranges of `line` (which they are appended to).
fn spans_of(s: &Term, cells: &[grid::Cell], line: &mut String, backgrounds: bool) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut i = 0;
    while i < cells.len() {
        let look = |c: &grid::Cell| (c.fg, c.bg, c.bold);
        let first = cells[i];
        let start = line.len();
        let mut j = i;
        while j < cells.len() && look(&cells[j]) == look(&first) {
            if cells[j].wide != Wide::Tail { line.push(cells[j].ch); }
            j += 1;
        }
        let mut span = Span::new(start, line.len()).color(s.colors[first.fg as usize]);
        if first.bold { span = span.bold(); }
        if backgrounds && first.bg != 0 { span = span.bg(s.colors[first.bg as usize], 0.0); }
        spans.push(span);
        i = j;
    }
    spans
}

/// One mono text for the whole row, a span per run of colour; a run's background is the span's own.
fn rich_row(s: &Term, r: usize) -> El {
    s.row_builds.set(s.row_builds.get() + 1);
    let mut line = String::new();
    let spans = spans_of(s, s.grid.row(r), &mut line, true);
    text(line).font(s.style).color(s.colors[7]).spans(spans).h(s.cell.1)
}

/// The row cut where a wide character sits. A stretch of one-column cells is one mono text given the width its
/// cells have; a wide character is a box two cells wide; whatever a piece's glyphs measure, the next piece starts on
/// its column. Backgrounds are rects of their own, behind the text.
fn split_row(s: &Term, r: usize) -> El {
    s.row_builds.set(s.row_builds.get() + 1);
    let (cw, ch) = s.cell;
    let cells = s.grid.row(r);
    let mut pieces = Vec::new();
    for run in s.grid.runs(r).iter().filter(|run| run.cells[0].bg != 0) {
        pieces.push(el().absolute(run.col as f32 * cw, 0.0).size(run.cells.len() as f32 * cw, ch).fill(s.colors[run.cells[0].bg as usize]));
    }
    let mut i = 0;
    while i < cells.len() {
        let wide = cells[i].wide == Wide::Lead;
        let mut j = i + if wide { 2 } else { 1 };
        while !wide && j < cells.len() && cells[j].wide == Wide::No { j += 1; }
        let mut line = String::new();
        let spans = spans_of(s, &cells[i..j], &mut line, false);
        let mut piece = el().w((j - i) as f32 * cw).h(ch);
        if !line.trim().is_empty() { piece = piece.child(text(line).font(s.style).color(s.colors[7]).spans(spans)); }
        pieces.push(piece);
        i = j;
    }
    row().h(ch).children(pieces)
}

fn view(s: &Term, _: &mut Cx<Term>) -> El {
    let (cw, ch) = s.cell;
    let (w, h) = (s.grid.cols as f32 * cw, s.grid.rows as f32 * ch);
    let body = match s.draw {
        Draw::Image => el().key("term").size(w, h).pixels(&s.pixels),
        // A row is drawn again only when its cells changed: the memo's version is the row itself.
        Draw::Rich => col().key("term").size(w, h).children((0..s.grid.rows).map(|r| memo(format!("term/row/{r}"), s.grid.row(r), || rich_row(s, r)))),
        Draw::Split => col().key("term").size(w, h).children((0..s.grid.rows).map(|r| memo(format!("term/row/{r}"), s.grid.row(r), || split_row(s, r)))),
    };
    col().fill(s.colors[0]).w_full().h_full().child(body)
}

struct Stage {
    rt: Runtime<Term>,
    /// The image variant's rasteriser and its frame, kept between frames so only changed rows are painted.
    raster: Option<(Raster, Vec<u8>, Grid)>,
    /// One renderer for the runtime's whole life: the glyph atlas uploads to it as it fills.
    off: Offstage,
}

/// The width of one mono cell in points: the face's own advance, measured over a long run so rounding to a device
/// pixel is a hundredth of it.
fn cell_width(rt: &mut Runtime<Term>) -> f32 { rt.text.measure(&"M".repeat(200), style(), 1.0).0 / 200.0 }

fn stage(cols: usize, rows: usize, draw: Draw) -> Stage { stage_at(cols, rows, draw, 1.0) }

/// A window `scale` device pixels to the point: 2 is a laptop's own screen.
fn stage_at(cols: usize, rows: usize, draw: Draw, scale: f32) -> Stage {
    let grid = Grid::new(cols, rows);
    let term = Term { grid, draw, cell: (8.0, LINE), style: style(), colors: colors(), pixels: Pixels::new(), row_builds: Rc::default() };
    let mut rt = Runtime::new(term, view, (cols as f32 * 8.0 + 16.0, rows as f32 * LINE + 8.0), rune::Env::new(false, scale));
    // The mono slot is the system's monospace face (fontconfig's answer), not the sans the runtime starts with.
    rt.set_font_families("Inter", "ui-monospace");
    let cw = cell_width(&mut rt);
    let raster = match draw {
        Draw::Image => {
            // A raster cell is whole device pixels: the advance rounded, as a terminal sizes its cells.
            let cell = ((cw * scale).round() as usize, (LINE * scale) as usize);
            rt.state.cell = (cell.0 as f32 / scale, cell.1 as f32 / scale);
            let raster = Raster::new(FONT * scale, cell).expect("fontconfig names a monospace, a CJK and an emoji face");
            let (w, h) = raster.size(&rt.state.grid);
            // A grid no row of which matches, so the first frame paints them all.
            let mut never = rt.state.grid.clone();
            for cell in &mut never.cells { cell.ch = '\u{1}'; }
            Some((raster, vec![0u8; w * h * 4], never))
        }
        _ => {
            rt.state.cell = (cw, LINE);
            None
        }
    };
    let off = Offstage::new(&mut rt);
    let mut stage = Stage { rt, raster, off };
    stage.frame();
    stage
}

impl Stage {
    /// Shows the grid as it now is. Answers the milliseconds spent painting cells on the CPU (the image way only)
    /// and in `Runtime::frame`.
    fn frame(&mut self) -> (f64, f64) {
        let mut paint = 0.0;
        if let Some((raster, rgba, shown)) = &mut self.raster {
            let grid = &self.rt.state.grid;
            paint = ms(|| {
                for r in 0..grid.rows {
                    if grid.row(r) != shown.row(r) { raster.blit_row(grid, r, rgba); }
                }
                let (w, h) = raster.size(grid);
                self.rt.state.pixels.set(w as u32, h as u32, rgba.clone());
            });
            *shown = grid.clone();
        }
        let frame = ms(|| { self.rt.frame(1.0 / 60.0); });
        (paint, frame)
    }

    fn feed(&mut self, f: impl FnOnce(&mut Grid)) -> (f64, f64) {
        // As the pty's reader would hand a frame over: an update, committed with no motion.
        self.rt.update(|s, tx| {
            f(&mut s.grid);
            tx.instant();
        });
        self.frame()
    }

    /// Draws the last frame through the software renderer and waits for its pixels: the milliseconds, and them.
    fn render(&mut self) -> (f64, Vec<u8>) {
        let mut rgba = Vec::new();
        let took = ms(|| {
            self.off.draw(&mut self.rt);
            rgba = self.off.read();
        });
        (took, rgba)
    }

    /// With `EP0CH_PROBE_SNAPS=<folder>`, writes what is on screen there as `name`.
    fn snap(&mut self, name: &str) {
        let Some(dir) = std::env::var_os("EP0CH_PROBE_SNAPS").map(PathBuf::from) else { return };
        self.off.draw(&mut self.rt);
        self.off.png(&dir.join(name));
    }
}

/// The left edge, in device pixels, of the last glyph drawn in grid row `r`.
fn last_glyph_x(stage: &Stage, r: usize) -> f32 {
    let (top, bottom) = (r as f32 * LINE, (r + 1) as f32 * LINE);
    stage.rt.instances.iter()
        .filter(|i| rune::compose::is_glyph(i) && i.rect[1] + i.rect[3] / 2.0 >= top && i.rect[1] + i.rect[3] / 2.0 < bottom)
        .map(|i| i.rect[0])
        .fold(f32::MIN, f32::max)
}

/// Rows whose 21st column holds the same mark, after twenty columns of ASCII, bold ASCII, box drawing, CJK, emoji
/// and a mix.
const MARKED: [(&str, &str); 6] = [
    ("ascii", "abcdefghijklmnopqrst"),
    ("bold", "ABCDEFGHIJ0123456789"),
    ("box", "┌──┬──┐│  │  │└──┴─┘"),
    ("cjk", "畑畑畑畑畑畑畑畑畑畑"),
    ("emoji", "🌱🥕🍅🌱🥕🍅🌱🥕🍅🌱"),
    ("mixed", "ab畑cd🌱ef人gh🥕ijkl"),
];

fn marked(draw: Draw) -> Stage {
    let mut stage = stage(40, MARKED.len(), draw);
    stage.feed(|g| {
        for (r, (_, lead)) in MARKED.iter().enumerate() {
            let c = g.put(r, 0, lead, 7, 0, MARKED[r].0 == "bold");
            assert_eq!(c, 20, "{lead} is twenty columns");
            g.put(r, c, "█", 15, 0, false);
        }
    });
    stage
}

#[test]
fn the_canned_stream_changes_every_row_but_the_status_row_s_frame() {
    let mut a = Grid::new(80, 24);
    grid::scroll(&mut a, 7);
    let mut b = a.clone();
    grid::scroll(&mut b, 8);
    assert_eq!(a.rows_changed(&b), 24, "a scrolled log: every row is another line, and the status row's tick moved");
    let mut c = b.clone();
    grid::prompt(&mut c, 3);
    assert_eq!(b.rows_changed(&c), 1, "typing at a prompt: one row");
    // Wide characters take two cells and the row's text has them once.
    let cjk = (0..24).find(|&r| a.text(r).contains('畑')).unwrap();
    let lead = a.row(cjk).iter().position(|c| c.ch == '畑').unwrap();
    assert_eq!((a.row(cjk)[lead].wide, a.row(cjk)[lead + 1].wide), (Wide::Lead, Wide::Tail));
}

#[test]
fn the_mono_slot_is_the_sans_face_until_the_app_names_a_monospace_one() {
    let term = Term { grid: Grid::new(4, 1), draw: Draw::Rich, cell: (8.0, LINE), style: style(), colors: colors(), pixels: Pixels::new(), row_builds: Rc::default() };
    let mut rt = Runtime::new(term, view, (200.0, 40.0), env());
    turn(&mut rt);
    let widths = |rt: &mut Runtime<Term>| (rt.text.measure(&"i".repeat(40), style(), 1.0).0, rt.text.measure(&"M".repeat(40), style(), 1.0).0);
    let (i, m) = widths(&mut rt);
    assert!(m > i * 1.5, "as a runtime starts (families \"Inter\", \"Inter\"), Family::Mono sets forty i's {i} pt wide and forty M's {m} pt");
    rt.set_font_families("Inter", "ui-monospace");
    let (i, m) = widths(&mut rt);
    assert_eq!(i, m, "with the system's monospace face behind the slot they are the same width");
}

#[test]
fn one_rich_text_per_row_lets_wide_cells_drift_off_the_column_grid() {
    let mut stage = marked(Draw::Rich);
    stage.snap("marked-rich.png");
    let cw = stage.rt.state.cell.0;
    let x: Vec<f32> = (0..MARKED.len()).map(|r| last_glyph_x(&stage, r)).collect();
    let drift: Vec<f32> = x.iter().map(|at| (at - x[0]) / cw).collect();
    println!("rich rows, cell {cw:.3} pt: the mark at column 20 sits {:.2} (bold), {:.2} (box), {:.2} (cjk), {:.2} (emoji), {:.2} (mixed) cells from where ASCII puts it", drift[1], drift[2], drift[3], drift[4], drift[5]);
    assert!(drift[1].abs() < 0.15 && drift[2].abs() < 0.15, "bold and box drawing are in the monospace face and stay on the grid: {drift:?}");
    assert!(drift[3].abs() > 1.0, "ten CJK characters, each set at its own face's advance, end more than a cell off: {drift:?}");
    assert!(drift[4].abs() > 0.5, "emoji too: {drift:?}");
    assert!(drift[5].abs() > 0.2, "and a line with only a few: {drift:?}");
}

#[test]
fn rows_cut_into_fixed_width_pieces_keep_every_cell_on_the_grid() {
    let mut stage = marked(Draw::Split);
    stage.snap("marked-split.png");
    let cw = stage.rt.state.cell.0;
    let x: Vec<f32> = (0..MARKED.len()).map(|r| last_glyph_x(&stage, r)).collect();
    let drift: Vec<f32> = x.iter().map(|at| (at - x[0]) / cw).collect();
    println!("split rows: the mark at column 20 sits {:.2} (bold), {:.2} (box), {:.2} (cjk), {:.2} (emoji), {:.2} (mixed) cells from where ASCII puts it", drift[1], drift[2], drift[3], drift[4], drift[5]);
    assert!(drift.iter().all(|d| d.abs() < 0.15), "{drift:?}");
}

#[test]
fn the_rasterised_image_has_every_cell_on_the_grid_by_construction() {
    let mut stage = marked(Draw::Image);
    stage.snap("marked-image.png");
    let (raster, rgba, _) = stage.raster.as_ref().unwrap();
    let (cw, ch) = raster.cell;
    let width = 40 * cw;
    let mark = PALETTE[15];
    for (r, (name, _)) in MARKED.iter().enumerate() {
        let y = r * ch + ch / 2;
        let first = (0..width).find(|&x| rgba[(y * width + x) * 4..][..3] == mark).unwrap_or_else(|| panic!("{name}: no mark drawn"));
        assert!(first.abs_diff(20 * cw) <= 1, "{name}: the mark starts at pixel {first}, column 20 is pixel {}", 20 * cw);
    }
    // The CJK and emoji cells hold ink: the fallback faces were found and drawn.
    let ink = |r: usize, col: usize| (0..2 * cw).any(|dx| (0..ch).any(|dy| rgba[((r * ch + dy) * width + col * cw + dx) * 4..][..3] != PALETTE[0]));
    assert!(ink(3, 0) && ink(4, 0) && ink(5, 2) && ink(5, 6));
}

#[test]
fn a_row_is_drawn_again_only_when_its_cells_changed() {
    let mut stage = stage(80, 24, Draw::Rich);
    stage.feed(|g| grid::scroll(g, 1));
    let before = stage.rt.state.row_builds.get();
    stage.feed(|g| grid::prompt(g, 1));
    assert_eq!(stage.rt.state.row_builds.get() - before, 1, "typing at the prompt drew one row of twenty-four");
    let before = stage.rt.state.row_builds.get();
    stage.feed(|g| grid::scroll(g, 2));
    assert_eq!(stage.rt.state.row_builds.get() - before, 24, "a scroll drew them all");
}

#[test]
fn a_frame_committed_without_tx_instant_is_still_moving_when_it_is_drawn() {
    let unsettled = |rt: &Runtime<Term>| rt.elements().iter().filter(|e| e.exiting || e.moving || e.opacity < 1.0).count();
    // As a handler with no say about motion would commit it.
    let mut eased = stage(80, 24, Draw::Split);
    eased.feed(|g| grid::scroll(g, 1));
    grid::scroll(&mut eased.rt.state.grid, 2);
    eased.rt.invalidate();
    eased.rt.frame(1.0 / 60.0);
    // And as the terminal's feed commits it.
    let mut instant = stage(80, 24, Draw::Split);
    instant.feed(|g| grid::scroll(g, 1));
    instant.feed(|g| grid::scroll(g, 2));
    println!("one frame after a scroll: {} elements still leaving, moving or fading without Tx::instant, {} with it", unsettled(&eased.rt), unsettled(&instant.rt));
    assert!(unsettled(&eased.rt) > 0, "Rune eases what a commit replaced: the frame drawn shows old and new rows together");
    assert_eq!(unsettled(&instant.rt), 0);
}

#[test]
fn each_way_draws_the_same_grid_to_a_picture() {
    for draw in [Draw::Rich, Draw::Split, Draw::Image] {
        let mut stage = stage(80, 24, draw);
        stage.feed(|g| grid::scroll(g, 40));
        stage.feed(|g| grid::prompt(g, 30));
        let (_, rgba) = stage.render();
        let (w, h) = stage.off.size();
        assert_eq!(rgba.len(), (w * h * 4) as usize);
        let ground = rgba[rgba.len() - 4..rgba.len() - 1].to_vec();
        let inked = rgba.chunks_exact(4).filter(|px| px[..3] != ground[..]).count();
        assert!(inked > 20_000, "{draw:?}: {inked} pixels differ from the ground");
        stage.snap(&format!("term-80x24-{}.png", format!("{draw:?}").to_lowercase()));
    }
}

/// The measurement. For each grid size, scale, way of drawing and stream: the CPU's share of a frame (painting cells,
/// for the image; then `Runtime::frame`: view, layout, shaping, instances) and the software renderer's (lavapipe draw
/// and readback), as medians over forty frames.
#[test]
fn measure_ms_per_frame_for_each_way_of_drawing_a_grid() {
    let profile = if cfg!(debug_assertions) { "debug" } else { "release" };
    println!("terminal grid, {profile} build, headless ({} threads for the software renderer)", std::thread::available_parallelism().map_or(1, |n| n.get()));
    println!("{:<8} {:<6} {:<6} {:<7} {:>9} {:>9} {:>9} {:>10} {:>9}", "grid", "scale", "way", "stream", "paint ms", "frame ms", "worst ms", "render ms", "elements");
    // A debug build times one small grid, so `cargo test` stays quick; the release run is the table.
    let sizes: &[(usize, usize, f32)] = if cfg!(debug_assertions) { &[(80, 24, 1.0)] } else { &[(80, 24, 1.0), (80, 24, 2.0), (200, 60, 1.0), (200, 60, 2.0)] };
    for &(cols, rows, scale) in sizes {
        for draw in [Draw::Rich, Draw::Split, Draw::Image] {
            for stream in ["scroll", "prompt"] {
                let mut stage = stage_at(cols, rows, draw, scale);
                let feed = |g: &mut Grid, tick: u64| if stream == "scroll" { grid::scroll(g, tick) } else { grid::prompt(g, tick) };
                stage.feed(|g| grid::scroll(g, 0));
                for tick in 1..6 { stage.feed(|g| feed(g, tick)); }
                let (mut paints, mut frames, mut renders) = (Vec::new(), Vec::new(), Vec::new());
                for tick in 6..46 {
                    let (paint, frame) = stage.feed(|g| feed(g, tick));
                    paints.push(paint);
                    frames.push(frame);
                    renders.push(stage.render().0);
                }
                let elements = stage.rt.elements().len();
                let ((paint, _), (frame, worst), (render, _)) = (median_max(paints), median_max(frames), median_max(renders));
                println!("{:<8} {:<6} {:<6} {:<7} {:>9.2} {:>9.2} {:>9.2} {:>10.2} {:>9}", format!("{cols}x{rows}"), scale, format!("{draw:?}").to_lowercase(), stream, paint, frame, worst, render, elements);
            }
        }
    }
}
