import { HERO_PROPS, type MediaSpec } from "@ep0ch/outline-core/media-line";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { surfaceRgb, theme, TONE_INDEX } from "../theme";

/**
 * A header image's look (PIE-1361): its own line's, and nothing else's. What its author left out is the built-in
 * (outline-core's HERO_PROPS say which); the look cascade gives only the colours it's drawn toward (`tone`, `bg`).
 */
export function heroLook(spec: MediaSpec, v: StyleValues) {
  return {
    ...spec,
    fit: spec.fit ?? (HERO_PROPS.fit.none as "cover"),
    focus: spec.focus ?? { x: Number(HERO_PROPS["focus.x"].none), y: Number(HERO_PROPS["focus.y"].none) },
    bleed: spec.bleed ?? (HERO_PROPS.bleed.none as "full"),
    scroll: spec.scroll ?? (HERO_PROPS.scroll.none as "scroll"),
    title: spec.title ?? (HERO_PROPS.title.none as "below"),
    pixels: {
      dim: spec.dim,
      blur: spec.blur ?? Number(HERO_PROPS.blur.none),
      tint: spec.tint ?? Number(HERO_PROPS.tint.none), tone: theme().palette[TONE_INDEX[v.tone]]!,
      fade: spec.fade ?? Number(HERO_PROPS.fade.none),
      ground: surfaceRgb(v.bg, v["bg.strength"]) ?? theme().ground ?? theme().palette[0]!,
    },
  };
}
