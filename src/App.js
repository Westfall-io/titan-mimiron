import HeaderBar from './components/HeaderBar.js';
import CatalogPane from './components/CatalogPane.js';
import { fatal, retry } from './store.js';

export default {
  components: { HeaderBar, CatalogPane },
  setup() {
    return { fatal, retry };
  },
  template: /* html */ `
    <header-bar />
    <main id="app-main">
      <catalog-pane />
      <section class="pane detail-pane" aria-label="detail">
        <router-view />
      </section>
    </main>
    <div v-if="fatal" class="error-banner">
      <span>{{ fatal }}</span>
      <button @click="retry" class="retry-btn">Retry</button>
    </div>
  `,
};
