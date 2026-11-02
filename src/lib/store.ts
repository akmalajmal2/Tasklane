import { useSyncExternalStore } from "react";

/**
 * A ~20 line external store (same shape as zustand's vanilla store) built on React's own
 * useSyncExternalStore, so no extra dependency is needed.
 */
export interface StoreApi<S> {
  getState: () => S;
  setState: (partial: Partial<S> | ((s: S) => Partial<S> | S)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<S>(init: (set: StoreApi<S>["setState"], get: () => S) => S): StoreApi<S> {
  let state: S;
  const listeners = new Set<() => void>();
  const setState: StoreApi<S>["setState"] = (partial) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    if (next === state || Object.is(next, state)) return; // updater returned the same state: nothing changed
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  state = init(setState, () => state);
  return { getState: () => state, setState, subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)) };
}

/** Subscribe a component to a slice of the store. The selector must return a stable value (no new objects per call). */
export function useStore<S, T>(api: StoreApi<S>, selector: (s: S) => T): T {
  const get = () => selector(api.getState());
  return useSyncExternalStore(api.subscribe, get, get);
}
