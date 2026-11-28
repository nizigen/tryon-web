import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { api, deviceId, setSessionId } from '../public/lib/api.js';
import { Catalog, ProductTryon } from './Catalog.jsx';
import Home from './Home.jsx';
import Records from './Records.jsx';
import Settings from './Settings.jsx';
import Studio from './Studio.jsx';
import { useStudioDraft } from './studio/useStudioDraft.js';
import { Icon, toast, Toast } from './ui.jsx';
import Wardrobe from './Wardrobe.jsx';

const navigation = [
  ['studio', '试衣间', 'studio'], ['wardrobe', '衣橱', 'wardrobe'],
  ['settings', '设置', 'settings'], ['me', '试穿记录', 'orders'],
];

function readRoute() {
  const [name, productId] = location.hash.replace(/^#\/?/, '').split('/');
  if (!name || name === 'home') return { name: 'home' };
  if (name === 'tryon' && productId) return { name, productId };
  if (name === 'shop' || navigation.some(([route]) => name === route)) return { name };
  return { name: 'studio' };
}

function navigate(route) {
  location.hash = `#/${route}`;
}

function consumeProductEntry(productId) {
  const route = readRoute();
  const previous = history.state?.tryonProductEntry;
  if (route.name !== 'tryon' || route.productId !== productId) return false;
  if (previous?.productId === productId && previous.documentStart === performance.timeOrigin) return false;
  history.replaceState({ ...history.state, tryonProductEntry: { productId, documentStart: performance.timeOrigin } }, '');
  return true;
}

function useRoute() {
  const [route, setRoute] = useState(readRoute);
  useLayoutEffect(() => {
    function update() {
      setRoute(readRoute());
    }
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}

async function boot() {
  const requests = [
    api('/api/config'), api('/api/products'), api('/api/settings'),
    api('/api/session', { method: 'POST', body: { deviceId: deviceId() } }),
  ];
  const [config, products, settings, session] = await Promise.allSettled(requests);
  if (session.status === 'fulfilled') setSessionId(session.value.sessionId);
  const notices = [config, products, session].flatMap(result => result.status === 'rejected' ? [result.reason.message] : []);
  return {
    config: config.value ?? {}, products: products.value?.products ?? [], settings: settings.value ?? null,
    notices: config.value?.gateway?.reachable === false ? [...notices, '图片服务未连接，暂时无法生成试穿结果'] : notices,
  };
}

function Navigation({ active }) {
  return <header className="sidebar" id="sidebar">
    <a className="sidebar__brand" href="#/home" aria-label="照花首页" aria-current={active === 'home' ? 'page' : undefined}>
      <img src="/icon.svg?v=zhaohua-1" className="brand__mark" width="32" height="32" alt="" /><span className="brand__name">照花</span>
    </a>
    <nav className="nav" id="nav" aria-label="主导航">{navigation.map(([route, label, icon]) =>
      <a href={`#/${route}`} key={route} className={`nav__item${active === route ? ' is-active' : ''}`} data-route={route}
        aria-current={active === route ? 'page' : undefined}>
        <Icon name={icon} /><span className="nav__label">{label}</span>
      </a>)}
    </nav>
  </header>;
}

function Page({ route, ctx }) {
  if (route.name === 'tryon') return <ProductTryon ctx={ctx} productId={route.productId} consumeEntry={consumeProductEntry} />;
  if (route.name === 'wardrobe') return <Wardrobe ctx={ctx} />;
  if (route.name === 'settings') return <Settings ctx={ctx} />;
  if (route.name === 'me') return <Records ctx={ctx} />;
  if (route.name === 'shop') return <Catalog ctx={ctx} />;
  return <Studio ctx={ctx} />;
}

function App() {
  const route = useRoute();
  const isHome = route.name === 'home';
  const draft = useStudioDraft(route.name);
  const [data, setData] = useState(null);
  const startup = useRef(null);
  const noticesShown = useRef(false);
  const previousRoute = useRef(route);
  const main = useRef(null);
  useEffect(() => { if (!isHome) startup.current ??= boot().then(setData); }, [isHome]);
  useEffect(() => {
    if (isHome || !data || noticesShown.current) return;
    noticesShown.current = true;
    for (const notice of data.notices) toast(notice);
  }, [data, isHome]);
  useLayoutEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    window.scrollTo(0, 0);
    main.current.focus({ preventScroll: true });
  }, [route]);
  const ctx = data && {
    ...data, model: data.settings?.model ?? data.config.defaultModel ?? data.config.models?.[0]?.id,
    draft, openStudio: (pieces, kind, mode) => { if (draft.takeOutfit(pieces, kind, mode)) navigate('studio'); }, onNavigate: navigate,
    setSettings: settings => setData(previous => ({ ...previous, settings })),
  };
  return <>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); main.current.focus(); }}>跳到主要内容</a>
    <div className="app-shell"><Navigation active={route.name === 'tryon' ? 'studio' : route.name} />
      <main id="main" className="view-root" ref={main} tabIndex={-1} data-view={route.name}>
        {isHome ? <Home /> : data ? <div key={`${route.name}/${route.productId ?? ''}`} className="view-content"><Page route={route} ctx={ctx} /></div>
          : <div className="grid" aria-busy="true" aria-label="正在加载照花">{[0, 1, 2, 3].map(index => <div key={index} className="skeleton skeleton-card" />)}</div>}
      </main>
    </div><Toast />
  </>;
}

createRoot(document.getElementById('app')).render(<App />);
