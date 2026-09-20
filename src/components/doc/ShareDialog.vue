<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { db } from '@/db'
import { uid, makeToken, formatDate, formatFull } from '@/utils/format'
import { docUrl, shareUrl, shareStatus, shareStatusLabel } from '@/utils/share'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({ open: Boolean, doc: Object })
const emit = defineEmits(['close'])
const auth = useAuthStore()

const shares = ref([])
const perm = ref('view')
const expireDays = ref(0)
const expireOptions = [
  { value: 0, label: '永久有效' },
  { value: 1, label: '1 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' }
]

const userById = computed(() => Object.fromEntries(auth.users.map((u) => [u.id, u])))
const userName = (id) => userById.value[id]?.name || id || '未知用户'

async function load() {
  if (!props.doc) return
  const rows = await db.shares.where('docId').equals(props.doc.id).toArray()
  shares.value = rows.reverse()
}

async function create() {
  const now = new Date()
  const s = {
    id: uid('share'),
    docId: props.doc.id,
    token: makeToken(),
    permission: perm.value,
    createdBy: auth.user?.id,
    createdAt: now.toISOString(),
    expiresAt: expireDays.value > 0 ? new Date(now.getTime() + expireDays.value * 86400000).toISOString() : null,
    revokedAt: null
  }
  await db.shares.add(s)
  shares.value.unshift(s)
}

// 撤销：标记状态而非删除，链接端可明确提示「已撤销」
async function revoke(id) {
  const revokedAt = new Date().toISOString()
  await db.shares.update(id, { revokedAt })
  const s = shares.value.find((x) => x.id === id)
  if (s) s.revokedAt = revokedAt
}

function statusOf(s) {
  return shareStatus(s)
}

function expireText(s) {
  if (s.revokedAt) return '撤销于 ' + formatDate(s.revokedAt)
  if (!s.expiresAt) return '永久有效'
  return (statusOf(s) === 'expired' ? '过期于 ' : '将于 ') + formatFull(s.expiresAt) + (statusOf(s) === 'expired' ? '' : ' 过期')
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => alert('链接已复制。'))
}

const currentUrl = computed(() => (props.doc ? docUrl(props.doc.id) : ''))

function onRootClick() { emit('close') }
function stop(e) { e.stopPropagation() }
onMounted(load)
watch(() => props.open, (v) => { if (v && props.doc) load() })
</script>

<template>
  <teleport to="body">
    <div v-if="open" class="mask" @click.self="onRootClick">
      <div class="dialog" @click="stop">
        <div class="dialog-head">
          <h3>分享「{{ doc?.title }}」</h3>
          <button class="x" @click="emit('close')">✕</button>
        </div>

        <div class="sec">
          <div class="sec-label">当前页面链接</div>
          <div class="url-row">
            <code class="url">{{ currentUrl }}</code>
            <button class="btn sm" @click="copy(currentUrl)">复制</button>
          </div>
          <div class="hint">可见性：{{ doc?.visibility === 'public' ? '公开，所有人可看' : doc?.visibility === 'team' ? '团队，登录成员可看' : '私有，仅授权成员' }}</div>
        </div>

        <div class="sec">
          <div class="sec-label">生成共享链接</div>
          <div class="create-row">
            <select v-model="perm" class="perm">
              <option value="view">仅查看</option>
              <option value="edit">可编辑</option>
            </select>
            <select v-model="expireDays" class="perm">
              <option v-for="o in expireOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <button class="btn primary sm" @click="create">生成链接</button>
          </div>
          <div v-if="shares.length" class="share-list">
            <div v-for="s in shares" :key="s.id" class="share-item" :class="{ off: statusOf(s) !== 'active' }">
              <div class="share-info">
                <div class="surl">
                  <code>{{ shareUrl(s.token) }}</code>
                  <span class="badge" :class="statusOf(s)">{{ shareStatusLabel(statusOf(s)) }}</span>
                </div>
                <div class="smeta">{{ s.permission === 'edit' ? '可编辑' : '仅查看' }} · 由 {{ userName(s.createdBy) }} 创建 · {{ formatDate(s.createdAt) }} · {{ expireText(s) }}</div>
              </div>
              <button class="btn sm" :disabled="statusOf(s) !== 'active'" @click="copy(shareUrl(s.token))">复制</button>
              <button v-if="statusOf(s) === 'active'" class="btn sm danger" @click="revoke(s.id)">撤销</button>
            </div>
          </div>
          <div v-else class="hint">尚未生成共享链接</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: rgba(15, 20, 30, 0.45); display: grid; place-items: center; z-index: 100; }
.dialog { width: 520px; max-width: 92vw; background: #fff; border-radius: 14px; padding: 20px 24px; box-shadow: var(--shadow); }
.dialog-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.dialog-head h3 { margin: 0; }
.x { border: none; background: transparent; font-size: 16px; cursor: pointer; color: var(--text-3); }
.sec { margin-bottom: 18px; }
.sec-label { font-size: 13px; font-weight: 600; color: var(--text-2); margin-bottom: 8px; }
.url-row { display: flex; gap: 8px; align-items: center; }
.url { flex: 1; background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { color: var(--text-3); font-size: 12px; margin-top: 6px; }
.create-row { display: flex; gap: 8px; }
.perm { border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px; font-size: 13px; }
.share-list { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.share-item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
.share-item.off { opacity: 0.65; background: var(--panel-2); }
.share-info { flex: 1; min-width: 0; }
.surl { display: flex; align-items: center; gap: 8px; overflow: hidden; }
.surl code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { flex-shrink: 0; font-size: 11px; padding: 0 8px; border-radius: 999px; line-height: 18px; }
.badge.active { background: #e3f7ef; color: var(--accent); }
.badge.expired { background: var(--panel-2); color: var(--text-3); border: 1px solid var(--border); }
.badge.revoked { background: #ffe9ea; color: var(--danger); }
.smeta { color: var(--text-3); font-size: 11px; margin-top: 2px; }
</style>
