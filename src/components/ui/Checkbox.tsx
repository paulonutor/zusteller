import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

type Props = {
  checked: boolean | 'mixed';
  onChange: (e: React.MouseEvent) => void;
  label: string;
  className?: string;
  tabIndex?: number;
  /**
   * Pointer-only affordance for use inside another interactive widget (e.g. a listbox option, where
   * a nested button is invalid ARIA). Not focusable, hidden from assistive tech; the same action
   * must be reachable elsewhere (keyboard shortcut, toolbar, context menu).
   */
  decorative?: boolean;
};

/** Small macOS-style checkbox. Presentational: parent owns state. */
export function Checkbox({
  checked,
  onChange,
  label,
  className,
  tabIndex = -1,
  decorative,
}: Props) {
  const cls = cn(
    'no-drag flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors',
    checked
      ? 'border-accent bg-accent text-accent-fg'
      : 'border-faint bg-background hover:border-muted',
    className,
  );
  const icon = (
    <>
      {checked === true && <Check size={11} strokeWidth={3} />}
      {checked === 'mixed' && <Minus size={11} strokeWidth={3} />}
    </>
  );
  if (decorative)
    return (
      <span
        aria-hidden="true"
        data-row-check
        data-checked={String(checked)}
        onClick={(e) => {
          e.stopPropagation();
          onChange(e);
        }}
        className={cls}
      >
        {icon}
      </span>
    );
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
      className={cls}
    >
      {icon}
    </button>
  );
}
