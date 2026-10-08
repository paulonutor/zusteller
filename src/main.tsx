import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { createServices } from '@/app/createServices';
import { showAccentDebug } from '@/platform/accentDebug';
import { applyHostChrome, trackNativeAccent, trackWindowFocus } from '@/platform/hostChrome';
import '@/styles/index.css';

applyHostChrome();
trackWindowFocus();
showAccentDebug();

const services = createServices();
trackNativeAccent(services.platform);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={services} />
  </StrictMode>,
);
