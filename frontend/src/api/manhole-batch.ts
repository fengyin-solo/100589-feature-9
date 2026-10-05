import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 检查井成批养护的领域规则都收在这一个文件里，页面只管展示和收集输入。
const MODULE_KEY = 'manhole'

// 井深阈值（米）：超过这个深度的井不能当普通井一起办，要单独提出来走专项。
export const MANHOLE_DEPTH_LIMIT = 6

// 破损井盖是必检项：过滤条件再怎么收，也不能把它从选中里悄悄漏掉。
export const DAMAGED_COVER_KEYWORD = '破损'

// 已受理批次的登记簿：同一批井（去重排序后的井 id 集合）只办先到的那一次。
// 不走 local-store 的内存缓存，每次直读 localStorage，另一个标签页先提交的批次这里能立刻看到。
const BATCH_LOCK_KEY = 'drainage-pump:manhole-batches'

export type BatchLockRecord = {
  operator: string
  at: string
  measure: string
  inspector: string
  accepted: number
  succeeded: number
}

export type ManholeBatchPreview = {
  candidates: EntryRow[]
  deepWells: EntryRow[]
}

export type ManholeBatchSuccess = { id: number; wellNo: string }
export type ManholeBatchFailure = { id: number; wellNo: string; reason: string }
export type ManholeBatchDeepWell = { id: number; wellNo: string; depth: number }

export type ManholeBatchResult = {
  ok: boolean
  message: string
  batchKey: string
  accepted: number
  succeeded: ManholeBatchSuccess[]
  failed: ManholeBatchFailure[]
  deepWells: ManholeBatchDeepWell[]
}

export function isDamagedCover(cover: string): boolean {
  return cover.includes(DAMAGED_COVER_KEYWORD)
}

// 井深在台账里可能是 3.2 也可能是 "3.2米"，统一抽出数值；抽不出来按未知处理，不当成超深。
export function parseWellDepth(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function isDeepWell(row: EntryRow): boolean {
  const depth = parseWellDepth(row['井深'])
  return depth !== null && depth > MANHOLE_DEPTH_LIMIT
}

// 批量动作之后井体状态跟着重算：由井盖状况和井深推导，不沿用旧值。
export function recalcWellBodyStatus(row: EntryRow): string {
  const cover = String(row['井盖状况'] ?? '')
  if (isDamagedCover(cover)) {
    return '井盖破损待更换'
  }
  if (cover.includes('沉降')) {
    return '井体沉降待观察'
  }
  if (cover.includes('松动')) {
    return '井盖松动待加固'
  }
  if (isDeepWell(row)) {
    return '深井需专项养护'
  }
  return '井体完好'
}

// 圈井：按所属管段把井圈成一整段，再按井盖状况过滤；
// 破损的强制留在选中里，深井不进候选、单独提出来。
export function previewManholeBatch(
  wells: EntryRow[],
  segment: string,
  includedCovers: string[],
): ManholeBatchPreview {
  const onSegment = wells.filter((row) => String(row['所属管段'] ?? '') === segment)
  const deepWells = onSegment.filter(isDeepWell)
  const candidates = onSegment.filter((row) => {
    if (isDeepWell(row)) {
      return false
    }
    const cover = String(row['井盖状况'] ?? '')
    return includedCovers.includes(cover) || isDamagedCover(cover)
  })
  return { candidates, deepWells }
}

const memoryLocks: Record<string, BatchLockRecord> = {}

function readBatchLocks(): Record<string, BatchLockRecord> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return memoryLocks
  }
  try {
    return JSON.parse(
      window.localStorage.getItem(BATCH_LOCK_KEY) ?? '{}',
    ) as Record<string, BatchLockRecord>
  } catch {
    return {}
  }
}

