import { ref, watch, onMounted } from 'vue';
import * as api from '../api.js';
import { relativeTime } from '../util.js';
import { project } from '../store.js';

// Light project-detail view. Surfaces the metadata `GET /projects/{name}`
// returns — description, created_at, created_by_actor, part_count,
// contract_count — and offers a "scope catalog to this project" affordance
// that flips the global picker to this slug. Project create/edit/delete are
// out of scope for the UI per the read-only stance — `register-project` is
// the canonical write path.
export default {
  props: { name: { type: String, required: true } },
  setup(props) {
    const proj = ref(null);
    const loading = ref(false);
    const error = ref(null);

    async function load(name) {
      loading.value = true;
      error.value = null;
      proj.value = null;
      try {
        proj.value = await api.getProject(name);
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(props.name));
    watch(() => props.name, (newName) => { if (newName) load(newName); });

    function scopeCatalog() {
      project.value = props.name;
    }

    const isScoped = () => project.value === props.name;

    return { proj, loading, error, scopeCatalog, isScoped, relativeTime };
  },
  template: /* html */ `
    <div class="detail-content">
      <div v-if="loading && !proj" class="detail-loading">Loading…</div>
      <div v-else-if="error && error.status === 404" class="detail-error">
        <div class="detail-error-status">no project named <code>{{ $route.params.name }}</code></div>
        <div class="detail-error-detail">
          The picker enumerates all known projects via <code>GET /projects</code> —
          either this project was never registered, or it has since been removed.
          Project create flow lives in the <code>/register-project</code> Claude Code
          skill; mimiron does not provide a UI for project mutations.
        </div>
      </div>
      <div v-else-if="error" class="detail-error">
        <div class="detail-error-status">HTTP {{ error.status || '?' }}</div>
        <div class="detail-error-detail">{{ error.detail || error.message }}</div>
      </div>
      <template v-else-if="proj">
        <div class="detail-topbar">
          <div class="topbar-row">
            <span class="type-badge type-project">project</span>
            <span class="topbar-name">{{ proj.name }}</span>
          </div>
          <div class="topbar-row chips">
            <span class="updated-chip" :title="proj.created_at" v-if="proj.created_at">created {{ relativeTime(proj.created_at) }}</span>
            <span v-if="proj.created_by_actor" class="actor-chip" :title="'X-Actor at registration time'">registered by {{ proj.created_by_actor }}</span>
            <span v-else class="actor-chip actor-anon" title="No X-Actor recorded">registered: anonymous</span>
            <span class="version-chip" :title="'parts tagged with this project'">{{ proj.part_count }} parts</span>
            <span class="version-chip" :title="'contracts tagged with this project'">{{ proj.contract_count }} contracts</span>
          </div>
          <div class="topbar-row links">
            <button type="button" class="link-pill" @click="scopeCatalog" :disabled="isScoped()" :title="isScoped() ? 'catalog is already scoped to this project' : 'scope catalog + graph to this project'">
              {{ isScoped() ? '✓ catalog scoped here' : 'scope catalog to this project' }}
            </button>
          </div>
        </div>
        <div class="detail-body markdown-body">
          <p v-if="proj.description">{{ proj.description }}</p>
          <p v-else><em>no description</em></p>
          <p style="color: var(--text3); font-size: 12px;">
            Project membership is set on parts/contracts at registration via
            <code>/register-part</code> / <code>/register-contract</code>, or
            reassigned later via <code>/update-part</code>. The UI does not
            mutate project membership; this view is read-only.
          </p>
        </div>
      </template>
    </div>
  `,
};
