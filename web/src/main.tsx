import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { account, useAccount } from './auth/account';
import { Landing } from './routes/Landing';
import { loadRoomPage } from './routes/router';
import { ErrorBoundary } from './ui/ErrorBoundary';

const ClerkBridge = lazy(() => import('./auth/ClerkBridge'));
const RoomPage = lazy(() => loadRoomPage().then((module) => ({ default: module.RoomPage })));

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

const SignIn = () => {
  const { clerkWanted, publishableKey } = useAccount();
  if (!clerkWanted || !publishableKey) return null;
  return (
    <Suspense fallback={null}>
      <ClerkBridge publishableKey={publishableKey} />
    </Suspense>
  );
};

// Fields match :focus-visible on a click too, and so does anything focused from
// code, so the CSS needs to know how focus really got there.
const trackModality = () => {
  const root = document.documentElement;
  window.addEventListener('keydown', (event) => {
    const moving = event.key === 'Tab' || (event.key.startsWith('Arrow') && !(event.target instanceof HTMLInputElement));
    if (moving) root.dataset.modality = 'keyboard';
  }, true);
  window.addEventListener('pointerdown', () => {
    root.dataset.modality = 'pointer';
  }, true);
};

trackModality();
void account.start();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <SignIn />
    </ErrorBoundary>
  </StrictMode>,
);
