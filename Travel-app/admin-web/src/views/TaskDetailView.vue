<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { TaskDetailResult } from '../types';
import { formatDateTime, statusLabel, statusTagType } from '../utils/format';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const data = ref<TaskDetailResult | null>(null);

const eventLabels: Record<string, string> = {
  TASK_CREATED: '任务创建',
  TASK_REBUILT: '任务重建',
  TASK_CANCELED: '任务取消',
  SEND_SUCCEEDED: '发送成功',
  SEND_FAILED: '发送失败',
  SEND_SKIPPED: '发送跳过',
  TASK_TRIGGERED: '任务已处理',
  TASK_MISSED: '任务未送达',
};

const events = computed(() => (data.value?.events || []).slice().sort((a, b) =>
  new Date(String(b.eventAt)).getTime() - new Date(String(a.eventAt)).getTime()));

async function load() {
  loading.value = true;
  try {
    data.value = await callAdmin<TaskDetailResult>('admin.task.detail', { id: route.params.id }, auth.token);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '任务详情加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-heading">
      <div>
        <el-button text @click="router.back()">← 返回任务列表</el-button>
        <h2>{{ data?.task.spotName || '任务详情' }}</h2>
      </div>
      <el-tag v-if="data" :type="statusTagType(data.task.backendStatus)">
        {{ statusLabel(data.task.backendStatus) }}
      </el-tag>
    </div>

    <div class="detail-grid">
      <section class="panel">
        <div class="panel-title">任务信息</div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户">{{ data?.task.userLabel || '-' }}</el-descriptions-item>
          <el-descriptions-item label="景点">{{ data?.task.spotName || '-' }}</el-descriptions-item>
          <el-descriptions-item label="出行日">{{ data?.task.visitDate || '-' }}</el-descriptions-item>
          <el-descriptions-item label="放票时间">{{ formatDateTime(data?.task.releaseAt) }}</el-descriptions-item>
          <el-descriptions-item label="提前量">{{ (data?.task.offsets || []).join(' / ') }} 分钟</el-descriptions-item>
          <el-descriptions-item label="已处理">{{ (data?.task.sentOffsets || []).join(' / ') || '-' }}</el-descriptions-item>
          <el-descriptions-item label="触发时间">{{ formatDateTime(data?.task.triggeredAt) }}</el-descriptions-item>
          <el-descriptions-item label="失败原因">{{ data?.task.missedReason || data?.task.lastSendError || '-' }}</el-descriptions-item>
        </el-descriptions>
      </section>
      <section class="panel">
        <div class="panel-title">事件说明</div>
        <p class="muted">
          “任务已处理”不等同于用户已收到。发送成功或失败必须查看下方向下的事件时间线。
        </p>
        <p class="muted">原始事件保留 180 天；超过期限后仍保留每日汇总。</p>
      </section>
    </div>

    <section class="panel">
      <div class="panel-title">事件时间线</div>
      <el-timeline>
        <el-timeline-item
          v-for="event in events"
          :key="String(event.eventKey || event._id)"
          :timestamp="formatDateTime(event.eventAt)"
          placement="top"
        >
          <strong>{{ eventLabels[String(event.eventType)] || event.eventType }}</strong>
          <div v-if="event.offset !== null && event.offset !== undefined" class="muted">提前量：{{ event.offset }} 分钟</div>
          <div v-if="event.errorMessage" class="error-text">{{ event.errorMessage }}</div>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-if="events.length === 0" description="暂无事件" />
    </section>
  </div>
</template>
