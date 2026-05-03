import { ref, computed, watch } from 'vue';
import * as api from '../api.js';
import { extractStamp } from '../markdown.js';

// "Used by" panel on /templates/:kind. Walks the matching catalog list,
// fetches each entry's body to read its template stamp, and groups results
// by stamp version against the active template version.
//
// software / container kinds → walk parts (subtype === kind)
// interaction / binding kinds → walk contracts (subtype === kind)
//
// Compute is fully client-side: list to completion, then per-entry detail
// fetch for the markdown body (listings don't include it). Capped at 6
// concurrent body fetches so we don't hammer titan-tyr on larger catalogs.
// If usage cost grows uncomfortable, the next step is a server-side
// `GET /templates/{kind}/usage` aggregate (titan-tyr-side issue).
//
// Lazy: nothing fetched until the user expands the section. Mirrors
// HistoryPanel's collapsible pattern.

const CONCURRENCY = 6;

async function pooled(items, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

function isPartKind(kind) {
  return kind === 'software' || kind === 'container';
}

export default {
  props: {
    kind: { type: String, required: true },
    activeVersion: { type: String, default: null },
  },
  setup(props) {
    const expanded = ref(false);
    const loading = ref(false);
    const error = ref(null);
    const fetched = ref(false);
    const progress = ref({ done: 0, total: 0 });
    // Each row: { name, href, version | null, drift: 'active' | 'drifted' | 'unstamped' }
    const rows = ref([]);
    const showActive = ref(false);
    const skipped = ref(0);

    const entityLabel = computed(() => (isPartKind(props.kind) ? 'parts' : 'contracts'));

    const buckets = computed(() => {
      const active = [];
      const drifted = [];   // grouped by version below
      const unstamped = [];
      for (const r of rows.value) {
        if (r.drift === 'active') active.push(r);
        else if (r.drift === 'unstamped') unstamped.push(r);
        else drifted.push(r);
      }
      // Group drifted by version, newest first by simple lex sort on the stamp
      // version string (semver-shaped — lex order matches numeric for our range).
      const byVersion = new Map();
      for (const r of drifted) {
        if (!byVersion.has(r.version)) byVersion.set(r.version, []);
        byVersion.get(r.version).push(r);
      }
      const driftedGroups = [...byVersion.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
        .map(([version, items]) => ({ version, items }));
      return { active, driftedGroups, unstamped };
    });

    const counts = computed(() => ({
      active: buckets.value.active.length,
      drifted: buckets.value.driftedGroups.reduce((n, g) => n + g.items.length, 0),
      unstamped: buckets.value.unstamped.length,
      total: rows.value.length,
    }));

    async function load() {
      loading.value = true;
      error.value = null;
      progress.value = { done: 0, total: 0 };
      rows.value = [];
      skipped.value = 0;

      try {
        const usePart = isPartKind(props.kind);
        const listFn = usePart ? api.listParts : api.listContracts;
        const detailFn = usePart ? api.getPart : api.getContract;
        // Filter the listing by subtype upfront — saves us fetching
        // unrelated bodies. (titan-tyr accepts ?subtype= on both endpoints.)
        const items = await api.fetchAll(listFn, { subtype: props.kind });
        progress.value = { done: 0, total: items.length };

        if (items.length === 0) {
          rows.value = [];
          fetched.value = true;
          return;
        }

        const idKey = usePart ? 'name' : 'contract_id';
        const labelFn = usePart
          ? (item) => item.name
          : (item) => `${item.owner} → ${item.counterparty}`;
        const hrefFn = usePart
          ? (item) => `/parts/${encodeURIComponent(item.name)}`
          : (item) => `/contracts/${encodeURIComponent(item.contract_id)}`;

        const fetched_ = await pooled(items, async (item) => {
          try {
            const detail = await detailFn(item[idKey]);
            const stamp = extractStamp(detail.markdown);
            progress.value = { done: progress.value.done + 1, total: items.length };
            return { item, stamp };
          } catch {
            progress.value = { done: progress.value.done + 1, total: items.length };
            return { item, stamp: null };
          }
        });

        const out = [];
        for (const { item, stamp } of fetched_) {
          if (!stamp) {
            skipped.value += 1;
            continue;
          }
          // Only count entries actually stamped against THIS template kind.
          // A part stamped `software@…` doesn't appear on the container
          // template page, etc. Anything stamped for a different kind we
          // simply omit (it belongs to a different template's usage list).
          if (stamp.kind && stamp.kind !== props.kind) continue;
          const version = stamp.version;
          const drift = !version
            ? 'unstamped'
            : (props.activeVersion && version === props.activeVersion ? 'active' : 'drifted');
          out.push({
            name: labelFn(item),
            href: hrefFn(item),
            version,
            drift,
          });
        }
        // Stable sort: by name asc within each later-rendered bucket.
        out.sort((a, b) => a.name.localeCompare(b.name));
        rows.value = out;
        fetched.value = true;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    function toggle() {
      expanded.value = !expanded.value;
      if (expanded.value && !fetched.value && !loading.value) load();
    }

    // Reset when the underlying template changes (route swap).
    watch(
      () => [props.kind, props.activeVersion],
      () => {
        expanded.value = false;
        fetched.value = false;
        rows.value = [];
        error.value = null;
        loading.value = false;
        skipped.value = 0;
        showActive.value = false;
      }
    );

    return {
      expanded, loading, error, fetched, progress, skipped,
      buckets, counts, entityLabel, showActive, toggle,
    };
  },
  template: /* html */ `
    <div class="detail-section usage-panel">
      <button
        type="button"
        class="history-toggle"
        :aria-expanded="expanded"
        @click="toggle"
      >
        <span class="chevron" :class="{ open: expanded }">▸</span>
        <span class="history-title">Used by</span>
        <span v-if="fetched" class="section-count">{{ counts.total }}</span>
      </button>
      <div v-if="expanded" class="usage-body">
        <div v-if="loading" class="usage-loading">
          <span v-if="progress.total === 0">listing {{ entityLabel }}…</span>
          <span v-else>reading bodies — {{ progress.done }} of {{ progress.total }}</span>
        </div>
        <div v-else-if="error" class="detail-error">
          <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
          <div class="detail-error-detail">{{ error.detail || error.message }}</div>
        </div>
        <div v-else-if="counts.total === 0" class="detail-empty-inline">
          no {{ entityLabel }} stamped against this template
        </div>
        <template v-else>
          <div class="usage-counts">
            <span class="usage-count usage-count-active">{{ counts.active }} on active</span>
            <span v-if="counts.drifted > 0" class="usage-count usage-count-drifted">{{ counts.drifted }} drifted</span>
            <span v-if="counts.unstamped > 0" class="usage-count usage-count-unstamped">{{ counts.unstamped }} unstamped</span>
            <span v-if="skipped > 0" class="usage-count usage-count-skipped" :title="'fetch failed for ' + skipped + ' ' + entityLabel">{{ skipped }} skipped</span>
          </div>

          <div v-if="buckets.driftedGroups.length > 0" class="usage-group">
            <div class="usage-group-title">Drifted</div>
            <div v-for="g in buckets.driftedGroups" :key="g.version" class="usage-version-group">
              <div class="usage-version-header">
                <span class="version-chip drift-chip">v{{ g.version }}</span>
                <span class="usage-group-count">{{ g.items.length }}</span>
              </div>
              <div class="usage-list">
                <router-link
                  v-for="r in g.items"
                  :key="r.href"
                  :to="r.href"
                  class="usage-row"
                >
                  <span class="usage-name">{{ r.name }}</span>
                </router-link>
              </div>
            </div>
          </div>

          <div v-if="buckets.unstamped.length > 0" class="usage-group">
            <div class="usage-group-title">Unstamped</div>
            <div class="usage-list">
              <router-link
                v-for="r in buckets.unstamped"
                :key="r.href"
                :to="r.href"
                class="usage-row"
              >
                <span class="usage-name">{{ r.name }}</span>
              </router-link>
            </div>
          </div>

          <div v-if="buckets.active.length > 0" class="usage-group">
            <button
              type="button"
              class="usage-group-toggle"
              :aria-expanded="showActive"
              @click="showActive = !showActive"
            >
              <span class="chevron" :class="{ open: showActive }">▸</span>
              <span class="usage-group-title">On active</span>
              <span class="usage-group-count">{{ buckets.active.length }}</span>
            </button>
            <div v-if="showActive" class="usage-list">
              <router-link
                v-for="r in buckets.active"
                :key="r.href"
                :to="r.href"
                class="usage-row"
              >
                <span class="usage-name">{{ r.name }}</span>
              </router-link>
            </div>
          </div>
        </template>
      </div>
    </div>
  `,
};
