import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/** Holds a lazy piece of a page. If its code can't load, the page carries on without it. */
export const Slot = ({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) => (
  <ErrorBoundary fallback={fallback}>
    <Suspense fallback={fallback}>{children}</Suspense>
  </ErrorBoundary>
);
