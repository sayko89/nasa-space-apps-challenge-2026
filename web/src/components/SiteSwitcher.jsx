/**
 * Site switcher — lists the sites in public/sites/index.json and reloads the app on the chosen
 * one (?site=<id>). A full reload is deliberate: the terrain modules read the site grid once,
 * when they are first evaluated (see main.jsx).
 */
import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL;

export default function SiteSwitcher({ current }) {
  const [sites, setSites] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch(`${BASE}sites/index.json`, { cache: 'no-cache' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (alive && Array.isArray(j?.sites)) setSites(j.sites); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (sites.length < 2) return null;

  const go = (id) => {
    if (id === current) return;
    const u = new URL(window.location.href);
    u.searchParams.set('site', id);
    window.location.assign(u.toString());
  };

  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, pointerEvents: 'auto', flexWrap: 'wrap' }}>
      {sites.map(s => {
        const on = s.id === current;
        return (
          <button key={s.id} onClick={() => go(s.id)} title={s.objective}
            style={{
              fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.12em', cursor: on ? 'default' : 'pointer',
              padding: '3px 8px', borderRadius: 3,
              background: on ? 'rgba(244,162,97,0.28)' : 'rgba(20,10,6,0.6)',
              color: on ? '#ffd6aa' : 'rgba(255,214,170,0.75)',
              border: `1px solid ${on ? 'rgba(244,162,97,0.8)' : 'rgba(232,168,120,0.3)'}`,
            }}>
            {on ? '● ' : ''}{s.short} <span style={{ opacity: 0.7 }}>· {s.rover}</span>
          </button>
        );
      })}
    </div>
  );
}
