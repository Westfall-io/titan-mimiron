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

// Parts (titan-tyr v0.9.0 renamed `software` → `part`; subtype discriminator
// `software` | `container` added). Listing/detail responses include subtype.
// Optional `?subtype=` filter narrows to a single subtype.
export const listParts = ({ limit = 50, after = null, match = null, subtype = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (match) p.set('match', match);
  if (subtype) p.set('subtype', subtype);
  return request(`/parts?${p}`);
};

export const getPart = (name) =>
  request(`/parts/${encodeURIComponent(name)}`);

// Wrapper key on response is `part` (was `software` in v1.x). Results array
// rows carry the contract's own `subtype` (`interaction` | `binding`).
export const listPartContracts = (name, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/parts/${encodeURIComponent(name)}/contracts?${p}`);
};

export const listPartHistory = (name, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/parts/${encodeURIComponent(name)}/history?${p}`);
};

// Contracts (titan-tyr v0.10.0 added subtype: `interaction` | `binding`).
// Owner/counterparty keys on contract responses are unchanged from v1.x —
// the field rename to `owner_part`/`counterparty_part` is only on POST input,
// which mimiron doesn't exercise (read-only MVP).
export const listContracts = ({ limit = 50, after = null, subtype = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (subtype) p.set('subtype', subtype);
  return request(`/contracts?${p}`);
};

export const getContract = (id) =>
  request(`/contracts/${encodeURIComponent(id)}`);

export const listContractHistory = (id, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/contracts/${encodeURIComponent(id)}/history?${p}`);
};

// Templates. The four kinds today: software, container, interaction, binding.
// `GET /templates/{kind}` returns the active body as raw markdown (text/markdown).
// `GET /templates/{kind}/proposals` returns `{kind, active_version, proposals: []}`
// — there is no per-version history endpoint; "history" surfaces in mimiron as
// active_version + the pending RC proposals.
export const TEMPLATE_KINDS = ['software', 'container', 'interaction', 'binding'];

export const getTemplate = (kind) =>
  request(`/templates/${encodeURIComponent(kind)}`, { accept: 'text/markdown' });

export const getTemplateProposals = (kind) =>
  request(`/templates/${encodeURIComponent(kind)}/proposals`);

// Walk a paginated endpoint to completion. Used by the graph view, where we
// genuinely need every node + edge in one bag.
export async function fetchAll(listFn, opts = {}) {
  const all = [];
  let after = null;
  while (true) {
    const data = await listFn({ ...opts, limit: 100, after });
    all.push(...data.results);
    if (!data.next) return all;
    after = data.next;
  }
}
