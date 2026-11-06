import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { account, useAccount } from './auth/account';
import { Landing } from './routes/Landing';
import { loadRoomPage, routeFor } from './routes/router';
import { ErrorBoundary } from './ui/ErrorBoundary';

const ClerkBridge = lazy(() => import('./auth/ClerkBridge'));
const RoomPage = lazy(() => loadRoomPage().then((module) => ({ default: module.RoomPage })));
const DeepLink = lazy(() => import('./routes/DeepLink'));

const currentRoute = () => routeFor(window.location.pathname);

const App = () => {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const update = () => setRoute(currentRoute());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  if (route.page === 'landing') return <Landing />;
  return (
    <Suspense fallback={<div className="h-full bg-ink" />}>
      {route.page === 'room' ? <RoomPage key={route.slug} slug={route.slug} /> : <DeepLink route={route} />}
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
