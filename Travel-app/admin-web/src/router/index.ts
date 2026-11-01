import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
const LoginView = () => import('../views/LoginView.vue');
const OverviewView = () => import('../views/OverviewView.vue');
const UsersView = () => import('../views/UsersView.vue');
const UserDetailView = () => import('../views/UserDetailView.vue');
const TasksView = () => import('../views/TasksView.vue');
const TaskDetailView = () => import('../views/TaskDetailView.vue');
const SpotsView = () => import('../views/SpotsView.vue');
import AppShell from '../components/AppShell.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: AppShell,
      meta: { requiresAuth: true },
      children: [
        { path: '', redirect: '/overview' },
        { path: 'overview', name: 'overview', component: OverviewView },
        { path: 'users', name: 'users', component: UsersView },
        { path: 'users/:id', name: 'user-detail', component: UserDetailView },
        { path: 'tasks', name: 'tasks', component: TasksView },
        { path: 'tasks/:id', name: 'task-detail', component: TaskDetailView },
        { path: 'spots', name: 'spots', component: SpotsView },
      ],
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  if (to.name === 'login' && auth.isAuthenticated) return { name: 'overview' };
  return true;
});

export default router;
