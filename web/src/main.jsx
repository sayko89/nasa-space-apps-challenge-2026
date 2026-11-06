import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { loadSite, siteFromUrl } from './terrain/siteData.js';

// Arazi verisi App'ten ÖNCE yüklenir: terrainGenerator ve ona bağlı modüller
// (pathfinder, roverController, RightPanel…) modül seviyesindeki sabitlerini
// ilk değerlendirmede site verisinden okur. Bu yüzden App dinamik import edilir.
async function boot() {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#120a06', color: '#e8a878',
      fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.18em',
    }}>
      LOADING TERRAIN DATA...
    </div>
  );
  await loadSite(siteFromUrl());
  const { default: App } = await import('./App.jsx');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

boot();
