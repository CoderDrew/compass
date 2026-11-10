import { Component, type ReactNode } from 'react';
import { STORAGE_KEY } from '../lib/storage';

/** Last-resort screen: never lose data because of a rendering bug. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  download = () => {
    const raw = localStorage.getItem(STORAGE_KEY) ?? '{}';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    a.download = 'project-compass-rescue.json';
    a.click();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-lg px-6 py-20 text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">Your data is still saved in this browser. Download a copy, then reload.</p>
        <pre className="mt-4 overflow-auto rounded-lg bg-raised p-3 text-left text-xs text-faint">{this.state.error.message}</pre>
        <div className="mt-5 flex justify-center gap-2">
          <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white" onClick={this.download}>
            Download data
          </button>
          <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
