import { ref } from 'vue';

export const search = ref('');
export const health = ref({ status: 'unknown', version: '', db: '' });
export const fatal = ref(null);
export const retryNonce = ref(0);

export function retry() {
  fatal.value = null;
  retryNonce.value++;
}
