import { createRouter, createWebHashHistory } from 'vue-router';
import EmptyDetail from './views/EmptyDetail.js';
import SoftwareDetail from './views/SoftwareDetail.js';
import ContractDetail from './views/ContractDetail.js';
import GraphView from './views/GraphView.js';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: EmptyDetail, name: 'home' },
    { path: '/graph', component: GraphView, name: 'graph' },
    { path: '/software/:name', component: SoftwareDetail, name: 'software', props: true },
    { path: '/contracts/:id', component: ContractDetail, name: 'contract', props: true },
  ],
});
