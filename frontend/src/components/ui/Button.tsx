import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'subtle';
  size?: 'sm' | 'md';
  active?: boolean;
};

/** Compact, native-feeling toolbar button. Icon-only buttons must pass aria-label. */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'ghost', size = 'md', active, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'no-drag inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-[13px] text-foreground transition-colors',
        'hover:bg-hover active:bg-active disabled:pointer-events-none disabled:opacity-35',
        size === 'md' ? 'h-7 min-w-7 px-1.5' : 'h-6 min-w-6 px-1',
        variant === 'subtle' && 'bg-hover',
        active && 'bg-active',
        className,
      )}
      {...props}
    />
  );
});
