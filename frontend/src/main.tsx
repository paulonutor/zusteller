import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { createServices } from '@/app/createServices';
import { applySkin } from '@/app/skin';
import { applyHostChrome, trackWindowFocus } from '@/platform/hostChrome';
import '@/styles/index.css';

applySkin();
applyHostChrome();
trackWindowFocus();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App services={createServices()} />
  </StrictMode>,
);
