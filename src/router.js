const handlers = [];

export function route(pattern, handler) {
  handlers.push({ pattern, handler });
}

function matchRoute(pattern, path) {
  const pParts = pattern.split('/');
  const aParts = path.split('/');
  if (pParts.length !== aParts.length) return null;
  const params = {};
  for (let i = 0; i < pParts.length; i++) {
    if (pParts[i].startsWith(':')) {
      params[pParts[i].slice(1)] = decodeURIComponent(aParts[i]);
    } else if (pParts[i] !== aParts[i]) {
      return null;
    }
  }
  return params;
}

function dispatch() {
  const hash = location.hash.replace(/^#/, '') || '/';
  for (const { pattern, handler } of handlers) {
    const m = matchRoute(pattern, hash);
    if (m) return handler(m);
  }
}

export function startRouter() {
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
