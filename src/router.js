import { createRouter, createWebHashHistory } from 'vue-router';
import EmptyDetail from './views/EmptyDetail.js';
import PartDetail from './views/PartDetail.js';
import ContractDetail from './views/ContractDetail.js';
import EmptyTemplate from './views/EmptyTemplate.js';
import TemplateDetail from './views/TemplateDetail.js';
import ProjectDetail from './views/ProjectDetail.js';

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: EmptyDetail, name: 'home' },
    { path: '/parts/:name', component: PartDetail, name: 'part', props: true },
    { path: '/contracts/:id', component: ContractDetail, name: 'contract', props: true },
    { path: '/projects/:name', component: ProjectDetail, name: 'project', props: true },
    { path: '/templates', component: EmptyTemplate, name: 'templates' },
    { path: '/templates/:kind', component: TemplateDetail, name: 'template', props: true },
  ],
});
