// TESTING (2026-07): Jest setup, run after the test environment is
// installed (see setupFilesAfterEnv in jest.config.js).
import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

// jsdom does not provide TextEncoder/TextDecoder, which react-dom/server
// (a transitive import of @grafana/ui) requires at load time.
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// jsdom does not implement SVG text measurement, which the outer-label
// word-wrapper in chord.ts relies on (getComputedTextLength). Return a
// small fixed width so labels never trigger the wrap loop in tests.
Object.defineProperty(window.SVGElement.prototype, 'getComputedTextLength', {
  writable: true,
  value: () => 50,
});

// jsdom does not implement ResizeObserver, which @grafana/ui's
// VizTooltipContainer uses to keep the tooltip within the viewport.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement matchMedia, which some @grafana/ui components
// consult for theme/motion preferences.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
