<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DataAnalysis, List, Location, User, SwitchButton } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const activePath = computed(() => {
  if (route.path.startsWith('/users')) return '/users';
  if (route.path.startsWith('/tasks')) return '/tasks';
  if (route.path.startsWith('/spots')) return '/spots';
  return '/overview';
});

function logout() {
  auth.logout();
  router.replace('/login');
}
</script>

<template>
  <el-container class="admin-shell">
    <el-aside width="220px" class="admin-aside">
      <div class="brand">
        <div class="brand-mark">T</div>
        <div>
          <strong>Travel Admin</strong>
          <small>只读运营后台</small>
        </div>
      </div>
      <el-menu :default-active="activePath" router class="admin-menu">
        <el-menu-item index="/overview">
          <el-icon><DataAnalysis /></el-icon><span>概览</span>
        </el-menu-item>
        <el-menu-item index="/users">
          <el-icon><User /></el-icon><span>用户</span>
        </el-menu-item>
        <el-menu-item index="/tasks">
          <el-icon><List /></el-icon><span>提醒任务</span>
        </el-menu-item>
        <el-menu-item index="/spots">
          <el-icon><Location /></el-icon><span>景点统计</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="admin-header">
        <div>
          <span class="header-title">数据仅供运营分析</span>
          <span class="header-note">触发 ≠ 用户已收到，请分开查看</span>
        </div>
        <div class="admin-user">
          <span>{{ auth.admin?.username }}</span>
          <el-button text :icon="SwitchButton" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
