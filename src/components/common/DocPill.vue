<script setup>
import { computed } from 'vue'
import { useKbStore } from '@/stores/kb'
import { useReviewStore } from '@/stores/review'

const props = defineProps({
  doc: { type: Object, required: true }
})
const kb = useKbStore()
const reviewStore = useReviewStore()

const catName = computed(() => kb.catMap[props.doc.categoryId]?.name || '未分类')
const tags = computed(() => (props.doc.tagIds || []).map((id) => kb.tagMap[id]).filter(Boolean))

// 评审中优先以内存中流转的评审单为准（跨文档列表也能实时反映）
const inReview = computed(() => !!reviewStore.pendingReviewOf(props.doc.id))
const rejectedLast = computed(() => props.doc.lastReview?.status === 'rejected')

const visibilityLabel = { public: '公开', team: '团队', private: '私有' }
</script>

<template>
  <div class="docbadges">
    <span v-if="inReview" class="pill rv-review">⏳ 评审中</span>
    <span v-else-if="rejectedLast" class="pill rv-rejected">↩ 已驳回</span>
    <span class="pill v" :class="'v-' + doc.visibility">{{ visibilityLabel[doc.visibility] || doc.visibility }}</span>
    <span class="pill cat">{{ catName }}</span>
    <span v-for="t in tags" :key="t.id" class="pill tag" :style="{ background: t.color }">{{ t.name }}</span>
  </div>
</template>

<style scoped>
.docbadges { display: flex; flex-wrap: wrap; gap: 6px; }
.v { font-size: 11px; }
.rv-review { background: #b45309; color: #fff; font-size: 11px; }
.rv-rejected { background: var(--danger); color: #fff; font-size: 11px; }
</style>
