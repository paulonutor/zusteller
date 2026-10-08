import type { Label } from '@/domain/mail';
import { cn } from '@/lib/cn';
import { labelChipStyle } from './format';

/** The one label chip, used in the list, the overflow popover and the reader header. */
export function LabelChip({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      data-label-chip
      className={cn(
        'max-w-24 shrink-0 truncate rounded px-1.5 text-[11px] leading-[16px]',
        className,
      )}
      style={labelChipStyle(label.color)}
    >
      {label.name}
    </span>
  );
}
