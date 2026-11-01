<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { OverviewResult, SpotStat } from '../types';
import { formatPercent } from '../utils/format';
import MetricCard from '../components/MetricCard.vue';
import AppChart from '../components/AppChart.vue';

const auth = useAuthStore();
const days = ref(7);
const loading = ref(false);
const data = ref<OverviewResult | null>(null);

const trendOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['创建任务', '已触发', '未送达'] },
  grid: { left: 42, right: 20, top: 42, bottom: 28 },
  xAxis: { type: 'category', data: (data.value?.trend || []).map(x => x.dateKey.slice(5)) },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    { name: '创建任务', type: 'line', smooth: true, data: (data.value?.trend || []).map(x => x.taskCreatedCount) },
    { name: '已触发', type: 'line', smooth: true, data: (data.value?.trend || []).map(x => x.triggeredTaskCount) },
    { name: '未送达', type: 'line', smooth: true, data: (data.value?.trend || []).map(x => x.missedTaskCount) },
  ],
}));

async function load() {
  loading.value = true;
  try {
    data.value = await callAdmin<OverviewResult>('admin.overview', { days: days.value }, auth.token);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '概览加载失败');
  } finally {
    loading.value = false;
  }
}

function openSpot(row: SpotStat) {
  window.location.hash = `#/spots?spotId=${encodeURIComponent(row.spotId)}`;
}

onMounted(load);
watch(days, load);
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-heading">
      <div>
        <h2>概览</h2>
        <p>用任务行为判断活跃度，按北京时间统计。</p>
      </div>
      <el-radio-group v-model="days">
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
        <el-radio-button :value="90">近 90 天</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert
      v-if="data?.dataTruncated"
      type="warning"
      show-icon
      title="事件量超过当前查询上限，统计结果已截断；请使用更短时间范围。"
      class="mb-16"
    />

    <div class="metric-grid">
      <MetricCard label="用户总数" :value="data?.userTotal ?? '-'" hint="users 集合" />
      <MetricCard label="区间新增用户" :value="data?.newUserCount ?? '-'" hint="按 createdAt" />
      <MetricCard label="创建提醒任务" :value="data?.metrics.taskCreatedCount ?? '-'" hint="TASK_CREATED" />
      <MetricCard label="到期任务" :value="data?.metrics.dueTaskCount ?? '-'" hint="按 releaseAt" />
      <MetricCard label="已触发" :value="data?.metrics.triggeredTaskCount ?? '-'" tone="success" />
      <MetricCard label="未送达" :value="data?.metrics.missedTaskCount ?? '-'" tone="danger" />
      <MetricCard label="到期处理率" :value="formatPercent(data?.metrics.dueHandlingRate)" hint="已触发 /（已触发+未送达）" />
      <MetricCard label="消息发送成功率" :value="formatPercent(data?.metrics.sendSuccessRate)" hint="不含跳过" />
    </div>

    <div class="content-grid">
      <section class="panel">
        <div class="panel-title">任务趋势</div>
        <AppChart :option="trendOption" height="330px" />
      </section>
      <section class="panel">
        <div class="panel-title">Top 10 景点</div>
        <el-table :data="data?.topSpots || []" height="330" @row-click="openSpot">
          <el-table-column prop="spotName" label="景点" min-width="140" />
          <el-table-column prop="taskCreatedCount" label="任务数" width="82" />
          <el-table-column prop="distinctCreatedUserCount" label="用户数" width="82" />
          <el-table-column label="处理率" width="86">
            <template #default="{ row }">{{ formatPercent(row.dueHandlingRate) }}</template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </div>
</template>
