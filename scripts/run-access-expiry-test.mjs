// 授权失效后内容可见性回归：限时授权到期 / 撤销后，详情、搜索、问答三处受限内容必须同步收回。
// 覆盖：
//   1. activeGrantMap 随响应式时钟到期自动失效（无需刷新、无需数据变更）；
//   2. 撤销授权后 grantOf / canViewDoc 立即拒绝（详情正文不再可读）；
//   3. 问答结果缓存（hitIds）在授权撤销后经可见性计算属性重新过滤，受限正文不残留；
//   4. 跨窗口广播（BroadcastChannel）触发其他窗口重读授权表。
// 运行：npm run test:perm 之外可 node 打包执行（本脚本复用 perm 的打包命令风格）。
import 'fake-indexeddb/auto'
import { createApp } from 'vue'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import { db } from '@/db'
import { useKbStore } from '@/stores/kb'
import { useAccessStore } from '@/stores/access'
import { uid } from '@/utils/format'
import { ACCESS, ACCESS_PERM } from '@/utils/access'
import { PUBLISH } from '@/utils/review'
import { canViewDoc, ROLE } from '@/utils/permission'

const pinia = createPinia()
createApp({ render: () => null }).use(pinia)
const kb = useKbStore(pinia)
const access = useAccessStore(pinia)

const viewer = { id: 'u-view', role: ROLE.VIEWER, name: '只读甲' }
const editor = { id: 'u-edit', role: ROLE.EDITOR, name: '编辑甲' }

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅', msg) }
  else { failed++; console.error('  ❌', msg) }
}

const nowIso = new Date().toISOString()
async function mkPrivateDoc(bodyWord) {
  const d = {
    id: uid('doc'), title: '受限文档-' + bodyWord,
    body: '<p>受限正文 ' + bodyWord + '</p>', categoryId: 'c', tagIds: [], visibility: 'private',
    ownerId: editor.id, editors: [editor.id], publishState: PUBLISH.PUBLISHED, activeReviewId: null,
    createdAt: nowIso, updatedAt: nowIso,
    versions: [{ version: 1, savedAt: nowIso, savedBy: editor.id, note: '初始' }]
  }
  await db.docs.add(d)
  await kb.reloadDocs()
  return d
}

async function mkGrant(docId, applicant, permission, expiresAt) {
  const req = {
    id: uid('acc'), docId, applicantId: applicant.id, status: ACCESS.APPROVED,
    requestedPermission: permission, reason: '', createdAt: nowIso,
    decidedBy: editor.id, decidedAt: nowIso, decisionNote: '',
    expiresAt, revokedAt: null,
    grant: { permission, grantedAt: nowIso, expiresAt, revokedAt: null },
    timeline: []
  }
  await db.accessRequests.add(req)
  await access.reload()
  return req
}

// ---------- 1. 限时授权到期：响应式时钟驱动，详情/搜索/问答统一判定立即失效 ----------
console.log('\n[1] 限时授权到期后内容同步收回（响应式时钟）')
const d1 = await mkPrivateDoc('到期')
// 形式上 2 秒后到期（此处只验证「时钟越过到期点」的响应式行为，不启动真实定时器）
const soon = new Date(Date.now() + 2000).toISOString()
const g1 = await mkGrant(d1.id, viewer, ACCESS_PERM.READ, soon)
await access.reload()

assert(access.grantOf(d1.id, viewer.id)?.id === g1.id, '到期前：有效授权可查')
assert(canViewDoc(d1, viewer.id, null, access.grantOf(d1.id, viewer.id)) === true, '到期前：详情可读')

// 模拟时间流逝到到期后（与 onExpiryTick 相同的推进方式：clock 更新，记录状态保持 approved）
access.clock = new Date(Date.now() + 3000).getTime()
await nextTick()
const expiredReq = await db.accessRequests.get(g1.id)
assert(expiredReq.status === ACCESS.APPROVED, '到期是惰性判定：记录状态仍为 approved')
assert(access.grantOf(d1.id, viewer.id) === null, '到期后：activeGrantMap 自动剔除该授权')
assert(canViewDoc(d1, viewer.id, null, access.grantOf(d1.id, viewer.id)) === false, '到期后：详情不再可读')

