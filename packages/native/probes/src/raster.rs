//! The terminal probe's third way to draw a grid: rasterise it on the CPU into one RGBA image for `El::pixels`.
//!
//! Glyphs are rendered once each by swash into a cell-sized mask (or colour bitmap), then blitted: a wide character
//! gets two cells' width and nothing else, so the column grid holds by construction. Fonts are whatever fontconfig
//! answers for the three needs (a monospace face, one with CJK, one with emoji); with none found there is no raster.

use std::collections::HashMap;
use std::process::Command;

use swash::scale::image::Content;
use swash::scale::{Render, ScaleContext, Source, StrikeWith};
use swash::zeno::Format;
use swash::{CacheKey, FontRef};

use crate::grid::{Cell, Grid, PALETTE, Wide};

struct Face {
    data: Vec<u8>,
    offset: u32,
    key: CacheKey,
}

impl Face {
    fn load(pattern: &str) -> Option<Face> {
        // fontconfig names the file: no path is written into the probe.
        let out = Command::new("fc-match").args(["-f", "%{file}\n%{index}", pattern]).output().ok()?;
        let text = String::from_utf8(out.stdout).ok()?;
        let mut lines = text.lines();
        let data = std::fs::read(lines.next()?).ok()?;
        let index: usize = lines.next().and_then(|i| i.parse().ok()).unwrap_or(0);
        let font = FontRef::from_index(&data, index)?;
        let (offset, key) = (font.offset, font.key);
        Some(Face { data, offset, key })
    }

    fn font(&self) -> FontRef<'_> { FontRef { data: &self.data, offset: self.offset, key: self.key } }
}

/// One glyph ready to blit: `w * h` pixels placed `left, top` from the cell's top-left.
struct Glyph {
    w: usize,
    h: usize,
    left: i32,
    top: i32,
    /// Coverage (one byte a pixel) for a mask, straight RGBA for a colour glyph.
    data: Vec<u8>,
    color: bool,
}

pub struct Raster {
    faces: Vec<Face>,
    ctx: ScaleContext,
    glyphs: HashMap<(char, bool), Option<Glyph>>,
    /// The font's size in device pixels.
    ppem: f32,
    /// A cell in device pixels.
    pub cell: (usize, usize),
    baseline: i32,
}

impl Raster {
    /// A rasteriser for cells `cell` device pixels in size, set in a monospace face of `ppem` pixels.
    pub fn new(ppem: f32, cell: (usize, usize)) -> Option<Raster> {
        let faces: Vec<Face> = ["monospace", ":charset=7551", ":charset=1f331:color=true"].into_iter().filter_map(Face::load).collect();
        if faces.len() < 3 { return None }
        let metrics = faces[0].font().metrics(&[]).scale(ppem);
        // The text sits in the cell as a line of that height would set it: the extra leading split above and below.
        let baseline = ((cell.1 as f32 - (metrics.ascent + metrics.descent)) / 2.0 + metrics.ascent).round() as i32;
        Some(Raster { faces, ctx: ScaleContext::new(), glyphs: HashMap::new(), ppem, cell, baseline })
    }

    fn glyph(&mut self, ch: char, wide: bool) -> Option<&Glyph> {
        if !self.glyphs.contains_key(&(ch, wide)) {
            let made = self.render(ch, wide);
            self.glyphs.insert((ch, wide), made);
        }
        self.glyphs[&(ch, wide)].as_ref()
    }

