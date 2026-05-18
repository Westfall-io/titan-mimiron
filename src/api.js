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
// Optional `?subtype=` filter narrows to a single subtype. Optional
// `?project=` filter (provider v0.18.0+, #44): a project slug, or the
// reserved sentinel `__none__` for unprojected rows. List + detail responses
// also carry optional `project: str | null` and `created_by_actor: str | null`
// fields (additive in v0.16.0/v0.18.0; null on rows pre-dating them).
export const listParts = ({ limit = 50, after = null, match = null, subtype = null, project = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (match) p.set('match', match);
  if (subtype) p.set('subtype', subtype);
  if (project) p.set('project', project);
  return request(`/parts?${p}`);
};

export const getPart = (name) =>
  request(`/parts/${encodeURIComponent(name)}`);

// Wrapper key on response is `part` (was `software` in v1.x). Results array
// rows carry the contract's own `subtype` (`interaction` | `binding`).
// Optional `?project=` filter behaves identically to listContracts.
export const listPartContracts = (name, { limit = 50, after = null, project = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (project) p.set('project', project);
  return request(`/parts/${encodeURIComponent(name)}/contracts?${p}`);
};

export const listPartHistory = (name, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/parts/${encodeURIComponent(name)}/history?${p}`);
};

// Subtype-shift proposals (titan-tyr v0.15.0+). Read-only from mimiron's
// perspective per the human-observability stance — propose/accept happen
// via the canonical Claude Code skills, not via UI buttons. The listing
// includes both `status=="proposal"` (pending) and `status=="accepted"`
// (history) entries; consumer filters client-side.
export const listPartSubtypeProposals = (name) =>
  request(`/parts/${encodeURIComponent(name)}/subtype-proposals`);

// Contracts (titan-tyr v0.10.0 added subtype: `interaction` | `binding`).
// Owner/counterparty keys on contract responses are unchanged from v1.x —
// the field rename to `owner_part`/`counterparty_part` is only on POST input,
// which mimiron doesn't exercise (read-only MVP). Optional `?project=` filter
// (provider v0.18.0+, #44): same semantics as listParts. List + detail
// responses also carry optional `project` + `created_by_actor`.
export const listContracts = ({ limit = 50, after = null, subtype = null, project = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  if (subtype) p.set('subtype', subtype);
  if (project) p.set('project', project);
  return request(`/contracts?${p}`);
};

export const getContract = (id) =>
  request(`/contracts/${encodeURIComponent(id)}`);

export const listContractHistory = (id, { limit = 50, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/contracts/${encodeURIComponent(id)}/history?${p}`);
};

export const listContractSubtypeProposals = (id) =>
  request(`/contracts/${encodeURIComponent(id)}/subtype-proposals`);

// Templates. The eight kinds today: software, container, image, pod, compose,
// interaction, binding, connection. `GET /templates/{kind}` returns the active
// body as raw markdown (text/markdown). `GET /templates/{kind}/proposals`
// returns `{kind, active_version, proposals: []}` — there is no per-version
// history endpoint; "history" surfaces in mimiron as active_version + the
// pending RC proposals. Order here groups by lifecycle stage: source
// (software), build/runtime (container/pod/compose with image as the
// artifact in between), K8s runtime (ingress/service/deployment/etc., per
// archaedas#9 — top-down through the request path), then contract subtypes.
export const TEMPLATE_KINDS = [
  // Source
  'software',
  // Build / compose runtime
  'image', 'container', 'pod', 'compose',
  // K8s runtime (M-C / archaedas#9) — ordered top-down through the request
  // path: ingress receives → routes-to → service selects → deployment runs.
  'ingress', 'service',
  'deployment', 'statefulset', 'job',
  'secret', 'configmap',
  // Contract subtypes (last — these describe edges, not parts)
  'interaction', 'binding', 'connection',
];

// Part subtypes — anything in `GET /parts?subtype=`. Distinct from contract
// subtypes (interaction/binding/connection). Used by UsageSection to decide
// whether a template kind walks parts or contracts. Mirrors TEMPLATE_KINDS
// minus the three contract subtypes.
export const PART_SUBTYPES = [
  'software',
  'image', 'container', 'pod', 'compose',
  'ingress', 'service',
  'deployment', 'statefulset', 'job',
  'secret', 'configmap',
];

export const getTemplate = (kind) =>
  request(`/templates/${encodeURIComponent(kind)}`, { accept: 'text/markdown' });

export const getTemplateProposals = (kind) =>
  request(`/templates/${encodeURIComponent(kind)}/proposals`);

// Projects (provider v0.18.0+, #44). A project is an optional tag attached
// to parts and contracts so the UI can filter the catalog to one project at
// a time. Membership is single-project, optional, and independent on
// contracts (cross-project contracts allowed by design — the contract
// carries whichever project owns the relationship). Read-only here per the
// observability stance; create/edit/delete (no DELETE today) is driven by
// the canonical `register-project` Claude Code skill.
export const listProjects = ({ limit = 100, after = null } = {}) => {
  const p = new URLSearchParams({ limit });
  if (after) p.set('after', after);
  return request(`/projects?${p}`);
};

export const getProject = (name) =>
  request(`/projects/${encodeURIComponent(name)}`);

// Reserved sentinel for the `?project=` filter — narrows to rows with NULL
// `project_id`. Provider documents this as a literal string that cannot
// collide with a real slug (slugs reject leading underscore + double
// underscore), so the consumer uses it verbatim.
export const PROJECT_NONE = '__none__';

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