function writeBatchLock(key: string, record: BatchLockRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    memoryLocks[key] = record
    return
  }
  const locks = readBatchLocks()
  locks[key] = record
  window.localStorage.setItem(BATCH_LOCK_KEY, JSON.stringify(locks))
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function nowLabel(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function rejected(batchKey: string, message: string): ManholeBatchResult {
  return { ok: false, message, batchKey, accepted: 0, succeeded: [], failed: [], deepWells: [] }
}

// 成批提交：去重 → 查批次锁 → 逐口判定 → 只对能成的井落库。
// 没成的井（失败或深井）保持原样，一个字也不动。
export function scheduleManholeBatch(input: {
  wellIds: number[]
  measure: string
  inspector: string
  operator: string
}): ManholeBatchResult {
  // 同一口井在一批里只出现一次，重复圈进去的按一次算。
  const uniqueIds = [...new Set(input.wellIds.map((id) => Number(id)))]
  const batchKey = uniqueIds
    .slice()
    .sort((a, b) => a - b)
    .join(',')
  const measure = input.measure.trim()
  const inspector = input.inspector.trim()

  if (uniqueIds.length === 0) {
    return rejected(batchKey, '本批没有圈入任何检查井')
  }
  if (!measure) {
    return rejected(batchKey, '请先填写统一的养护措施')
  }
  if (!inspector) {
    return rejected(batchKey, '请先填写统一的检查人')
  }

  // 同一批井被两个人同时操作时，只按先到的那批办，后到的整批退回。
  const existing = readBatchLocks()[batchKey]
  if (existing) {
    return rejected(
      batchKey,
      `这批井已由 ${existing.operator} 于 ${existing.at} 提交（养护措施：${existing.measure}），按先到批次办理，本次不再重复安排`,
    )
  }

  const rows = listRows(MODULE_KEY)
  const byId = new Map(rows.map((row) => [Number(row.id), row]))
  const succeeded: ManholeBatchSuccess[] = []
  const failed: ManholeBatchFailure[] = []
  const deepWells: ManholeBatchDeepWell[] = []
  const updates = new Map<number, EntryRow>()

  for (const id of uniqueIds) {
    const row = byId.get(id)
    if (!row) {
      failed.push({ id, wellNo: `井#${id}`, reason: '台账里找不到这口井' })
      continue
    }
    const wellNo = String(row['井编号'] ?? `井#${id}`)
    const depth = parseWellDepth(row['井深'])
    if (depth !== null && depth > MANHOLE_DEPTH_LIMIT) {
      // 超深井不随普通井一起办，单独提出，数据保持原样。
      deepWells.push({ id, wellNo, depth })
      continue
    }
    const status = String(row.status)
    if (status === '已养护') {
      failed.push({ id, wellNo, reason: '已完成养护，不重复安排' })
      continue
    }
    if (status === '需维修') {
      failed.push({ id, wellNo, reason: '井体需维修，请走维修流程，不按普通养护办理' })
      continue
    }
    if (status !== '待检查') {
      failed.push({ id, wellNo, reason: `当前状态「${status}」，已在养护流程中，不重复安排` })
      continue
    }
    const next: EntryRow = {
      ...row,
      养护措施: measure,
      检查人: inspector,
      检查日期: today(),
      status: '待养护',
      pending: true,
      abnormal: false,
    }
    next['井体状态'] = recalcWellBodyStatus(next)
    updates.set(id, next)
    succeeded.push({ id, wellNo })
  }

  if (updates.size > 0) {
    saveRows(
      MODULE_KEY,
      rows.map((row) => updates.get(Number(row.id)) ?? row),
    )
    writeBatchLock(batchKey, {
      operator: input.operator,
      at: nowLabel(),
      measure,
      inspector,
      accepted: uniqueIds.length,
      succeeded: succeeded.length,
    })
  }

  const parts = [`本批受理 ${uniqueIds.length} 口`, `成功 ${succeeded.length} 口`]
  if (failed.length > 0) {
    parts.push(`失败 ${failed.length} 口`)
  }
  if (deepWells.length > 0) {
    parts.push(`深井单独提出 ${deepWells.length} 口`)
  }
  return {
    ok: true,
    message: parts.join('，'),
    batchKey,
    accepted: uniqueIds.length,
    succeeded,
    failed,
    deepWells,
  }
}
