let config = null;

export async function loadConfig() {
  const res = await fetch('config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  config = await res.json();
  if (!config.tyrBaseUrl) throw new Error('config.json missing tyrBaseUrl');
  config.tyrBaseUrl = config.tyrBaseUrl.replace(/\/+$/, '');
  return config;
}

export function getConfig() {
  if (!config) throw new Error('config not loaded');
  return config;
}

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { auth = true, accept = 'application/json' } = {}) {
  const url = `${config.tyrBaseUrl}${path}`;
  const headers = { Accept: accept };
  if (auth) headers['Authorization'] = `Bearer ${config.tyrToken}`;
  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    throw new ApiError(0, `network error: ${e.message}`);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.detail) detail = j.detail;
    } catch { /* response body not JSON */ }
    throw new ApiError(res.status, detail);
  }
  return accept === 'text/markdown' ? res.text() : res.json();
}

export const health = () => request('/health', { auth: false });

export const listSoftware = ({ limit = 50, after = null, match = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (match) p.set('match', match);
  return request(`/software?${p}`);
};

export const getSoftware = (name) =>
  request(`/software/${encodeURIComponent(name)}`);

export const listSoftwareContracts = (name, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/software/${encodeURIComponent(name)}/contracts?${p}`);
};

export const getContract = (id) =>
  request(`/contracts/${encodeURIComponent(id)}`);
