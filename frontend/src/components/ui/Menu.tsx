/** Thin styled wrappers over Radix menus, shared by context menus and dropdowns. */
import * as DM from '@radix-ui/react-dropdown-menu';
import * as CM from '@radix-ui/react-context-menu';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const content =
  'z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-surface-raised/95 p-1 text-[13px] text-foreground shadow-lg backdrop-blur-xl';
const item =
  'relative flex h-7 cursor-default select-none items-center gap-2 rounded-md px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg';

export type MenuItemSpec =
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; onSelect: () => void }
  | {
      kind: 'check';
      label: string;
      state: 'all' | 'some' | 'none';
      color?: string;
      onSelect: () => void;
    }
  | { kind: 'separator' }
  | { kind: 'sub'; label: string; disabled?: boolean; items: MenuItemSpec[] };

const Shortcut = ({ children }: { children: ReactNode }) => (
  <span className="ml-auto pl-6 text-[12px] opacity-70">{children}</span>
);

function CheckMark({ state }: { state: 'all' | 'some' | 'none' }) {
  return (
    <span className="flex size-4 items-center justify-center">
      {state === 'all' && <Check size={14} />}
      {state === 'some' && <Minus size={14} />}
    </span>
  );
}

type Kit = typeof DM | typeof CM;

function render(K: Kit, spec: MenuItemSpec, i: number): ReactNode {
  switch (spec.kind) {
    case 'separator':
      return <K.Separator key={i} className="my-1 h-px bg-border" />;
    case 'item':
      return (
        <K.Item key={i} className={item} disabled={spec.disabled} onSelect={spec.onSelect}>
          {spec.label}
          {spec.shortcut && <Shortcut>{spec.shortcut}</Shortcut>}
        </K.Item>
      );
    case 'check':
      return (
        <K.Item key={i} className={item} onSelect={spec.onSelect}>
          <CheckMark state={spec.state} />
          {spec.color && (
            <span className="size-2.5 rounded-full" style={{ background: spec.color }} />
          )}
          {spec.label}
        </K.Item>
      );
    case 'sub':
      return (
        <K.Sub key={i}>
          <K.SubTrigger className={cn(item, 'data-[state=open]:bg-hover')} disabled={spec.disabled}>
            {spec.label}
            <span className="ml-auto opacity-60">›</span>
          </K.SubTrigger>
          <K.Portal>
            <K.SubContent className={content} sideOffset={4}>
              {spec.items.map((s, j) => render(K, s, j))}
            </K.SubContent>
          </K.Portal>
        </K.Sub>
      );
  }
}

export function DropdownMenu({
  trigger,
  items,
  ...rest
}: { trigger: ReactNode; items: MenuItemSpec[] } & Omit<
  ComponentProps<typeof DM.Content>,
  'children'
>) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className={content} sideOffset={4} align="end" {...rest}>
          {items.map((s, i) => render(DM, s, i))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function ContextMenu({
  children,
  items,
  onOpenChange,
}: {
  children: ReactNode;
  /** Pass a function to build items lazily (only when the menu opens). */
  items: MenuItemSpec[] | (() => MenuItemSpec[]);
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CM.Root modal={false} onOpenChange={onOpenChange}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={content}>
          {(typeof items === 'function' ? items() : items).map((s, i) => render(CM, s, i))}
        </CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
