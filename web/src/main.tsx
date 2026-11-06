import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Landing } from './routes/Landing';

const RoomPage = lazy(() => import('./routes/RoomPage').then((module) => ({ default: module.RoomPage })));

export const navigate = (path: string, state?: unknown) => {
  window.history.pushState(state ?? null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

const slugFromPath = () => /^\/r\/([^/]+)/.exec(window.location.pathname)?.[1] ?? null;

const App = () => {
  const [slug, setSlug] = useState(slugFromPath);

  useEffect(() => {
    const update = () => setSlug(slugFromPath());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  if (!slug) return <Landing />;
  return (
    <Suspense fallback={<div className="h-full bg-ink" />}>
      <RoomPage key={slug} slug={slug} />
    </Suspense>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
