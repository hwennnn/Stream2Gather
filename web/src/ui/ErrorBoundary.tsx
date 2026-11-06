import { Component, type ReactNode } from 'react';
import { Page } from './Page';

type State = { failed: boolean };

/** The last line of defence: a friendly page instead of a blank one, unless given something else. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <Page>
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.015em]">That wasn’t supposed to happen</h1>
        <p className="mt-1.5 text-muted">Something broke on this page. A reload usually fixes it, and the room keeps going without you.</p>
        <button type="button" onClick={() => window.location.reload()} className="btn btn-primary mt-5">
          Reload
        </button>
      </Page>
    );
  }
}
