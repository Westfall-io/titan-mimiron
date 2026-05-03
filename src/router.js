import { createRouter, createWebHashHistory } from 'vue-router';
import EmptyDetail from './views/EmptyDetail.js';
import PartDetail from './views/PartDetail.js';
import ContractDetail from './views/ContractDetail.js';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: EmptyDetail, name: 'home' },
    { path: '/parts/:name', component: PartDetail, name: 'part', props: true },
    { path: '/contracts/:id', component: ContractDetail, name: 'contract', props: true },
  ],
});
