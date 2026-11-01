<script setup lang="ts">
defineProps<{
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'success' | 'danger' | 'warning';
}>();
</script>

<template>
  <div class="metric-card" :class="`tone-${tone || 'default'}`">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">{{ value }}</div>
    <div v-if="hint" class="metric-hint">{{ hint }}</div>
  </div>
</template>
