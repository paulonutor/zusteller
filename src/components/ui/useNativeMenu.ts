import { useEffect, useRef } from 'react';
import { useServices } from '@/app/services';
import type { MenuItemSpec } from './Menu';
import type { NativeMenuItem } from '@/platform';

/** Convert the UI menu while keeping callback closures inside the frontend. */
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
        if (!spec.disabled) actions.set(id, spec.onSelect);
        return { kind: 'item', id, label: spec.label, disabled: spec.disabled };
      case 'check':
        actions.set(id, spec.onSelect);
        return { kind: 'check', id, label: spec.label, checked: spec.state === 'all' };
      case 'sub':
        return {
          kind: 'sub',
          label: spec.label,
          disabled: spec.disabled,
          items: toNative(spec.items, spec.disabled ? new Map() : actions, `${id}.`),
        };
    }
  });
}

let openMenus = 0;

export function useNativeMenu(onOpenChange?: (open: boolean) => void) {
  const { platform } = useServices();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const native = platform.showContextMenu;
  if (!native) return undefined;
  return async (items: MenuItemSpec[], trigger: HTMLElement, fallback: () => void) => {
    if (busy.current) return;
    busy.current = true;
    const focus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : (trigger.closest<HTMLElement>('[role="listbox"]') ?? trigger);
    const actions = new Map<string, () => void>();
    const tree = toNative(items, actions);
    openMenus++;
    document.documentElement.dataset.nativeMenuOpen = '';
    onOpenChange?.(true);
    let failed = false;
    try {
      const id = await native.call(platform, tree);
      if (mounted.current && id !== null) actions.get(id)?.();
    } catch {
      failed = true;
    } finally {
      busy.current = false;
      if (--openMenus === 0) delete document.documentElement.dataset.nativeMenuOpen;
      if (mounted.current) {
        onOpenChange?.(false);
        if (focus.isConnected) focus.focus({ preventScroll: true });
        else
          document.querySelector<HTMLElement>('[role="listbox"]')?.focus({ preventScroll: true });
      }
    }
    if (failed && mounted.current) fallback();
  };
}
