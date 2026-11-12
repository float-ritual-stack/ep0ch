// Pictures in a note: images, image.* (size, place, header, fit, dim, look, undo; PIE-532) and artifact.open/share.
import { ALIGNS, HERO_PROP_NAMES, HERO_PROPS, HERO_ROWS, heroPropSet, heroPropStep, heroPropText, isHeroProp, type MediaAttr, parseDim, parseFocus, parseSize, sizeText } from "../../media";
import { IMAGE_ARGS, type On } from "./shared";
import { RECORDED_AS } from "../../socket";
import { notArtifact } from "../picture-rows";
import { type ActionDef, ActionRefused, def } from "../actions";
import { readerKeys } from "../reader-keys";

export const IMAGE_DEFS = {
  "images": def({
    summary: "list the note's pictures (PIE-532, PIE-1594: a media line, a picture fence, a script's drawing) in reading order: n, line, picture (who it is), path, the layout written on the line (size, height, align, layout, fit, dim, alt) and what's wrong with it, and how it's drawn here (cells, or the header's rows)",
    reads: true, touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole(), d = surface.drawnImages();
      return {
        images: surface.imagesIn(m).map((x, i) => ({
          n: i + 1, line: x.line + 1, picture: x.id, path: x.path, kind: x.spec.kind, ...(x.kind === "drawing" ? { drawing: true } : {}),
          ...(x.spec.size ? { size: sizeText(x.spec.size) } : {}), ...(x.spec.height ? { height: x.spec.height } : {}),
          ...(x.spec.align ? { align: x.spec.align } : {}), ...(x.spec.layout ? { layout: x.spec.layout } : {}), ...(x.spec.fit ? { fit: x.spec.fit } : {}), ...(x.spec.dim !== undefined ? { dim: x.spec.dim } : {}), ...(x.spec.alt ? { alt: x.spec.alt } : {}), ...(x.spec.fence ? { fence: x.spec.fence } : {}),
          ...(x.spec.problems.length ? { problems: x.spec.problems } : {}),
          drawn: d.get(x.line) ?? null,
        })),
      };
    },
  }),
  "artifact.open": def({
    summary: "open an artifact (PIE-793: an [artifact::path] line, a .jsx, .html, .svg or .mermaid file claude.ai would run) running on its web page, in the person's browser; an agent is given its address instead. n= as images lists them, or line=; left out, the one that's the [ ] position",
    keys: "⏎ while an artifact's card is the [ ] position, a click on its card or its [open ↗]",
    touches: "nothing", replay: "safe",
    args: { ...IMAGE_ARGS },
    examples: [
      { act: "artifact.open n=1", does: "opens the first artifact on its web page; an agent is given the address" },
    ],
    async run(which, { surface, host }, actor) {
      const ref = await surface.imageNamed(which, actor);
      if (ref.spec.kind !== "artifact") throw new ActionRefused("that's an image, not an artifact: element.open opens it in the system viewer");
      return surface.openArtifact(ref, host);
    },
  }),
  "artifact.share": def({
    summary: "share an artifact on its own (PIE-1266): a link anyone can open, that shows that artifact and nothing else, ends by itself after ttl= (1h by default; never keeps it until revoked) and is ended with share.revoke. The link is copied for the person; an agent is given it in the answer. n= as images lists them, or line=; left out, the one that's the [ ] position",
    keys: "a click on its card's [share]",
    touches: "nothing", replay: "ask",
    args: { ...IMAGE_ARGS, ttl: { type: "string", optional: true, about: "how long it lives: 30m, 1h (the default), 2h30m, up to 24h, or never" } },
    examples: [
      { act: "artifact.share n=1 ttl=never", does: "shares the first artifact on its own until it is revoked, and copies the link" },
    ],
    async run({ ttl, ...which }, { surface, host }, actor) {
      const ref = await surface.imageNamed(which, actor);
      if (ref.spec.kind !== "artifact") throw new ActionRefused("that's an image, not an artifact: share.start shares notes");
      return surface.shareArtifact(ref, ttl, host, actor);
    },
  }),
  "image.size": def({
    summary: "size an image or a picture fence (PIE-532, PIE-1583): to= its width (cells, N% of the reader, full, or none for its own), height= its rows (a number, or none), or by=1|-1 one step (a quarter, a third, a half, two thirds, three quarters, full; on the header, a ```svg or ```mermaid fence and a script's drawing, its height by the steps image.look prop=height takes; a step that would draw the same stops there and says so). Its aspect is kept. Written as [size::…] [height::…] on its line (a fence: size= height= words on its opening line) through the note's save, the picture found by who it is at the revision read now, recorded as whoever asks; ctrl+z (image.undo) puts it back",
    keys: "+ - while an image is the [ ] position, a click on its caption's − or +",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {
      ...IMAGE_ARGS,
      to: { type: "string", optional: true, about: "its width: cells (40), a share of the reader (50%), full, or none" },
      height: { type: "string", optional: true, about: "its height in rows (12), or none" },
      by: { type: "number", optional: true, about: "1 a step bigger, -1 a step smaller" },
    },
    examples: [
      { act: "image.size n=1 to=50%", does: "sizes the first image to half the reader's width" },
      { act: "image.size line=8 by=1", does: "makes the image on line 8 one step bigger" },
    ],
    async run({ to, height, by, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        if (to === undefined && height === undefined && by === undefined) throw new ActionRefused("say to= (a width: 40, 50% or full), height= (rows) or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (a step), not ${by}`);
        if (by !== undefined && (to !== undefined || height !== undefined)) throw new ActionRefused("say by= alone, or to= and height=");
        const ref = await surface.imageNamed(which, actor), hero = ref.spec.layout === "hero";
        const set: Partial<Record<MediaAttr, string | null>> = {};
        if (by !== undefined) {
          const step = surface.pictureStep(ref, by, host);
          if ("stop" in step) { host.ctx.flash(step.stop); throw new ActionRefused(step.stop); }
          Object.assign(set, step.set);
        }
        if (to !== undefined) {
          if (hero) throw new ActionRefused("a header image is the reader's full width; its height is image.size height=");
          if (to.trim().toLowerCase() === "none") set.size = null;
          else { const sz = parseSize(to); if (!sz) throw new ActionRefused(`to is a width: cells (40), a share (50%) or full; not ${JSON.stringify(to)}`); set.size = sizeText(sz); }
        }
        if (height !== undefined) {
          const v = height.trim().toLowerCase();
          if (v === "none") set.height = null;
          else if (/^\d{1,3}$/.test(v) && +v > 0) set.height = v;
          else throw new ActionRefused(`height is a number of rows or none; not ${JSON.stringify(height)}`);
        }
        const what = [set.size !== undefined ? `width ${set.size ?? "its own"}` : "", set.height !== undefined ? `height ${set.height === null ? "its own" : `${set.height} rows`}` : ""].filter(Boolean).join(", ");
        return surface.changeImage(ref, set, what, host, actor);
      });
    },
  }),
  "image.align": def({
    summary: "place an image left, center or right in the reader (PIE-532): to=, or by=1|-1 one place right or left. Written as [align::…] on its line (left takes it out: it's where an image is) through the note's save like image.size",
    keys: "← → while an image is the [ ] position, a click on its caption's ◂ or ▸",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...IMAGE_ARGS, to: { type: "string", optional: true, about: "left, center or right" }, by: { type: "number", optional: true, about: "1 one place right, -1 one place left" } },
    examples: [
      { act: "image.align n=1 to=center", does: "centres the first image in the reader" },
      { act: "image.align n=2 by=1", does: "moves the second image one place right" },
    ],
    async run({ to, by, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        if ((to === undefined) === (by === undefined)) throw new ActionRefused("say to=left|center|right or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (one place), not ${by}`);
        const ref = await surface.imageNamed(which, actor);
        if (ref.spec.layout === "hero") throw new ActionRefused("a header image is the reader's full width: it has no place to move to (image.hero on=false makes it an image in the text)");
        const now = ALIGNS.indexOf(ref.spec.align ?? "left");
        const want = to !== undefined ? to.trim().toLowerCase() : ALIGNS[Math.max(0, Math.min(2, now + (by! > 0 ? 1 : -1)))]!;
        if (!(ALIGNS as readonly string[]).includes(want)) throw new ActionRefused(`to is left, center or right; not ${JSON.stringify(to)}`);
        return surface.changeImage(ref, { align: want === "left" ? null : want }, want, host, actor);
      });
    },
  }),
  "image.hero": def({
    summary: "make an image the note's header (PIE-532): drawn above the title, the reader's full width, at most a third of its height (height= on image.size sets its rows), cropped to fill. on=true writes [layout::hero] on its line and takes it off any other image's (one save); on=false takes it off; left out, it toggles. Through the note's save like image.size",
    keys: "H while an image is the [ ] position, a click on its caption's ▀ header",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...IMAGE_ARGS, on: { type: "boolean", optional: true, about: "true: it's the header; false: it isn't; left out, it toggles" } },
    examples: [
      { act: "image.hero n=1 on=true", does: "makes the first image the note's header, above the title" },
      { act: "image.hero n=1 on=false", does: "turns the header image back into an image in the text" },
    ],
    async run({ on, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = notArtifact(await surface.imageNamed(which, actor));
        const want = on ?? ref.spec.layout !== "hero";
        const m = await surface.whole();
        const others = want ? surface.imagesIn(m).filter(x => x.id !== ref.id && x.spec.layout === "hero").map(x => ({ id: x.id, kind: x.kind, set: { layout: null } })) : [];
        return surface.changeImage(ref, { layout: want ? "hero" : null }, want ? "the note's header" : "not the header", host, actor, others);
      });
    },
  }),
  "image.fit": def({
    summary: "how a header image too tall for its rows is drawn (PIE-532): to=cover crops it to fill the width, to=contain shows it whole, centred; left out, the other one. Written as [fit::…] on its line (cover takes it out: it's the default) through the note's save like image.size",
    keys: "= while the header image is the [ ] position, a click on its caption's [whole] or [fill]",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...IMAGE_ARGS, to: { type: "string", optional: true, about: "cover or contain; left out, the other one" } },
    examples: [
      { act: "image.fit n=1 to=contain", does: "shows the header image whole, centred" },
      { act: "image.fit n=1", does: "switches the header image between cropped to fill and shown whole" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const ref = notArtifact(await surface.imageNamed(which, actor));
        const want = to === undefined ? (ref.spec.fit === "contain" ? "cover" : "contain") : to.trim().toLowerCase();
        if (want !== "cover" && want !== "contain") throw new ActionRefused(`to is cover or contain, not ${JSON.stringify(to)}`);
        return surface.changeImage(ref, { fit: want === "cover" ? null : want }, want === "contain" ? "shown whole" : "cropped to fill", host, actor);
      });
    },
  }),
  "image.dim": def({
    summary: "how much an image is dimmed (PIE-532): to= a number from 0 (as it is) to 1 (black), or auto (the default: a bright image's mean luminance held at 0.3). Written as [dim::…] on its line through the note's save like image.size. No key brightens an image: the door is dark-first",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...IMAGE_ARGS, to: { type: "string", about: "0 to 1, or auto" } },
    examples: [
      { act: "image.dim n=1 to=0.4", does: "dims the first image by 0.4, writing [dim::0.4] on its line" },
      { act: "image.dim n=1 to=auto", does: "dims the first image only as far as a bright one needs" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const v = to.trim().toLowerCase();
        const d = v === "auto" ? null : parseDim(v);
        if (v !== "auto" && d === null) throw new ActionRefused(`to is a number from 0 (as it is) to 1 (black), or auto; not ${JSON.stringify(to)}`);
        const ref = notArtifact(await surface.imageNamed(which, actor));
        return surface.changeImage(ref, { dim: d === null ? null : String(d) }, d === null ? "dimmed as bright images are" : `dim ${d}`, host, actor);
      });
    },
  }),
  "image.look": def({
    summary: "change the note's header image's look (PIE-1361): prop= one of HERO_PROPS (height, focus.x, focus.y, fit, dim, tint, fade, blur, bleed, title, scroll) with to= a value (none takes it off the line: the built-in) or by=1|-1 a step; or focus=x,y for both halves at once. Written as that property on the hero's own line ([tint::0.5], [hero-focus::0.3,0.6]) through the note's save, checked against the line as drawn, recorded as whoever asks; ctrl+z (image.undo) puts it back. The tune's hero rows and the header's drags run this",
    keys: [{ keys: "− + ×", does: "the tune's hero rows" }, { keys: "wheel", does: "the tune's hero rows" }, { keys: "drag", does: "inside the header picture (focus)" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {
      ...IMAGE_ARGS,
      prop: { type: "string", optional: true, about: "height, focus.x, focus.y, fit, dim, tint, fade, blur, bleed, title or scroll" },
      to: { type: "string", optional: true, about: "its value, or none" },
      by: { type: "number", optional: true, about: "1 a step up, -1 a step down" },
      focus: { type: "string", optional: true, about: "x,y: the point the crop keeps in view, each 0 to 1" },
    },
    examples: [
      { act: "image.look prop=tint to=0.5", does: "tints the header picture halfway toward the tile's tone, writing [tint::0.5] on its line" },
      { act: "image.look prop=title by=1", does: "puts the title over the picture's bottom ([title::over])" },
      { act: "image.look focus=0.3,0.7", does: "keeps the point 30% across and 70% down in view ([hero-focus::0.3,0.7])" },
    ],
    async run({ prop, to, by, focus, ...which }, { surface, host }, actor) {
      return surface.inTurn(async () => {
        const named = which.n !== undefined || which.line !== undefined ? await surface.imageNamed(which, actor) : surface.heroRef(await surface.whole());
        if (!named) throw new ActionRefused("this note has no header image: H on an image (image.hero) makes it one");
        const ref = notArtifact(named);
        if (ref.spec.layout !== "hero") throw new ActionRefused(`the image on line ${ref.line + 1} isn't the header: image.look changes the header's ([layout::hero]); image.hero makes it one`);
        if (focus !== undefined) {
          if (prop !== undefined || to !== undefined || by !== undefined) throw new ActionRefused("say focus=x,y alone, or prop= with to= or by=");
          const f = parseFocus(focus);
          if (!f) throw new ActionRefused(`focus is x,y, each 0 to 1 (0.3,0.7); not ${JSON.stringify(focus)}`);
          const r = (x: number) => String(Math.round(x * 100) / 100);
          return surface.changeImage(ref, { "hero-focus": `${r(f.x)},${r(f.y)}` }, `focus ${r(f.x)},${r(f.y)}`, host, actor);
        }
        if (prop === undefined || !isHeroProp(prop)) throw new ActionRefused(`prop is one of ${HERO_PROP_NAMES.join(", ")}`);
        if ((to === undefined) === (by === undefined)) throw new ActionRefused("say to= (a value, or none) or by=1|-1");
        if (by !== undefined && by !== 1 && by !== -1) throw new ActionRefused(`by is 1 or -1 (a step), not ${by}`);
        const drawnRows = prop === "height" && ref.spec.height === undefined ? surface.heroRowsDrawn() : null;
        // A height left out steps from the rows drawn (or, none drawn, the reader's usual header).
        const value = to ?? heroPropStep(prop, heroPropText(ref.spec, prop) ?? (prop === "height" ? String(drawnRows ?? HERO_ROWS) : undefined), by!);
        const r = heroPropSet(ref.spec, prop, value);
        if ("problem" in r) throw new ActionRefused(r.problem);
        return { ...(await surface.changeImage(ref, r.set, `${prop} ${value === "none" ? `as built in (${HERO_PROPS[prop].none})` : value}`, host, actor)), prop, value };
      });
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const IMAGE_UNDO_DEFS = {
  "image.undo": def({
    summary: "undo the last image change (size, place, header) made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the line changed again since",
    keys: readerKeys("image.undo", { via: "when an image change was the last change made here" }),
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => surface.undoImage(host, actor),
  }),
} satisfies Record<string, ActionDef<any, On>>;
