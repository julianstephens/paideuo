import { Component, useEffect, type ReactNode } from "react";
import { useRouteError } from "react-router";

const ErrorScreen = () => {
  return (
    <main className="app-error" aria-labelledby="app-error-title">
      <h1 id="app-error-title">Something went wrong</h1>
      <p>Reload this page to try again, or return to the Calendar.</p>
      <div>
        <button type="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
        <a href="/">Back to Calendar</a>
      </div>
    </main>
  );
};

export const RouteErrorBoundary = () => {
  const error = useRouteError();
  useEffect(() => {
    console.error("Route error", error);
  }, [error]);
  return <ErrorScreen />;
};

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Application error", error);
  }

  render() {
    return this.state.failed ? <ErrorScreen /> : this.props.children;
  }
}
