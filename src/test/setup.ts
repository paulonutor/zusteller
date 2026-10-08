import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Default is 1s, which is too tight for the full-app integration tests under CPU contention.
configure({ asyncUtilTimeout: 4000 });

// jsdom lacks these browser APIs used by the UI.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }) as MediaQueryList;
}
Element.prototype.scrollIntoView ??= () => {};
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
