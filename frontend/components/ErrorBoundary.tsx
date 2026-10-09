import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component to catch React rendering errors
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    // In production, you could send this to an error tracking service
    if (import.meta.env.PROD) {
      // Example: sendToErrorTracking(error, errorInfo);
    }
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error!, this.resetError);
      }

      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h1 className="text-lg font-semibold text-slate-100">
                  Đã xảy ra lỗi
                </h1>
                <p className="text-sm text-slate-400">
                  Something went wrong
                </p>
              </div>
            </div>

            <div className="bg-slate-950/50 border border-slate-800 rounded p-3">
              <p className="text-sm text-slate-300 font-mono break-all">
                {this.state.error?.message || 'Unknown error'}
              </p>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={this.resetError}
                className="flex-1 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-lg font-medium transition-colors"
              >
                Thử lại
              </button>
              <button
                onClick={() => window.location.href = '/'}
                className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition-colors"
              >
                Về trang chủ
              </button>
            </div>

            {!import.meta.env.PROD && this.state.error?.stack && (
              <details className="mt-4">
                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-300">
                  Stack trace (development only)
                </summary>
                <pre className="mt-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded p-2 overflow-auto max-h-40">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
