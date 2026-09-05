import { Component, type ErrorInfo, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  children: ReactNode
  /** Optional hook so tests / hosts can observe the failure. */
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
  copied: boolean
}

/**
 * Last line of defence for the whole UI.
 *
 * The 2026-09-05 black-screen investigation cost hours precisely because this
 * did not exist: a render failure silently unmounted the tree, leaving an empty
 * `#root` — a black window with no diagnostics whatsoever. This boundary makes
 * any future failure visible and recoverable without restarting the app.
 *
 * Deliberately dependency-free: no gateway, no Tauri invoke, no router. If
 * those are what broke, the fallback must still render.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, copied: false }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    this.props.onError?.(error, info)
    // The console is the first place anyone looks when the window goes blank.
    console.error('[Abyssal Reverie] Unhandled render error:', error)
    if (info.componentStack) {
      console.error('[Abyssal Reverie] Component stack:', info.componentStack)
    }
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleCopy = (): void => {
    const { error, componentStack } = this.state
    const text = [error?.stack ?? String(error ?? ''), '', componentStack ?? '']
      .join('\n')
      .trim()
    void navigator.clipboard?.writeText(text).then(
      () => this.setState({ copied: true }),
      () => this.setState({ copied: false }),
    )
  }

  render(): ReactNode {
    const { error, componentStack, copied } = this.state
    if (!error) return this.props.children

    return (
      <div
        role="alert"
        data-testid="error-boundary"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 200,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#050709',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <div
          style={{
            width: 'min(620px, 92vw)',
            maxHeight: '86vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: '22px 24px',
            borderRadius: 14,
            background: 'rgba(8, 13, 18, 0.82)',
            backdropFilter: 'blur(22px) saturate(1.05)',
            WebkitBackdropFilter: 'blur(22px) saturate(1.05)',
            border: '1px solid rgba(215,228,230,0.14)',
            boxShadow: '0 18px 48px rgba(2,3,5,0.5)',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 500, color: 'rgba(235,240,241,0.94)' }}>
            界面渲染出错
          </div>
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.6,
              color: 'rgba(195,212,218,0.85)',
            }}
          >
            应用遇到一个未捕获的错误，界面已停止渲染。你可以重新加载；若反复出现，请把下面的信息发给我们。
          </div>

          <pre
            data-testid="error-boundary-detail"
            style={{
              margin: 0,
              padding: '12px 14px',
              maxHeight: '38vh',
              overflow: 'auto',
              borderRadius: 10,
              background: 'rgba(2,3,5,0.55)',
              border: '1px solid rgba(215,228,230,0.10)',
              color: 'rgba(226,235,237,0.88)',
              fontSize: 11,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {[error.stack ?? `${error.name}: ${error.message}`, componentStack]
              .filter(Boolean)
              .join('\n\n')}
          </pre>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              type="button"
              onClick={this.handleCopy}
              className="btn-action"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                color: 'rgba(195,212,218,0.85)',
                background: 'rgba(27,37,44,0.40)',
                border: '1px solid rgba(215,228,230,0.12)',
              }}
            >
              {copied ? '已复制' : '复制错误信息'}
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              autoFocus
              className="btn-action"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                color: '#0B1116',
                background: 'rgba(186,200,204,0.92)',
                border: '1px solid rgba(215,228,230,0.30)',
                fontWeight: 500,
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    )
  }
}
