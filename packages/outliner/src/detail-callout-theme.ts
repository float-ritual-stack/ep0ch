import { visibleWidth } from "@earendil-works/pi-tui";
import { BUILTIN_CALLOUTS, UNKNOWN_CALLOUT_ICON, type CalloutRegistry, type CalloutTone, type CalloutType } from "@ep0ch/outline-core/callouts";

export interface DetailCalloutStyle {
  foreground: string;
  background: string;
  accent: string;
  glyph: string;
}

export interface DetailCalloutTheme {
  readonly types: Readonly<Record<string, DetailCalloutStyle>>;
  readonly fallback: DetailCalloutStyle;
  /**
   * The outline's callout types (PIE-538, `callouts.types`): which names and aliases mean which type, and the types the
   * outline declares. Detail sets it once the service answers; without it, outline-core's built-ins.
   */
  registry?: CalloutRegistry;
}

export interface DetailCalloutThemeResolution {
  theme: DetailCalloutTheme;
  errors: string[];
}

type DetailCalloutStyleOverride = Partial<DetailCalloutStyle>;

const BLUE: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#D7E8F8",
  background: "#162637",
  accent: "#6CB6FF",
};
const GREEN: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#DCF6E8",
  background: "#173026",
  accent: "#7AD9A5",
};
const VIOLET: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#EFE5FF",
  background: "#282139",
  accent: "#C099FF",
};
const AMBER: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#FFF0C7",
  background: "#392E18",
  accent: "#EBCB8B",
};
const CORAL: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#FFE0E3",
  background: "#3A2025",
  accent: "#F27D7D",
};
const NEUTRAL: Omit<DetailCalloutStyle, "glyph"> = {
  foreground: "#D9E0E7",
  background: "#20262D",
  accent: "#AAB7C4",
};

/** Each tone (outline-core's, one per type) in Detail's true-colour palette. */
export const DETAIL_CALLOUT_TONES: Readonly<Record<CalloutTone, Omit<DetailCalloutStyle, "glyph">>> = {
  blue: BLUE, green: GREEN, violet: VIOLET, amber: AMBER, coral: CORAL, neutral: NEUTRAL,
};

/** The built-in types (outline-core's one list: their names, icons and tones), in Detail's palette. */
export const DEFAULT_DETAIL_CALLOUT_THEME: DetailCalloutTheme = {
  types: Object.fromEntries(BUILTIN_CALLOUTS.map((type) => [type.name, { ...DETAIL_CALLOUT_TONES[type.tone], glyph: type.icon }])),
  fallback: { ...NEUTRAL, glyph: UNKNOWN_CALLOUT_ICON },
};

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const STYLE_FIELDS = new Set<keyof DetailCalloutStyle>([
  "foreground",
  "background",
  "accent",
  "glyph",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validGlyph(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value) &&
    visibleWidth(value) === 1;
}

function resolveStyleOverride(
  name: string,
  base: DetailCalloutStyle,
  value: unknown,
  errors: string[],
): DetailCalloutStyle {
  if (!isRecord(value)) {
    errors.push(`${name} must be an object`);
    return base;
  }

  const override: DetailCalloutStyleOverride = {};
  for (const [field, candidate] of Object.entries(value)) {
    if (!STYLE_FIELDS.has(field as keyof DetailCalloutStyle)) {
      errors.push(`${name}.${field} is not supported`);
      continue;
    }
    if (field === "glyph") {
      if (validGlyph(candidate)) override.glyph = candidate;
      else errors.push(`${name}.glyph must be printable and exactly one terminal column`);
      continue;
    }
    if (typeof candidate === "string" && COLOR_PATTERN.test(candidate)) {
      override[field as "foreground" | "background" | "accent"] = candidate.toUpperCase();
    } else {
      errors.push(`${name}.${field} must be a #RRGGBB color`);
    }
  }
  return { ...base, ...override };
}

export function resolveDetailCalloutTheme(overrides: unknown): DetailCalloutThemeResolution {
  if (overrides === undefined) {
    return { theme: DEFAULT_DETAIL_CALLOUT_THEME, errors: [] };
  }
  if (!isRecord(overrides)) {
    return {
      theme: DEFAULT_DETAIL_CALLOUT_THEME,
      errors: ["callout theme must be an object"],
    };
  }

  const errors: string[] = [];
  const types: Record<string, DetailCalloutStyle> = {
    ...DEFAULT_DETAIL_CALLOUT_THEME.types,
  };
  let fallback = DEFAULT_DETAIL_CALLOUT_THEME.fallback;
  for (const [name, value] of Object.entries(overrides)) {
    if (name === "fallback") {
      fallback = resolveStyleOverride(name, fallback, value, errors);
      continue;
    }
    if (!Object.hasOwn(types, name)) {
      errors.push(`${name} is not a canonical callout type`);
      continue;
    }
    const base = types[name]!;
    types[name] = resolveStyleOverride(name, base, value, errors);
  }
  return { theme: { types, fallback }, errors };
}

export function detailCalloutThemeFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): DetailCalloutThemeResolution {
  const encoded = env.OUTLINER_CALLOUT_THEME?.trim();
  if (!encoded) return { theme: DEFAULT_DETAIL_CALLOUT_THEME, errors: [] };
  try {
    return resolveDetailCalloutTheme(JSON.parse(encoded));
  } catch {
    return {
      theme: DEFAULT_DETAIL_CALLOUT_THEME,
      errors: ["OUTLINER_CALLOUT_THEME must be valid JSON"],
    };
  }
}

/**
 * How a callout of `canonicalType` is painted: a type the outline declares (or restyles) in its own icon and tone,
 * a built-in as the theme has it, anything else as the fallback.
 */
export function detailCalloutStyle(
  theme: DetailCalloutTheme,
  canonicalType: string,
  type: CalloutType | null = theme.registry?.resolve(canonicalType) ?? null,
): DetailCalloutStyle {
  if (type?.block) return { ...DETAIL_CALLOUT_TONES[type.tone], glyph: type.icon };
  return Object.hasOwn(theme.types, canonicalType)
    ? theme.types[canonicalType]!
    : theme.fallback;
}
