import type { EditorRgbColor } from "./editorTypes";

export const DEFAULT_SOLID_COLOR: EditorRgbColor = {
  r: 36,
  g: 118,
  b: 255
};

export const DEFAULT_SOLID_DURATION_SEC = 5;

export function normalizeSolidDuration(
  durationSec: number,
  fallbackDurationSec = DEFAULT_SOLID_DURATION_SEC
): number {
  if (!Number.isFinite(durationSec)) {
    return fallbackDurationSec;
  }

  return Math.max(0.2, Math.round(durationSec * 10) / 10);
}

export function normalizeRgbColor(color: EditorRgbColor): EditorRgbColor {
  return {
    r: normalizeRgbChannel(color.r),
    g: normalizeRgbChannel(color.g),
    b: normalizeRgbChannel(color.b)
  };
}

export function rgbColorToCss(color: EditorRgbColor): string {
  const normalizedColor = normalizeRgbColor(color);
  return `rgb(${normalizedColor.r}, ${normalizedColor.g}, ${normalizedColor.b})`;
}

export function rgbColorToLabel(color: EditorRgbColor): string {
  const normalizedColor = normalizeRgbColor(color);
  return `RGB(${normalizedColor.r}, ${normalizedColor.g}, ${normalizedColor.b})`;
}

export function rgbColorToHex(color: EditorRgbColor): string {
  const normalizedColor = normalizeRgbColor(color);
  const toHex = (value: number) => value.toString(16).padStart(2, "0").toUpperCase();

  return `#${toHex(normalizedColor.r)}${toHex(normalizedColor.g)}${toHex(normalizedColor.b)}`;
}

function normalizeRgbChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(255, Math.round(value)));
}
