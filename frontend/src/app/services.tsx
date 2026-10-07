import { createContext, useContext, type ReactNode } from 'react';
import type { MailService } from '@/domain/mail';
import type { PlatformService } from '@/platform';

export type Services = { mail: MailService; platform: PlatformService };

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}
