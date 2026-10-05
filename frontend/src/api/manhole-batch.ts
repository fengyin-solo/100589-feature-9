import { listRows, listRowsFresh, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 检查井「成批养护安排」的全部业务规则都收在这里，页面只负责渲染与收集输入。
// 规则要点：
// 1. 按所属管段把井编号圈成一整段，统一下养护措施与检查人；
// 2. 圈井时可按井盖状况过滤，但破损的井必须留在选中里，不许悄悄漏掉；
// 3. 井深超过阈值的井不随普通批办理，单独提出；
// 4. 同一口井一批只算一次，重复圈入按一次计；
// 5. 提交后逐口井给结果，失败的井保持原样，一个字段都不改；
// 6. 同一批井两人同时操作时，只按先提交的那批办；
// 7. 批后重算井体状态，结论落进待养护清单（状态=待养护、pending=true）。

export const MANHOLE_KEY = 'manhole'
/** 井深阈值（米）：超过即为超深井，须单独提方案。 */
export const DEEP_WELL_THRESHOLD_M = 5
/** 井盖状况里的破损关键字：命中即强制保留在选中内。 */
export const DAMAGED_COVER_KEYWORD = '破损'
/** 成批养护结论落入的状态：待养护清单 = 该状态的井。 */
export const PENDING_MAINTAIN_STATUS = '待养护'

const BATCH_LOG_STORAGE_KEY = 'drainage-pump:manhole-batches'
const BATCH_LOG_KEEP = 20

export type CircledWell = {
  id: number
  code: string
  cover: string
  depth: number | null
  status: string
  /** 被井盖状况过滤挡下、但因破损必须保留的井。 */
  keptByDamage: boolean
}

export type CirclePreview = {
  segment: string
  threshold: number
  /** 圈中的一整段井（按井编号排序、已去重、含破损保留），超深井不在其中。 */
  wells: CircledWell[]
  /** 井深超过阈值的井：单独提出，不随普通批办理。 */
  deepWells: CircledWell[]
  /** 重复圈入被去重的井编号（按一次算）。 */
  duplicatedCodes: string[]
}

export type BatchWellResult = {
  id: number
  code: string
  ok: boolean
  /** 失败原因；成功时为纳入批次的说明。 */
  reason: string
}

export type BatchSubmitResult = {
  batchNo: string
  total: number
  succeeded: number
  failed: number
  results: BatchWellResult[]
  /** 提交时被静默去重的井编号。 */
  duplicatedCodes: string[]
  message: string
}

export type BatchRecord = {
  batchNo: string
  at: string
  operator: string
  segment: string
  measure: string
  inspector: string
  total: number
  succeeded: number
  failed: number
}

export type PendingMaintainRow = {
  id: number
  code: string
  segment: string
  batchNo: string
  measure: string
  inspector: string
  date: string
}

function parseDepth(raw: unknown): number | null {
  const depth = Number.parseFloat(String(raw ?? '').trim())
  return Number.isFinite(depth) ? depth : null
}

function codeOf(row: EntryRow): string {
  return String(row['井编号'] ?? '').trim()
}

/** 井体状态重算：批量动作之后跟着重算，与井盖状况、井深保持一致。 */
export function computeWellBodyStatus(cover: string, depth: number | null): string {
  const parts: string[] = []
  if (cover.includes('破损')) parts.push('井盖破损')
  else if (cover.includes('缺失')) parts.push('井盖缺失')
  else if (cover.includes('松动')) parts.push('井盖松动')
  else if (cover.includes('锈蚀')) parts.push('井盖锈蚀')
  else parts.push('井体完好')
  if (depth !== null && depth > DEEP_WELL_THRESHOLD_M) parts.push('超深井')
  return parts.join('，')
}

/** 台账里出现过的所属管段，供圈井时选择。 */
export function listSegments(): string[] {
  const seen = new Set<string>()
  for (const row of listRows(MANHOLE_KEY)) {
    const segment = String(row['所属管段'] ?? '').trim()
    if (segment) seen.add(segment)
  }
  return [...seen].sort()
}

function toCircledWell(row: EntryRow, keptByDamage: boolean): CircledWell {
  return {
    id: Number(row.id),
    code: codeOf(row),
    cover: String(row['井盖状况'] ?? ''),
    depth: parseDepth(row['井深']),
    status: String(row.status ?? ''),
    keptByDamage,
  }
}

/**
 * 圈井：按所属管段把井编号圈成一整段。
 * - 按井编号排序，保证圈出来的是连续一整段；
 * - 同一口井（同井编号）只出现一次，重复登记按一次算；
 * - 井盖状况过滤只挡住普通井，破损井强制留在选中里并打标。
 */
export function circleSegmentWells(segment: string, coverFilter = ''): CirclePreview {
  const keyword = coverFilter.trim()
  const rows = listRows(MANHOLE_KEY)
    .filter((row) => String(row['所属管段'] ?? '').trim() === segment)
    .sort((a, b) => codeOf(a).localeCompare(codeOf(b)) || Number(a.id) - Number(b.id))

  const seen = new Set<string>()
  const wells: CircledWell[] = []
  const deepWells: CircledWell[] = []
  const duplicatedCodes: string[] = []

  for (const row of rows) {
    const code = codeOf(row)
    const dedupeKey = code || `id:${row.id}`
    if (seen.has(dedupeKey)) {
      if (!duplicatedCodes.includes(code)) duplicatedCodes.push(code)
      continue
    }
    seen.add(dedupeKey)

    const cover = String(row['井盖状况'] ?? '')
    const damaged = cover.includes(DAMAGED_COVER_KEYWORD)
    // 破损的井不许被过滤悄悄漏掉：不匹配过滤条件也要留下。
    const keptByDamage = keyword !== '' && !cover.includes(keyword) && damaged
    if (keyword !== '' && !cover.includes(keyword) && !damaged) continue

    const circled = toCircledWell(row, keptByDamage)
    if (circled.depth !== null && circled.depth > DEEP_WELL_THRESHOLD_M) {
      deepWells.push(circled)
    } else {
      wells.push(circled)
    }
  }

  return { segment, threshold: DEEP_WELL_THRESHOLD_M, wells, deepWells, duplicatedCodes }
}

function todayLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function readBatchLog(): BatchRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(BATCH_LOG_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as BatchRecord[]) : []
  } catch {
    return []
  }
}

