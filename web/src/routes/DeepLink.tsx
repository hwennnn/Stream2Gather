import { lazy } from 'react';
import { DeadEnd, ENDINGS } from '../ui/DeadEnd';
import type { Route } from './router';

const CatchupPage = lazy(() => import('../catchup/CatchupPage'));
const SharedRecap = lazy(() => import('../recap/SharedRecap'));

/** The pages a link can open directly, kept out of first-load JS behind one import. */
export default function DeepLink({ route }: { route: Exclude<Route, { page: 'landing' | 'room' }> }) {
  if (route.page === 'missing') return <DeadEnd {...ENDINGS.page} home />;
  return route.page === 'catchup' ? <CatchupPage slug={route.slug} itemId={route.itemId} /> : <SharedRecap token={route.token} />;
}
