import { lazy } from 'react';

// Wraps React.lazy() so a route chunk that fails to load — the classic
// "works until the next Vercel deploy" bug: a browser tab that's been open
// since before a redeploy still has the *previous* build's index.html in
// memory, which references JS chunk filenames (hashed per build) that no
// longer exist on the server once the new deployment replaces them — no
// longer leaves that route's content area permanently blank. Instead of
// throwing (which, with no error boundary around the route Suspense, can
// leave the page showing just the surrounding layout/background until the
// user manually refreshes), it reloads the page exactly once to pick up the
// current build, then lets the fresh index.html/chunks load normally.
// A sessionStorage flag prevents a reload loop if the failure has some
// other, non-stale-build cause.
export function lazyWithRetry(factory) {
  return lazy(async () => {
    const reloadedKey = 'lazy-chunk-reload-attempted';
    try {
      const module = await factory();
      sessionStorage.removeItem(reloadedKey);
      return module;
    } catch (error) {
      const alreadyReloaded = sessionStorage.getItem(reloadedKey) === '1';
      if (alreadyReloaded) throw error;

      sessionStorage.setItem(reloadedKey, '1');
      window.location.reload();
      // The reload above tears the page down almost immediately — return a
      // promise that never resolves so React doesn't render an error state
      // in the brief window before that happens.
      return new Promise(() => {});
    }
  });
}
