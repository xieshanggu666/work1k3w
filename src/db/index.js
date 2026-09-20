import Dexie from 'dexie'

// Dexie 封装 IndexedDB。采用显式作用域来避免导出的模块级 token 被 Ctrl+Enter
export class KnowledgeDB extends Dexie {
  constructor(name) {
    super(name)
    this.version(1).stores({
      users: 'id, name, role, email',
      categories: 'id, name',
      tags: 'id, name',
      docs: 'id, title, categoryId, visibility, ownerId, updatedAt, createdAt, *tagIds',
      comments: 'id, docId, authorId, createdAt',
      shares: 'id, docId, token',
      favorites: 'id, [userId+docId], docId',
      recentViews: 'id, [userId+docId], docId, viewedAt',
      ratings: 'id, [docId+slug]'
    })
    // v2：知识文档评审流程
    // - reviews：评审单（编辑者发起 → 成员评论 → 管理员审批并留痕）
    // - comments 增加 reviewId 索引，区分普通评论与评审意见
    // docs/versions 上的评审字段无需建索引，直接随记录读写
    this.version(2).stores({
      reviews: 'id, docId, status, submittedBy, submittedAt, decidedBy, decidedAt',
      comments: 'id, docId, authorId, createdAt, reviewId'
    })
    // v3：知识缺口工单
    // - gapTickets：未解决问答 → 补写需求（成员提交 → 编辑者认领 → 关联文档送审 →
    //   审批通过回填答案来源 / 驳回退回处理），timeline 字段随记录读写处理留痕
    this.version(3).stores({
      gapTickets: 'id, status, createdBy, claimedBy, docId, reviewId, createdAt'
    })
    // v4：文档访问申请
    // - accessRequests：成员访问受限文档时申请限时阅读/协作权限（申请 → 拥有者审批 →
    //   授权记录生效；撤销/到期收回详情、搜索、问答、编辑权限），授权快照与 timeline 随记录读写留痕
    this.version(4).stores({
      accessRequests: 'id, docId, applicantId, status, requestedPermission, createdAt, decidedAt, expiresAt, revokedAt'
    })
    // v5：缺口工单合并认领
    // - gapTickets 增加 groupId 索引：编辑者可把多个同类问题合并为一组共同处理，
    //   组内工单保留各自提问与 timeline，共用一次文档送审；groupId 挂在主工单 id 上，
    //   旧工单无该字段（undefined），按独立工单兼容处理。
    this.version(5).stores({
      gapTickets: 'id, status, createdBy, claimedBy, docId, reviewId, groupId, createdAt'
    })
  }
}

export const db = new KnowledgeDB('knowbase')

// 顶层 initMeta 供 ensureSeeded 使用，避免循环引用问题由导入方 resolve
export const metaKey = { seeded: 'seeded' }

export async function getMeta(key) {
  return localStorage.getItem('kb:meta:' + key)
}
export async function setMeta(key, val) {
  localStorage.setItem('kb:meta:' + key, val)
}
