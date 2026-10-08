import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useServices } from './services';

export type ThemePreference = 'system' | 'light' | 'dark';
type ThemeCtx = {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (p: ThemePreference) => void;
};

const KEY = 'zusteller.theme';
const Ctx = createContext<ThemeCtx | null>(null);

function readStored(): ThemePreference {
  const forced = readThemeOverride();
  if (forced) return forced;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { platform } = useServices();
  const [preference, setPref] = useState<ThemePreference>(readStored);
  const [sysDark, setSysDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved = preference === 'system' ? (sysDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  // Keep the native window appearance (and its vibrancy material) in step with the app theme,
  // otherwise e.g. a dark material sits behind light-theme text. 'system' = follow the OS again.
  useEffect(() => {
    void platform.setWindowTheme?.(preference).catch(() => undefined);
  }, [platform, preference]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p);
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}

/** `?theme=dark` forces dark for this page load (not persisted). */
export function readThemeOverride(search: string = window.location.search): 'dark' | null {
  return new URLSearchParams(search).get('theme') === 'dark' ? 'dark' : null;
}
