import { afterEach, expect, it, vi } from 'vitest';
import { flyRowsToTarget, flightEndsAt } from '@/features/mail/dropAnimation';

function setup() {
  vi.useFakeTimers();
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
  const animation = { cancel: vi.fn(), onfinish: null, oncancel: null };
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => animation),
  });
  const root = document.createElement('div');
  root.innerHTML =
    '<div data-drop-target="mailbox:junk"></div><div data-row-slot><div id="row-flight-test">Mail</div></div>';
  document.body.append(root);
  const row = root.querySelector<HTMLElement>('#row-flight-test')!;
  const slot = row.parentElement!;
  return { root, row, slot, animation };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});

it('keeps a slow move hidden until completion instead of restoring on a timeout', () => {
  const { row, slot } = setup();
  const finish = flyRowsToTarget(['flight-test'], { kind: 'mailbox', mailbox: 'junk' })!;
  vi.advanceTimersByTime(2500);
  expect(row.style.opacity).toBe('0');
  expect(slot.dataset.fly).toBe('go');
  finish(true);
  vi.runAllTimers();
  expect(row.style.opacity).toBe('0');
  expect(flightEndsAt('flight-test')).toBe(0);
});

it.each([0, 2500])(
  'restores a failed move after %ims and leaves no later gap collapse',
  (delay) => {
    const { row, slot, animation } = setup();
    const finish = flyRowsToTarget(['flight-test'], { kind: 'mailbox', mailbox: 'junk' })!;
    vi.advanceTimersByTime(delay);
    finish(false);
    expect(row.style.opacity).toBe('');
    expect(slot.dataset.fly).toBeUndefined();
    expect(animation.cancel).toHaveBeenCalled();
    vi.runAllTimers();
    expect(slot.dataset.state).toBeUndefined();
    expect(flightEndsAt('flight-test')).toBe(0);
  },
);
