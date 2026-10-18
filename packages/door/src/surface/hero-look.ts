import type { MediaSpec } from "@ep0ch/outline-core/media-line";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { surfaceRgb, theme, TONE_INDEX } from "../theme";

/** The line owns this note's look; the cascade supplies what its author left out. */
export function heroLook(spec: MediaSpec, v: StyleValues) {
  const height = v["header.image.height"];
  const tint = spec.tint ?? Number(v["header.image.tint"]);
  return {
    ...spec,
    height: spec.height ?? (spec.heightShare === undefined && !height.endsWith("%") ? Number(height) : undefined),
    heightShare: spec.heightShare ?? (spec.height === undefined && height.endsWith("%") ? parseInt(height) / 100 : undefined),
    fit: spec.fit ?? v["header.image.fit"],
    focus: spec.focus ?? { x: 0.5 + v["header.image.x"] / 100, y: 0.5 + v["header.image.y"] / 100 },
    bleed: spec.bleed ?? v["header.image.bleed"],
    scroll: spec.scroll ?? v["header.image.scroll"],
    title: spec.title ?? v["header.title"],
    pixels: {
      dim: spec.dim ?? (v["header.image.dim"] === "auto" ? undefined : Number(v["header.image.dim"])),
      blur: spec.blur ?? v["header.image.blur"],
      tint, tone: theme().palette[TONE_INDEX[v.tone]]!,
      fade: spec.fade ?? Number(v["header.image.fade"]),
      ground: surfaceRgb(v.bg, v["bg.strength"]) ?? theme().ground ?? theme().palette[0]!,
    },
  };
}
