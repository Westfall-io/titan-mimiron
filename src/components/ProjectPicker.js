import { ref, onMounted } from 'vue';
import * as api from '../api.js';
import { project } from '../store.js';

// Three-mode picker for the catalog UI (provider v0.18.0+, mimiron 0.18.x).
//
//   "" (empty)            → All projects (default)
//   api.PROJECT_NONE      → Unprojected only
//   "<slug>"              → A specific project
//
// Modes 2+ map directly to the `?project=` query param the provider
// documents; mode 1 omits the param entirely. The picker reads from
// `GET /projects` once on mount; when projects appear or disappear later
// the user reloads the page (no live-update obligation in 2.5.0).
export default {
  setup() {
    const projects = ref([]);
    const loading = ref(false);
    const error = ref(null);

    async function load() {
      loading.value = true;
      error.value = null;
      try {
        const data = await api.listProjects({ limit: 100 });
        projects.value = data.results || [];
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(load);

    function onChange(e) {
      const v = e.target.value;
      project.value = v || null;
    }

    return { projects, loading, error, project, NONE: api.PROJECT_NONE, onChange };
  },
  template: /* html */ `
    <label class="project-picker" :title="error ? ('GET /projects failed: ' + (error.detail || error.message)) : 'Filter catalog by project'">
      <span class="project-picker-label">project</span>
      <select class="project-picker-select" :value="project || ''" @change="onChange" :disabled="loading">
        <option value="">all projects</option>
        <option :value="NONE">— unprojected —</option>
        <option v-for="p in projects" :key="p.name" :value="p.name">{{ p.name }}</option>
      </select>
    </label>
  `,
};
