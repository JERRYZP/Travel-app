<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { UserDetailResult } from '../types';
import { formatDateTime, statusLabel } from '../utils/format';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loading = ref(false);
const data = ref<UserDetailResult | null>(null);
const revealed = ref<Record<string, string>>({});

async function load() {
  loading.value = true;
  try {
    data.value = await callAdmin<UserDetailResult>('admin.user.detail', { id: route.params.id }, auth.token);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '用户详情加载失败');
  } finally {
    loading.value = false;
  }
}

async function reveal(field: 'openId' | 'phone' | 'nickname') {
  try {
    const res = await callAdmin<{ field: string; value: string }>('admin.audit.viewSensitive', {
      id: route.params.id,
      field,
    }, auth.token);
    revealed.value[field] = res.value;
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '查看失败');
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-heading">
      <div>
        <el-button text @click="router.back()">← 返回用户列表</el-button>
        <h2>{{ data?.user.nicknameMasked || '用户详情' }}</h2>
      </div>
      <el-tag type="info">{{ data?.user.memberLevel || 'NORMAL' }}</el-tag>
    </div>

    <div class="detail-grid">
      <section class="panel">
        <div class="panel-title">基础信息</div>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="用户 ID">{{ data?.user.userIdMasked || '-' }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ data?.user.nicknameMasked || '-' }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ data?.user.phoneMasked || '-' }}</el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ formatDateTime(data?.user.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="最近任务行为">{{ formatDateTime(data?.user.lastActiveAt) }}</el-descriptions-item>
          <el-descriptions-item label="订阅额度">{{ data?.user.subscribeQuota ?? '-' }}</el-descriptions-item>
        </el-descriptions>
      </section>

      <section class="panel">
        <div class="panel-title">敏感字段查看</div>
        <p class="muted">查看动作会写入审计日志。列表页永不展示完整值。</p>
        <div class="sensitive-row">
          <span>OpenID</span>
          <code>{{ revealed.openId || data?.user.userIdMasked }}</code>
          <el-button size="small" @click="reveal('openId')">查看</el-button>
        </div>
        <div class="sensitive-row">
          <span>手机号</span>
          <code>{{ revealed.phone || data?.user.phoneMasked || '-' }}</code>
          <el-button size="small" @click="reveal('phone')">查看</el-button>
        </div>
        <div class="sensitive-row">
          <span>昵称</span>
          <code>{{ revealed.nickname || data?.user.nicknameMasked }}</code>
          <el-button size="small" @click="reveal('nickname')">查看</el-button>
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="panel-title">提醒任务摘要</div>
      <div class="metric-grid compact">
        <div class="mini-stat"><span>总任务</span><strong>{{ data?.taskCounts.total ?? 0 }}</strong></div>
        <div class="mini-stat"><span>待处理</span><strong>{{ data?.taskCounts.WAITING ?? 0 }}</strong></div>
        <div class="mini-stat"><span>已触发</span><strong>{{ data?.taskCounts.TRIGGERED ?? 0 }}</strong></div>
        <div class="mini-stat"><span>未送达</span><strong>{{ data?.taskCounts.MISSED ?? 0 }}</strong></div>
      </div>
      <el-table :data="data?.tasks || []" class="mt-16">
        <el-table-column prop="spotId" label="景点" min-width="130" />
        <el-table-column prop="visitDate" label="出行日" width="120" />
        <el-table-column label="放票时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.releaseAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">{{ statusLabel(row.backendStatus) }}</template>
        </el-table-column>
        <el-table-column prop="missedReason" label="失败原因" min-width="220" show-overflow-tooltip />
      </el-table>
    </section>
  </div>
</template>
