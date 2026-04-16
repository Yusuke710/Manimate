export interface BrandKitAnalysisFonts {
  heading: string | null;
  body: string | null;
  accent: string | null;
}

export interface BrandKitAnalysisResult {
  colors: { primary: string[]; accent: string[]; background: string[] };
  fonts: BrandKitAnalysisFonts;
}

export const BRAND_KIT_FONT_OPTIONS: { group: string; fonts: string[] }[] = [
  { group: "Sans-serif", fonts: ["Inter", "DM Sans", "Poppins", "Roboto", "Open Sans", "Lato", "Montserrat", "Nunito", "Raleway", "Outfit", "Plus Jakarta Sans", "Space Grotesk", "Work Sans", "Barlow", "Josefin Sans", "Quicksand", "Karla", "Mulish", "Rubik", "Urbanist", "Jost", "Be Vietnam Pro"] },
  { group: "Serif", fonts: ["Playfair Display", "DM Serif Display", "Merriweather", "Lora", "Crimson Text", "EB Garamond", "Cormorant Garamond", "Libre Baskerville", "PT Serif", "Spectral", "Fraunces", "Bodoni Moda", "Cardo"] },
  { group: "Display", fonts: ["Syne", "Lexend", "Manrope", "Figtree", "Bebas Neue", "Righteous", "Comfortaa", "Fredoka One", "Exo 2", "Orbitron", "Rajdhani", "Russo One", "Alfa Slab One"] },
  { group: "Handwriting", fonts: ["Dancing Script", "Caveat", "Satisfy", "Great Vibes", "Architects Daughter", "Kalam", "Patrick Hand", "Sacramento", "Permanent Marker"] },
  { group: "Monospace", fonts: ["Roboto Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "Space Mono", "Courier Prime", "Inconsolata", "DM Mono"] },
];

export const ALL_BRAND_KIT_FONT_NAMES = BRAND_KIT_FONT_OPTIONS.flatMap((group) => group.fonts);

const FONT_NAME_BY_LOWER = new Map(
  ALL_BRAND_KIT_FONT_NAMES.map((name) => [name.toLowerCase(), name] as const)
);

export const SUPPORTED_BRAND_KIT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type SupportedBrandKitImageType = (typeof SUPPORTED_BRAND_KIT_IMAGE_TYPES)[number];

const SUPPORTED_BRAND_KIT_IMAGE_TYPE_SET = new Set<string>(SUPPORTED_BRAND_KIT_IMAGE_TYPES);

export function normalizeBrandKitImageMediaType(
  value: string | null | undefined
): SupportedBrandKitImageType | null {
  const candidate = value?.trim().toLowerCase();
  if (!candidate) return null;

  const normalized = candidate === "image/jpg" ? "image/jpeg" : candidate;
  return SUPPORTED_BRAND_KIT_IMAGE_TYPE_SET.has(normalized)
    ? (normalized as SupportedBrandKitImageType)
    : null;
}

export function isSupportedBrandKitImageType(
  value: string | null | undefined
): value is SupportedBrandKitImageType {
  return normalizeBrandKitImageMediaType(value) !== null;
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (!match) return null;
  return `#${match[1].toLowerCase()}`;
}

function normalizeHexArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    const hex = normalizeHex(item);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    normalized.push(hex);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

function normalizeFont(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return FONT_NAME_BY_LOWER.get(value.trim().toLowerCase()) ?? null;
}

function normalizeFontArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    const font = normalizeFont(item);
    if (!font || seen.has(font)) continue;
    seen.add(font);
    normalized.push(font);
    if (normalized.length >= maxItems) break;
  }

  return normalized;
}

function normalizeFontRoles(value: unknown): BrandKitAnalysisFonts {
  if (Array.isArray(value)) {
    const legacyFonts = normalizeFontArray(value, 3);
    return {
      heading: legacyFonts[0] ?? null,
      body: legacyFonts[1] ?? null,
      accent: legacyFonts[2] ?? null,
    };
  }

  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};

  return {
    heading: normalizeFont(record.heading),
    body: normalizeFont(record.body),
    accent: normalizeFont(record.accent),
  };
}

export function normalizeBrandKitAnalysisResult(value: unknown): BrandKitAnalysisResult {
  const record = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  const colors = record.colors && typeof record.colors === "object"
    ? (record.colors as Record<string, unknown>)
    : {};

  return {
    colors: {
      primary: normalizeHexArray(colors.primary, 3),
      accent: normalizeHexArray(colors.accent, 2),
      background: normalizeHexArray(colors.background, 2),
    },
    fonts: normalizeFontRoles(record.fonts),
  };
}
