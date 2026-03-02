"use client";

import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen surface-page flex items-center justify-center">
          <div className="glass-card rounded-2xl p-8 text-center max-w-md">
            <h2 className="text-2xl font-black text-[var(--text-heading)] mb-3">Something went wrong</h2>
            <p className="text-lg text-[var(--text-muted)] mb-5">An unexpected error occurred.</p>
            <button
              onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="px-6 py-2.5 rounded-xl text-white font-bold"
              style={{ background: "linear-gradient(to right, var(--brand-claude), var(--brand-openai))" }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
