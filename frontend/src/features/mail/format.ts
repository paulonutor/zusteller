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

/** Tinted chip that stays legible in both themes. */
export const labelChipStyle = (color = '#888'): CSSProperties =>
  ({
    '--chip': color,
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    color: `color-mix(in srgb, ${color} 65%, var(--foreground))`,
  }) as CSSProperties;
