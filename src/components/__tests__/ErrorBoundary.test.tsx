import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('render exploded on purpose')
  }
  return <div>healthy child</div>
}

describe('ErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // React logs every caught error; keep the suite output readable.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={false} />
      </ErrorBoundary>,
    )

    expect(screen.getByText('healthy child')).toBeTruthy()
    expect(screen.queryByTestId('error-boundary')).toBeNull()
  })

  it('shows a readable fallback instead of an empty root when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )

    expect(screen.getByTestId('error-boundary')).toBeTruthy()
    expect(screen.getByText('界面渲染出错')).toBeTruthy()
    // The single most important regression: a blank screen must never be silent.
    expect(screen.getByTestId('error-boundary-detail').textContent).toContain(
      'render exploded on purpose',
    )
    expect(screen.queryByText('healthy child')).toBeNull()
  })

  it('offers a reload action', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
  })

  it('notifies the host through onError, including the component stack', () => {
    const onError = vi.fn()

    render(
      <ErrorBoundary onError={onError}>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )

    expect(onError).toHaveBeenCalledTimes(1)
    const [error, info] = onError.mock.calls[0] as [Error, { componentStack?: string }]
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('render exploded on purpose')
    expect(info.componentStack).toBeTruthy()
  })

  it('logs the failure so the console is never silent', () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    )

    expect(errorSpy).toHaveBeenCalled()
  })
})
