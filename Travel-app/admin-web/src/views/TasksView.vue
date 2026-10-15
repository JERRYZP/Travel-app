<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { TaskListResult } from '../types';
import { formatDateTime, statusLabel, statusTagType } from '../utils/format';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const rows = ref<TaskListResult['items']>([]);
const total = ref(0);
const filters = reactive({
  status: String(route.query.status || ''),
  spotId: String(route.query.spotId || ''),
  releaseRange: [] as string[],
  page: Number(route.query.page) || 1,
  pageSize: 20,
});

async function load() {
  loading.value = true;
  try {
    const [releaseFrom, releaseTo] = filters.releaseRange || [];
    const res = await callAdmin<TaskListResult>('admin.tasks.list', {
      status: filters.status || undefined,
      spotId: filters.spotId.trim() || undefined,
      releaseFrom: releaseFrom || undefined,
      releaseTo: releaseTo || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    }, auth.token);
    rows.value = res.items;
    total.value = res.total;
    await router.replace({
      query: {
        ...route.query,
        status: filters.status || undefined,
        spotId: filters.spotId || undefined,
        page: String(filters.page),
      },
    });
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '任务列表加载失败');
  } finally {
    loading.value = false;
  }
}

function search() {
  filters.page = 1;
  load();
}

function openTask(id: string) {
  router.push(`/tasks/${id}`);
}

onMounted(load);
watch(() => filters.page, load);
</script>

<template>
  <div class="page">
    <div class="page-heading">
      <div>
        <h2>提醒任务</h2>
        <p>“已触发”表示任务处理完成，不代表消息一定已送达。</p>
      </div>
    </div>
    <section class="panel">
      <div class="filter-row">
        <el-select v-model="filters.status" clearable placeholder="全部状态" style="width: 150px">
          <el-option label="待处理" value="WAITING" />
          <el-option label="已触发" value="TRIGGERED" />
          <el-option label="未送达" value="MISSED" />
        </el-select>
        <el-input v-model="filters.spotId" clearable placeholder="景点 ID，例如 gugong" style="width: 220px" @keyup.enter="search" />
        <el-date-picker v-model="filters.releaseRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="放票开始" end-placeholder="放票结束" />
        <el-button type="primary" @click="search">查询</el-button>
      </div>
      <el-table v-loading="loading" :data="rows" row-key="id" @row-click="(row: { id: string }) => openTask(row.id)">
        <el-table-column prop="userLabel" label="用户" min-width="120" />
        <el-table-column prop="spotName" label="景点" min-width="140" />
        <el-table-column prop="visitDate" label="出行日" width="116" />
        <el-table-column label="放票时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.releaseAt) }}</template>
        </el-table-column>
        <el-table-column label="提前量" width="100">
          <template #default="{ row }">{{ (row.offsets || []).join(' / ') }} 分钟</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.backendStatus)">{{ statusLabel(row.backendStatus) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="发送进度" width="110">
          <template #default="{ row }">{{ (row.sentOffsets || []).length }} / {{ (row.offsets || []).length }}</template>
        </el-table-column>
        <el-table-column prop="lastSendError" label="最近失败原因" min-width="220" show-overflow-tooltip />
      </el-table>
      <div class="pagination-row">
        <el-pagination
          v-model:current-page="filters.page"
          :page-size="filters.pageSize"
          :total="total"
          layout="total, prev, pager, next"
        />
      </div>
    </section>
  </div>
</template>
