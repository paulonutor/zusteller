import type { PlatformService } from './PlatformService';

const BASE_TITLE = 'zusteller';

/** Browser/dev-mode implementation. Desktop hosts supply their own. */
export function createBrowserPlatformService(): PlatformService {
  return {
    subscribeMenuActions: () => () => {},
    async confirm({ title, message }) {
      return window.confirm(`${title}\n\n${message}`);
    },
    async showNotification({ title, body }) {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'granted') new Notification(title, { body });
    },
    async setBadge(count) {
      document.title = count ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
    },
    async openExternal(url) {
      // Defence in depth: only ever hand http(s)/mailto to the browser.
      const parsed = new URL(url);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        throw new Error(`Refusing to open ${parsed.protocol} URL`);
      }
      window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
    },
  };
}
