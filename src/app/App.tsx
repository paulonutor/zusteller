import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MailApp } from '@/features/mail/MailApp';
import { ServicesProvider, type Services } from './services';
import { ThemeProvider } from './theme';
import { ToastProvider } from './toast';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 } },
  });
}

export function App({ services, queryClient }: { services: Services; queryClient?: QueryClient }) {
  const [qc] = useState(() => queryClient ?? makeQueryClient());
  return (
    <ServicesProvider services={services}>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastProvider>
            <MailApp />
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ServicesProvider>
  );
}
