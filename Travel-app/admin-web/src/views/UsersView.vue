<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { UserListResult } from '../types';
import { formatDateTime } from '../utils/format';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const keyword = ref(String(route.query.keyword || ''));
const page = ref(Number(route.query.page) || 1);
const pageSize = ref(20);
const total = ref(0);
const rows = ref<UserListResult['items']>([]);

async function load() {
  loading.value = true;
  try {
    const res = await callAdmin<UserListResult>('admin.users.list', {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim(),
    }, auth.token);
    rows.value = res.items;
    total.value = res.total;
    await router.replace({ query: { ...route.query, keyword: keyword.value || undefined, page: String(page.value) } });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '用户列表加载失败');
  } finally {
    loading.value = false;
  }
}

function search() {
  page.value = 1;
  load();
}

function openUser(id: string) {
  router.push(`/users/${id}`);
}

onMounted(load);
watch(page, load);
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h2>用户</h2>
        <p>敏感字段默认脱敏，完整值在用户详情中按需查看并记录审计。</p>
      </div>
      <el-input v-model="keyword" clearable placeholder="昵称或完整 OpenID" style="width: 280px" @keyup.enter="search" @clear="search">
        <template #append><el-button @click="search">搜索</el-button></template>
      </el-input>
    </div>
    <section class="panel">
      <el-table v-loading="loading" :data="rows" row-key="id" @row-click="(row: { id: string }) => openUser(row.id)">
        <el-table-column prop="nicknameMasked" label="用户" min-width="132" />
        <el-table-column prop="userIdMasked" label="用户 ID" min-width="160" />
        <el-table-column prop="phoneMasked" label="手机号" width="126" />
        <el-table-column prop="tripCount" label="行程" width="76" />
        <el-table-column prop="itemCount" label="行程项" width="86" />
        <el-table-column label="提醒任务" width="190">
          <template #default="{ row }">
            <span class="muted">总 {{ row.taskCounts.total }}</span>
            <el-tag size="small" type="success" class="ml-6">已触发 {{ row.taskCounts.TRIGGERED }}</el-tag>
            <el-tag size="small" type="danger" class="ml-6">未送达 {{ row.taskCounts.MISSED }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="最近任务行为" width="180">
          <template #default="{ row }">{{ formatDateTime(row.lastActiveAt) }}</template>
        </el-table-column>
        <el-table-column label="注册时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
      </el-table>
      <div class="pagination-row">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
        />
      </div>
    </section>
  </div>
</template>
