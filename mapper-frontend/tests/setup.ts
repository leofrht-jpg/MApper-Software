import '@testing-library/jest-dom/vitest'

// jsdom in vitest 4 occasionally fails to wire up window.localStorage
// (the `--localstorage-file` warning at runner startup). Components like
// ChartExportButton call localStorage.getItem during render — install a
// minimal in-memory shim so tests don't blow up at mount.
if (typeof window !== 'undefined' && typeof window.localStorage?.getItem !== 'function') {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k) },
    setItem: (k, v) => { store.set(k, String(v)) },
  }
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true })
}
