import { onMounted, onUnmounted } from 'vue';
import HeaderBar from './components/HeaderBar.js';
import CatalogPane from './components/CatalogPane.js';
import GraphPane from './components/GraphPane.js';
import { fatal, retry } from './store.js';

// Detail-pane width is a CSS variable so the resize handle can update it
// without re-rendering Vue components. Persisted to localStorage so the
// user's adjustment survives page loads. Clamped to [MIN, 50% of window].
const STORAGE_KEY = 'mimiron-detail-width';
const MIN_WIDTH = 280;
const maxWidth = () => Math.floor(window.innerWidth * 0.5);
const clamp = (w) => Math.max(MIN_WIDTH, Math.min(maxWidth(), w));

function setDetailWidth(px) {
  document.documentElement.style.setProperty('--detail-width', px + 'px');
}

function loadInitialWidth() {
  const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
  return clamp(Number.isFinite(saved) && saved > 0 ? saved : 380);
}

export default {
  components: { HeaderBar, CatalogPane, GraphPane },
  setup() {
    let dragState = null;

    function onPointerDown(e) {
      // Only react to primary button / single-touch — let other pointer
      // interactions through.
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--detail-width')
      ) || 380;
      dragState = { startX, startWidth };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add('is-resizing');
    }

    function onPointerMove(e) {
      if (!dragState) return;
      // Dragging left (clientX decreases) widens the detail pane (it grows
      // toward the graph). Dragging right shrinks it.
      const delta = dragState.startX - e.clientX;
      setDetailWidth(clamp(dragState.startWidth + delta));
    }

    function onPointerUp(e) {
      if (!dragState) return;
      dragState = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      document.body.classList.remove('is-resizing');
      const current = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--detail-width')
      );
      if (Number.isFinite(current)) localStorage.setItem(STORAGE_KEY, String(Math.round(current)));
    }

    // On window resize, re-clamp so a shrunk window doesn't leave the pane
    // wider than the new 50% bound.
    function onWindowResize() {
      const current = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--detail-width')
      ) || 380;
      const clamped = clamp(current);
      if (clamped !== current) setDetailWidth(clamped);
    }

    onMounted(() => {
      setDetailWidth(loadInitialWidth());
      window.addEventListener('resize', onWindowResize);
    });

    onUnmounted(() => {
      window.removeEventListener('resize', onWindowResize);
    });

    return { fatal, retry, onPointerDown, onPointerMove, onPointerUp };
  },
  template: /* html */ `
    <header-bar />
    <main id="app-main">
      <catalog-pane />
      <graph-pane />
      <div
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize detail pane"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      ></div>
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
