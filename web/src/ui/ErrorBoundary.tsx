import { Component, type ReactNode } from 'react';

type State = { failed: boolean };

/** The last line of defence: a friendly page instead of a blank one. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="glow flex h-full items-center justify-center px-6 text-center">
        <div className="enter max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">That wasn’t supposed to happen</h1>
          <p className="mt-2 text-muted">Something broke on this page. A reload usually fixes it, and the room keeps going without you.</p>
          <button type="button" onClick={() => window.location.reload()} className="btn btn-primary mt-6">
            Reload
          </button>
        </div>
      </main>
    );
  }
}
