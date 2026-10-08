/** Thin styled wrappers over Radix menus, shared by context menus and dropdowns. */
import * as DM from '@radix-ui/react-dropdown-menu';
import * as CM from '@radix-ui/react-context-menu';
import { Check, Minus } from 'lucide-react';
import { cloneElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useServices } from '@/app/services';
import type { NativeMenuItem } from '@/platform';

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

/** Flatten specs to the host's serializable form; `actions` maps each generated id to its handler. */
function toNative(
  specs: MenuItemSpec[],
  actions: Map<string, () => void>,
  prefix = '',
): NativeMenuItem[] {
  return specs.map((spec, i): NativeMenuItem => {
    const id = `${prefix}${i}`;
    switch (spec.kind) {
      case 'separator':
        return { kind: 'separator' };
      case 'item':
        actions.set(id, spec.onSelect);
        return { kind: 'item', id, label: spec.label, disabled: spec.disabled };
      case 'check':
        actions.set(id, spec.onSelect);
        return { kind: 'check', id, label: spec.label, checked: spec.state === 'all' };
      case 'sub':
        return {
          kind: 'sub',
          label: spec.label,
          disabled: spec.disabled,
          items: toNative(spec.items, actions, `${id}.`),
        };
    }
  });
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
  const { platform } = useServices();
  const resolve = () => (typeof items === 'function' ? items() : items);
  const native = platform.showContextMenu?.bind(platform);

  if (native) {
    // Native hosts draw the menu themselves; the trigger just needs a contextmenu handler.
    return cloneElement(children as ReactElement<ComponentProps<'div'>>, {
      onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        onOpenChange?.(true);
        const actions = new Map<string, () => void>();
        const tree = toNative(resolve(), actions);
        void native(tree, (id) => actions.get(id)?.()).catch(() => undefined);
      },
    });
  }

  return (
    <CM.Root modal={false} onOpenChange={onOpenChange}>
      <CM.Trigger asChild>{children}</CM.Trigger>
      <CM.Portal>
        <CM.Content className={content}>{resolve().map((s, i) => render(CM, s, i))}</CM.Content>
      </CM.Portal>
    </CM.Root>
  );
}
