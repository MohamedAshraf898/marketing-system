import { prisma } from '../db';

export const DEFAULT_BRANDING = { agencyName: 'OG System', primaryColor: '#4f46e5', secondaryColor: '#0f172a' } as const;

/** The settings row is a singleton (id = "singleton"); it is created on first read. */
export async function getSettings() {
  return prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' } });
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** WCAG contrast ratio of white text on the given #rrggbb background. */
export function contrastWithWhite(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  return 1.05 / (lum + 0.05);
}

/** Primary colour carries white button text: it must reach 4.5:1 to be readable. Only a warning, never a rejection. */
export const contrastOk = (hex: string) => contrastWithWhite(hex) >= 4.5;

export interface ImageKind { ext: 'png' | 'jpg' | 'webp' | 'ico'; mime: string }

const startsWith = (buf: Buffer, sig: number[], offset = 0) => buf.length >= offset + sig.length && sig.every((b, i) => buf[offset + i] === b);

/**
 * Content sniffing for branding images. Only PNG / JPEG / WebP / ICO are accepted. SVG (which can carry script) and GIF
 * are deliberately not recognised, so they never reach storage.
 */
export function sniffImage(buf: Buffer): ImageKind | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' };
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' };
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { ext: 'webp', mime: 'image/webp' };
  if (startsWith(buf, [0x00, 0x00, 0x01, 0x00])) return { ext: 'ico', mime: 'image/x-icon' };
  return null;
}

export const looksLikeMarkup = (buf: Buffer) => /^\s*(<\?xml|<svg|<!doctype|<html|<)/i.test(buf.subarray(0, 512).toString('utf8'));

export const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon' };

export function publicBranding(s: Awaited<ReturnType<typeof getSettings>>) {
  return {
    agencyName: s.agencyName,
    primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor,
    hasLogo: !!s.logoKey,
    hasFavicon: !!s.faviconKey,
    contrastOk: contrastOk(s.primaryColor),
    updatedAt: s.updatedAt,
  };
}