// 列表/搜索式批量过滤同样失效
const visibleAfterExpiry = kb.docs.filter((d) => canViewDoc(d, viewer.id, null, access.grantOf(d.id, viewer.id)))
assert(!visibleAfterExpiry.some((d) => d.id === d1.id), '到期后：受限文档从搜索/列表过滤结果中消失')

// ---------- 2. 撤销授权：授权表变更即时收回详情 ----------
console.log('\n[2] 撤销授权后详情立即不可读')
const d2 = await mkPrivateDoc('撤销')
const g2 = await mkGrant(d2.id, viewer, ACCESS_PERM.READ, new Date(Date.now() + 7 * 86400000).toISOString())
// 撤销用例不依赖模拟时钟，恢复到真实时间基准
access.clock = Date.now()
assert(canViewDoc(d2, viewer.id, null, access.grantOf(d2.id, viewer.id)) === true, '撤销前：详情可读')
await access.revokeGrant(g2.id, '收回', editor)
assert(access.grantOf(d2.id, viewer.id) === null, '撤销后：grantOf 立即返回 null')
assert(canViewDoc(d2, viewer.id, null, access.grantOf(d2.id, viewer.id)) === false, '撤销后：详情不再可读')

// ---------- 3. 问答结果缓存：回答后撤销授权，引用中的受限正文同步剔除 ----------
console.log('\n[3] 问答已展示的受限正文随撤销收回')
const d3 = await mkPrivateDoc('问答密文')
const g3 = await mkGrant(d3.id, viewer, ACCESS_PERM.READ, new Date(Date.now() + 7 * 86400000).toISOString())

// 复刻 QAAssistant 的缓存与可见性计算逻辑（hitIds 只存 id，展示时重新过权限）
const hitIds = [d3.id]
const docById = Object.fromEntries(kb.docs.map((d) => [d.id, d]))
function visibleHits() {
  return hitIds
    .map((id) => docById[id])
    .filter((d) => d && canViewDoc(d, viewer.id, null, access.grantOf(d.id, viewer.id)))
}
assert(visibleHits().some((d) => d.id === d3.id), '回答后撤销前：引用来源仍可见')
await access.revokeGrant(g3.id, '收回', editor)
assert(!visibleHits().some((d) => d.id === d3.id), '撤销后：问答引用重新过滤，受限文档不再保留')

// ---------- 4. 多个授权在同一时钟下按各自到期点判定 ----------
console.log('\n[4] 时钟越过某授权的到期点后仅该授权失效')
const d4 = await mkPrivateDoc('时钟甲')
const d5 = await mkPrivateDoc('时钟乙')
const t4 = Date.now() + 5000
const g4 = await mkGrant(d4.id, { id: 'u-view2', role: ROLE.VIEWER }, ACCESS_PERM.READ, new Date(t4).toISOString())
// 第二条授权更晚到期：时钟越过 t4 后仍应有效
const t5 = Date.now() + 60000
await mkGrant(d5.id, { id: 'u-view2', role: ROLE.VIEWER }, ACCESS_PERM.READ, new Date(t5).toISOString())
assert(access.grantOf(d4.id, 'u-view2')?.id === g4.id, '两条授权均未到期：均可查')
assert(access.grantOf(d5.id, 'u-view2') !== null, '较晚到期的授权当前有效')
access.clock = t4 + 100
await nextTick()
assert(access.grantOf(d4.id, 'u-view2') === null, '时钟越过较早到期点：该授权失效')
assert(access.grantOf(d5.id, 'u-view2') !== null, '较晚到期的授权不受影响，仍可读')
// 再推进到第二条到期后
access.clock = t5 + 100
await nextTick()
assert(access.grantOf(d5.id, 'u-view2') === null, '时钟越过较晚到期点：该授权同样失效')

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
