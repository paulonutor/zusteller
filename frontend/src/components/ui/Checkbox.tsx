import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean | 'mixed';
  onChange: (e: React.MouseEvent) => void;
  label: string;
  className?: string;
  tabIndex?: number;
};

/** Small macOS-style checkbox. Presentational: parent owns state. */
export function Checkbox({ checked, onChange, label, className, tabIndex = -1 }: Props) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={tabIndex}
      onClick={(e) => {
        e.stopPropagation();
        onChange(e);
      }}
      className={cn(
        'no-drag flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        checked
          ? 'border-accent bg-accent text-accent-fg'
          : 'border-faint bg-background hover:border-muted',
        className,
      )}
    >
      {checked === true && <Check size={11} strokeWidth={3} />}
      {checked === 'mixed' && <Minus size={11} strokeWidth={3} />}
    </button>
  );
}
