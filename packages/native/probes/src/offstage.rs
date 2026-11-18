//! Drawing a test `Runtime`'s frame into an offscreen target, as Rune's own `--snap` does, so a probe can time the
//! renderer and look at what it drew. With no GPU this is lavapipe (`VK_ICD_FILENAMES` naming its ICD): its times
//! say what a software rasteriser costs, not what a laptop's GPU will.

use std::path::Path;

use rune::Runtime;
use rune::render::{Gpu, OFFSCREEN_FORMAT, Offscreen, Renderer, write_png};

pub struct Offstage {
    gpu: Gpu,
    renderer: Renderer,
    target: Offscreen,
    size: (u32, u32),
}

impl Offstage {
    /// A target the size of `rt`'s viewport at its scale.
    pub fn new<S: 'static>(rt: &mut Runtime<S>) -> Offstage {
        let gpu = Gpu::headless();
        let format = if rt.srgb_blend() { OFFSCREEN_FORMAT.remove_srgb_suffix() } else { OFFSCREEN_FORMAT };
        let mut renderer = Renderer::new(&gpu.device, format);
        renderer.set_srgb_blend(rt.srgb_blend());
        renderer.attach_text(&mut rt.text.atlas);
        let scale = rt.env.scale;
        let size = ((rt.viewport.0 * scale).round() as u32, (rt.viewport.1 * scale).round() as u32);
        let target = Offscreen::with_format(&gpu.device, size.0, size.1, format);
        Offstage { gpu, renderer, target, size }
    }

    /// Draws the instances `rt.frame` last built and submits them. `read` then waits for the pixels.
    pub fn draw<S: 'static>(&mut self, rt: &mut Runtime<S>) {
        let (device, queue) = (&self.gpu.device, &self.gpu.queue);
        self.renderer.upload_images(device, queue, &mut rt.images);
        let mut encoder = device.create_command_encoder(&Default::default());
        self.renderer.prepare(device, queue, &mut rt.text.atlas, &rt.instances, self.size);
        self.renderer.draw(&mut encoder, &self.target.view, rt.clear_color());
        self.target.copy(&mut encoder);
        self.renderer.submit(queue, encoder);
    }

    /// The frame `draw` submitted, as tightly packed RGBA. Blocks until the GPU has finished it.
    pub fn read(&self) -> Vec<u8> { self.target.read(&self.gpu.device) }

    pub fn size(&self) -> (u32, u32) { self.size }

    pub fn png(&self, path: &Path) {
        write_png(path, self.size.0, self.size.1, &self.read()).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    }
}
