export function createRouter({ defaultRoute, onRouteChange }) {
  function getRouteFromHash() {
    const raw = String(window.location.hash || "").replace(/^#\/?/, "");
    return raw || defaultRoute;
  }

  let last = null;

  async function handle() {
    const next = getRouteFromHash();
    if (next === last) return;
    last = next;
    await onRouteChange(next);
  }

  return {
    start() {
      window.addEventListener("hashchange", handle);
      handle();
    },
    stop() {
      window.removeEventListener("hashchange", handle);
    }
  };
}

