import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';
import { Page } from './Page';

const failed = (props: ConstructorParameters<typeof ErrorBoundary>[0]) => {
  const boundary = new ErrorBoundary(props);
  boundary.state = ErrorBoundary.getDerivedStateFromError();
  return boundary.render();
};

describe('ErrorBoundary', () => {
  it('lets a slot fail to nothing, so the page around it carries on', () => {
    expect(failed({ children: 'slot', fallback: null })).toBeNull();
  });

  it('shows the given fallback in place of what failed', () => {
    expect(failed({ children: 'crew home', fallback: 'join gate' })).toBe('join gate');
  });

  it('still shows the whole-page message without one', () => {
    expect(failed({ children: 'app' })).toMatchObject({ type: Page });
  });
});
