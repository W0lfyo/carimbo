import { useEffect, useState } from 'react';
import { Logo } from './components/Logo';
import { Demo } from './views/Demo';
import { ShopView } from './views/Shop';
import { CustomsView } from './views/Customs';
import { Traveller } from './views/Traveller';
import { Setup } from './views/Setup';
import { startSync } from './lib/sync';

type Route = { path: 'demo' | 'traveller' | 'shop' | 'customs' | 'setup'; join?: string; query?: URLSearchParams };

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const join = new URLSearchParams(query).get('join') ?? undefined;
  if (path === 'traveller' || path === 'shop' || path === 'customs' || path === 'setup') return { path, join, query: new URLSearchParams(query) };
  return { path: 'demo' };
}

const LINKS: { path: Route['path']; label: string }[] = [
  { path: 'demo', label: 'Demo' },
  { path: 'shop', label: 'Shop' },
  { path: 'traveller', label: 'Traveller' },
  { path: 'customs', label: 'Customs' },
];

export function App() {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => startSync(), []);

  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    const titles = { demo: 'Carimbo', shop: 'Carimbo for shops', traveller: 'Carimbo', customs: 'Carimbo customs desk', setup: 'Carimbo testnet setup' };
    document.title = titles[route.path];
  }, [route.path]);

  return (
    <div className={`app app--${route.path}`}>
      <header className="topbar">
        <Logo />
        <nav className="topbar__nav" aria-label="Views">
          {LINKS.map((l) => (
            <a key={l.path} className="topbar__link" href={`#/${l.path === 'demo' ? '' : l.path}`} aria-current={route.path === l.path ? 'page' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
      </header>
      {route.path === 'demo' && <Demo />}
      {route.path === 'setup' && <Setup />}
      {route.path === 'shop' && (
        <main className="page">
          <ShopView />
        </main>
      )}
      {route.path === 'customs' && (
        <main className="page">
          <CustomsView />
        </main>
      )}
      {route.path === 'traveller' && (
        <main className="page page--phone">
          <div className="phone phone--solo">
            <Traveller joinCode={route.join} joinQuery={route.query} />
          </div>
        </main>
      )}
    </div>
  );
}