function appendBatchLog(record: BatchRecord): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  const log = [record, ...readBatchLog()].slice(0, BATCH_LOG_KEEP)
  window.localStorage.setItem(BATCH_LOG_STORAGE_KEY, JSON.stringify(log))
}

export function recentBatches(): BatchRecord[] {
  return readBatchLog()
}

function nextBatchNo(today: string): string {
  const prefix = `BATCH-${today.replace(/-/g, '')}-`
  let maxSeq = 0
  const takeSeq = (batchNo: string) => {
    if (!batchNo.startsWith(prefix)) return
    const seq = Number.parseInt(batchNo.slice(prefix.length), 10)
    if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq
  }
  for (const row of listRows(MANHOLE_KEY)) takeSeq(String(row['养护批次'] ?? ''))
  for (const record of readBatchLog()) takeSeq(record.batchNo)
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`
}

export type BatchSubmitInput = {
  segment: string
  /** 圈中的井（含圈井时的井编号快照，结果里沿用原名目）。 */
  wells: { id: number; code: string }[]
  measure: string
  inspector: string
  operator: string
  /** 测试可注入；默认按当天日期生成。 */
  batchNo?: string
  today?: string
}

/**
 * 成批提交：逐口井办理，逐口井给结果。
 * 只写成功的井；失败的井一个字段都不动，名目保持圈井时的原样。
 * 提交前直读 localStorage 拿最新台账：同一批井若已被别人先提交的批次圈定
 * （状态已是待养护且挂着别的批次号），本批那几口按冲突失败处理——先到先办。
 */
export function submitBatchMaintenance(input: BatchSubmitInput): BatchSubmitResult {
  const today = input.today ?? todayLocal()
  const batchNo = input.batchNo ?? nextBatchNo(today)
  const rows = listRowsFresh(MANHOLE_KEY)

  const results: BatchWellResult[] = []
  const duplicatedCodes: string[] = []
  const seenIds = new Set<number>()
  const seenCodes = new Set<string>()
  const changed = new Map<number, EntryRow>()

  for (const item of input.wells) {
    const code = item.code.trim()
    // 同一口井一批只出现一次：重复圈入按一次算，后面直接跳过。
    if (seenIds.has(item.id) || (code && seenCodes.has(code))) {
      if (code && !duplicatedCodes.includes(code)) duplicatedCodes.push(code)
      continue
    }
    seenIds.add(item.id)
    if (code) seenCodes.add(code)

    const row = rows.find((entry) => Number(entry.id) === item.id)
    if (!row) {
      results.push({ id: item.id, code, ok: false, reason: '台账里找不到这口井，可能刚被调整过' })
      continue
    }
    if (String(row['所属管段'] ?? '').trim() !== input.segment) {
      results.push({ id: item.id, code, ok: false, reason: `已不在管段 ${input.segment} 上，按原样保留` })
      continue
    }
    const depth = parseDepth(row['井深'])
    if (depth !== null && depth > DEEP_WELL_THRESHOLD_M) {
      results.push({
        id: item.id,
        code,
        ok: false,
        reason: `井深 ${depth} 米超过阈值 ${DEEP_WELL_THRESHOLD_M} 米，超深井须单独提方案`,
      })
      continue
    }
    const status = String(row.status ?? '')
    if (status === PENDING_MAINTAIN_STATUS) {
      const holder = String(row['养护批次'] ?? '').trim()
      results.push({
        id: item.id,
        code,
        ok: false,
        reason: holder
          ? `已被先到的批次 ${holder} 圈定，同一批井只按先到的那批办`
          : '已在待养护清单中，不重复安排',
      })
      continue
    }
    if (status === '已养护') {
      results.push({ id: item.id, code, ok: false, reason: '已养护，无需重复安排' })
      continue
    }
    if (status === '需维修') {
      results.push({ id: item.id, code, ok: false, reason: '井体需维修，走维修流程，不随养护批办理' })
      continue
    }

    // 办理成功：统一下养护措施与检查人，结论落进待养护清单，井体状态跟着重算。
    const cover = String(row['井盖状况'] ?? '')
    changed.set(Number(row.id), {
      ...row,
      status: PENDING_MAINTAIN_STATUS,
      pending: true,
      abnormal: false,
      养护措施: input.measure,
      检查人: input.inspector,
      检查日期: today,
      养护批次: batchNo,
      井体状态: computeWellBodyStatus(cover, depth),
    })
    results.push({ id: item.id, code, ok: true, reason: `已纳入批次 ${batchNo}，落入待养护清单` })
  }

  if (changed.size > 0) {
    saveRows(MANHOLE_KEY, rows.map((row) => changed.get(Number(row.id)) ?? row))
  }

  const succeeded = results.filter((item) => item.ok).length
  const failed = results.length - succeeded
  appendBatchLog({
    batchNo,
    at: new Date().toISOString(),
    operator: input.operator,
    segment: input.segment,
    measure: input.measure,
    inspector: input.inspector,
    total: results.length,
    succeeded,
    failed,
  })

  const message =
    failed === 0
      ? `批次 ${batchNo} 办成 ${succeeded} 口，结论已落入待养护清单`
      : `批次 ${batchNo} 成功 ${succeeded} 口、未成 ${failed} 口，未成的井保持原样未动`
  return {
    batchNo,
    total: results.length,
    succeeded,
    failed,
    results,
    duplicatedCodes,
    message,
  }
}

/** 待养护清单：成批养护的结论都落在这里。 */
export function listPendingMaintenance(): PendingMaintainRow[] {
  return listRows(MANHOLE_KEY)
    .filter((row) => String(row.status) === PENDING_MAINTAIN_STATUS)
    .map((row) => ({
      id: Number(row.id),
      code: codeOf(row),
      segment: String(row['所属管段'] ?? ''),
      batchNo: String(row['养护批次'] ?? ''),
      measure: String(row['养护措施'] ?? ''),
      inspector: String(row['检查人'] ?? ''),
      date: String(row['检查日期'] ?? ''),
    }))
    .sort((a, b) => a.batchNo.localeCompare(b.batchNo) || a.code.localeCompare(b.code))
}
