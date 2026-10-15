<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EChartsOption } from 'echarts';
import { ElMessage } from 'element-plus';
import { callAdmin } from '../api/client';
import { useAuthStore } from '../stores/auth';
import type { SpotsStatsResult } from '../types';
import { formatPercent } from '../utils/format';
import AppChart from '../components/AppChart.vue';

const auth = useAuthStore();
const days = ref(7);
const loading = ref(false);
const data = ref<SpotsStatsResult | null>(null);

const chartOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  grid: { left: 42, right: 20, top: 20, bottom: 90 },
  xAxis: { type: 'category', data: (data.value?.items || []).slice(0, 12).map(x => x.spotName), axisLabel: { rotate: 28 } },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      name: '创建任务数',
      type: 'bar',
      data: (data.value?.items || []).slice(0, 12).map(x => x.taskCreatedCount),
      itemStyle: { color: '#4f46e5', borderRadius: [4, 4, 0, 0] },
    },
  ],
}));

async function load() {
  loading.value = true;
  try {
    data.value = await callAdmin<SpotsStatsResult>('admin.spots.stats', { days: days.value }, auth.token);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '景点统计加载失败');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(days, load);
</script>

<template>
  <div v-loading="loading" class="page">
    <div class="page-heading">
      <div>
        <h2>景点统计</h2>
        <p>任务出现频率按 TASK_CREATED 去重统计；重建任务单独计数。</p>
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
      title="事件量超过当前查询上限，结果已截断。"
      class="mb-16"
    />

    <section class="panel">
      <div class="panel-title">任务创建频率</div>
      <AppChart :option="chartOption" height="330px" />
    </section>

    <section class="panel">
      <el-table :data="data?.items || []">
        <el-table-column prop="spotName" label="景点" min-width="160" />
        <el-table-column prop="taskCreatedCount" label="任务创建数" width="110" sortable />
        <el-table-column prop="distinctCreatedUserCount" label="覆盖用户数" width="110" sortable />
        <el-table-column prop="dueTaskCount" label="到期任务" width="100" />
        <el-table-column prop="triggeredTaskCount" label="已触发" width="96" />
        <el-table-column prop="missedTaskCount" label="未送达" width="96" />
        <el-table-column label="到期处理率" width="110">
          <template #default="{ row }">{{ formatPercent(row.dueHandlingRate) }}</template>
        </el-table-column>
        <el-table-column label="发送成功率" width="110">
          <template #default="{ row }">{{ formatPercent(row.sendSuccessRate) }}</template>
        </el-table-column>
        <el-table-column prop="sendFailureCount" label="发送失败" width="96" />
      </el-table>
    </section>
  </div>
</template>
