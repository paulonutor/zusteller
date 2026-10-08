import type { CSSProperties } from 'react';
import type { Address } from '@/domain/mail';

export const displayName = (a: Address) => a.name?.trim() || a.email.split('@')[0] || a.email;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Compact list timestamp: time today, "Yesterday", weekday this week, else short date. */
export function formatListDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (sameDay(d, now)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  const days = (now.getTime() - d.getTime()) / 86_400_000;
  if (days < 6) return d.toLocaleDateString([], { weekday: 'short' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    [],
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: '2-digit', month: 'short', day: 'numeric' },
  );
}

export const formatFullDate = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export const formatAddress = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Text colour for a chip: white, or near-black when white would fall below 4.5:1. */
export function chipTextColor(color: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#fff';
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // The chip paints the label colour mixed 80/20 with a theme base; ~#4a4a4f is the middle of both.
  const mix = (v: number, base: number) => 0.8 * v + 0.2 * base;
  const lum =
    0.2126 * channel(mix(r!, 0x4a)) +
    0.7152 * channel(mix(g!, 0x4a)) +
    0.0722 * channel(mix(b!, 0x4f));
  return 1.05 / (lum + 0.05) >= 4.5 ? '#fff' : '#111';
}

/** Tinted chip that stays legible in both themes. */
export const labelChipStyle = (color = '#888'): CSSProperties =>
  ({
    '--chip': color,
    '--chip-fg': chipTextColor(color),
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    color: `color-mix(in srgb, ${color} 65%, var(--foreground))`,
  }) as CSSProperties;

/** Up to two initials for an avatar: first + last name word, else the email's first letter. */
export function initials(a: Address): string {
  const words = (a.name?.trim() ?? '').split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const pick = (w: string) => (w.match(/\p{L}/u)?.[0] ?? '').toUpperCase();
  if (words.length >= 2) return pick(words[0]!) + pick(words[words.length - 1]!);
  if (words.length === 1) return pick(words[0]!);
  return pick(a.email.split('@')[0] ?? '') || '?';
}

/** Deterministic hue (0-359) from an email, so a sender always gets the same avatar colour. */
export function avatarHue(email: string): number {
  let h = 2166136261;
  for (const ch of email.trim().toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 360;
}
