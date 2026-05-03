import { ref, computed, watch, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import * as api from '../api.js';
import { search, retryNonce } from '../store.js';

export default {
  setup() {
    const route = useRoute();
    const results = ref([]);
    const next = ref(null);
    const loading = ref(false);
    const error = ref(null);

    let debounceTimer = null;

    const activeName = computed(() =>
      route.name === 'part' ? route.params.name : null
    );

    async function load(reset = true) {
      if (reset) {
        results.value = [];
        next.value = null;
      }
      loading.value = true;
      error.value = null;
      try {
        const data = await api.listParts({
          match: search.value || null,
          after: reset ? null : next.value,
        });
        results.value = reset ? data.results : [...results.value, ...data.results];
        next.value = data.next;
      } catch (e) {
        error.value = e;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => load(true));

    watch(search, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => load(true), 300);
    });

    watch(retryNonce, () => load(true));

    function loadMore() {
      if (next.value && !loading.value) load(false);
    }

    return { results, next, loading, error, activeName, search, loadMore };
  },
  template: /* html */ `
    <section class="pane catalog-pane" aria-label="parts catalog">
      <div class="catalog-list">
        <div v-if="error" class="catalog-error">{{ error.detail || error.message }}</div>
        <div v-else-if="!loading && results.length === 0" class="catalog-empty">
          {{ search ? 'no matches' : 'no parts registered' }}
        </div>
        <router-link
          v-for="p in results"
          :key="p.id"
          :to="'/parts/' + encodeURIComponent(p.name)"
          class="catalog-row"
          :class="{ active: p.name === activeName }"
        >
          <div class="row-name">
            <span v-if="p.subtype" class="subtype-chip subtype-mini" :class="'subtype-' + p.subtype">{{ p.subtype }}</span>
            {{ p.name }}
          </div>
          <div class="row-meta">
            <span class="version-chip">v{{ p.version }}</span>
            <span v-for="a in p.aliases" :key="a" class="alias-chip">{{ a }}</span>
          </div>
        </router-link>
      </div>
      <button
        v-if="next"
        @click="loadMore"
        :disabled="loading"
        class="load-more"
      >{{ loading && results.length > 0 ? 'Loading…' : 'Load more' }}</button>
    </section>
  `,
};
