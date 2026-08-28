// Registers the jest-dom matchers (toBeInTheDocument, toHaveAttribute, …) with
// Vitest's expect for every test file.
import '@testing-library/jest-dom/vitest';

// jsdom ships no matchMedia implementation, so components that read media
// queries (responsive layout, prefers-color-scheme) would throw on mount.
// Default to "no match"; suites that care stub their own.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