    fn render(&mut self, ch: char, wide: bool) -> Option<Glyph> {
        let box_w = self.cell.0 * if wide { 2 } else { 1 };
        let (face, id) = self.faces.iter().find_map(|f| Some((f, f.font().charmap().map(ch))).filter(|(_, id)| *id != 0))?;
        let mut scaler = self.ctx.builder(face.font()).size(self.ppem).hint(true).build();
        let image = Render::new(&[Source::ColorOutline(0), Source::ColorBitmap(StrikeWith::BestFit), Source::Outline]).format(Format::Alpha).render(&mut scaler, id)?;
        let (w, h) = (image.placement.width as usize, image.placement.height as usize);
        if w == 0 || h == 0 { return None }
        let color = image.content == Content::Color;
        let advance = face.font().glyph_metrics(&[]).scale(self.ppem).advance_width(id);
        // A fallback face's glyph is centred in the cells it was given; the grid's own face sits at its origin.
        let centre = ((box_w as f32 - advance) / 2.0).round() as i32;
        let mut glyph = Glyph { w, h, left: centre.max(0) + image.placement.left, top: self.baseline - image.placement.top, data: image.data, color };
        // A colour bitmap comes at its strike's size: bring it down to the cells it has.
        if color && (w > box_w || h > self.cell.1) {
            let k = (box_w as f32 / w as f32).min(self.cell.1 as f32 / h as f32);
            let (nw, nh) = (((w as f32 * k) as usize).max(1), ((h as f32 * k) as usize).max(1));
            let mut data = vec![0u8; nw * nh * 4];
            for y in 0..nh {
                for x in 0..nw {
                    let (sx, sy) = (((x as f32 + 0.5) / k) as usize, ((y as f32 + 0.5) / k) as usize);
                    let (src, dst) = ((sy.min(h - 1) * w + sx.min(w - 1)) * 4, (y * nw + x) * 4);
                    data[dst..dst + 4].copy_from_slice(&glyph.data[src..src + 4]);
                }
            }
            glyph = Glyph { w: nw, h: nh, left: (box_w as i32 - nw as i32) / 2, top: (self.cell.1 as i32 - nh as i32) / 2, data, color };
        }
        Some(glyph)
    }

    /// The image's size in device pixels for a grid.
    pub fn size(&self, grid: &Grid) -> (usize, usize) { (grid.cols * self.cell.0, grid.rows * self.cell.1) }

    /// Paints row `r` of `grid` into `rgba`, an image `size(grid)` large: every cell's ground, then its glyph.
    pub fn blit_row(&mut self, grid: &Grid, r: usize, rgba: &mut [u8]) {
        let (cw, ch) = self.cell;
        let stride = grid.cols * cw * 4;
        let y0 = r * ch;
        for (col, cell) in grid.row(r).iter().enumerate() {
            let bg = PALETTE[cell.bg as usize];
            for y in y0..y0 + ch {
                let line = &mut rgba[y * stride + col * cw * 4..y * stride + (col + 1) * cw * 4];
                for px in line.chunks_exact_mut(4) { px.copy_from_slice(&[bg[0], bg[1], bg[2], 255]); }
            }
        }
        let row: Vec<(usize, Cell)> = grid.row(r).iter().copied().enumerate().filter(|(_, c)| c.wide != Wide::Tail && c.ch != ' ').collect();
        for (col, cell) in row {
            let wide = cell.wide == Wide::Lead;
            let (x0, limit) = (col * cw, (col + if wide { 2 } else { 1 }) * cw);
            let fg = PALETTE[cell.fg as usize];
            let Some(g) = self.glyph(cell.ch, wide) else { continue };
            for gy in 0..g.h {
                let y = y0 as i32 + g.top + gy as i32;
                if y < y0 as i32 || y >= (y0 + ch) as i32 { continue }
                for gx in 0..g.w {
                    let x = x0 as i32 + g.left + gx as i32;
                    // Nothing a glyph draws leaves its own cells.
                    if x < x0 as i32 || x >= limit as i32 { continue }
                    let px = &mut rgba[y as usize * stride + x as usize * 4..][..4];
                    let (src, a) = if g.color {
                        let s = &g.data[(gy * g.w + gx) * 4..][..4];
                        ([s[0], s[1], s[2]], s[3] as u32)
                    } else {
                        (fg, g.data[gy * g.w + gx] as u32)
                    };
                    for i in 0..3 { px[i] = ((src[i] as u32 * a + px[i] as u32 * (255 - a)) / 255) as u8; }
                }
            }
        }
    }
}
