import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest is configured without `globals: true`, so Testing Library never
// registers its automatic cleanup. Without this, every render() leaves its DOM
// behind and `screen.getBy*` starts matching elements from previous tests
// ("Found multiple elements"). Any test file with more than one render() was
// therefore broken — ErrorBoundary.test.tsx was just the first to hit it.
afterEach(() => {
  cleanup()
})

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

// jsdom does not implement scrolling or media playback. Without these stubs the
// suite still passes every assertion but reports unhandled errors
// (`listRef.current?.scrollTo is not a function`,
// `Not implemented: HTMLMediaElement's play() method`) and exits non-zero,
// which turns CI red. Both APIs exist in the real WebView2 host.
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {
    /* no-op for jsdom */
  }
}

if (typeof HTMLMediaElement !== 'undefined') {
  HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function pause() {
    /* no-op for jsdom */
  }
}
