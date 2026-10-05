// 成批养护安排的规则冒烟测试：不依赖浏览器，用内存 localStorage 模拟。
// 运行：npm run smoke:manhole
const store = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
}

const {
  DEEP_WELL_THRESHOLD_M,
  circleSegmentWells,
  computeWellBodyStatus,
  listPendingMaintenance,
  recentBatches,
  submitBatchMaintenance,
} = await import('@/api/manhole-batch')
const { listRows } = await import('@/data/local-store')

let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ok  ${name}`)
  } else {
    failed += 1
    console.error(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

const rowByCode = (code: string) =>
  listRows('manhole').find((row) => String(row['井编号']) === code)

// ---- 1. 圈井：按管段圈成一整段，按井编号排序，重复登记只算一次，超深单独提出
const circle1 = circleSegmentWells('DRAI-0001')
check('整段圈井按井编号排序', circle1.wells.map((w) => w.code).join(',') ===
  'MANH-0001,MANH-0002,MANH-0003,MANH-0004,MANH-0005,MANH-0007,MANH-0008,MANH-0009')
check('重复登记的井只圈一次', circle1.duplicatedCodes.includes('MANH-0007') &&
  circle1.wells.filter((w) => w.code === 'MANH-0007').length === 1)
check('超深井单独提出不随批', circle1.deepWells.length === 1 &&
  circle1.deepWells[0].code === 'MANH-0006' &&
  !circle1.wells.some((w) => w.code === 'MANH-0006'))

// ---- 2. 井盖状况过滤：破损的井必须留在选中里
const circle2 = circleSegmentWells('DRAI-0001', '完好')
const kept = circle2.wells.filter((w) => w.keptByDamage).map((w) => w.code)
check('过滤时破损井保留', kept.join(',') === 'MANH-0003,MANH-0009', kept.join(','))
check('普通井按过滤条件放行', !circle2.wells.some((w) => w.code === 'MANH-0005'))

// ---- 3. 成批提交：逐口给结果，结论落待养护清单，井体状态重算
const batch1 = submitBatchMaintenance({
  segment: 'DRAI-0001',
  wells: circle1.wells.map((w) => ({ id: w.id, code: w.code })),
  measure: '清掏淤积',
  inspector: '周检查',
  operator: '值班管理员',
  today: '2026-10-05',
})
check('逐口结果：成功 7 口', batch1.succeeded === 7, `实得 ${batch1.succeeded}`)
check('逐口结果：未成 1 口（已养护）', batch1.failed === 1 &&
  batch1.results.find((r) => r.code === 'MANH-0008')?.ok === false)
check('批次号生成', batch1.batchNo === 'BATCH-20261005-001', batch1.batchNo)
const manh3 = rowByCode('MANH-0003')!
check('成功的井落入待养护清单', String(manh3.status) === '待养护' && manh3.pending === true &&
  String(manh3['养护批次']) === 'BATCH-20261005-001' &&
  String(manh3['养护措施']) === '清掏淤积' && String(manh3['检查人']) === '周检查')
check('批后井体状态重算（破损）', String(manh3['井体状态']) === '井盖破损')
check('批后井体状态重算（完好）', String(rowByCode('MANH-0001')!['井体状态']) === '井体完好')
const manh8 = rowByCode('MANH-0008')!
check('未成的井名目原样未动', String(manh8.status) === '已养护' &&
  String(manh8['养护批次']) === 'BATCH-20260920-001' && String(manh8['检查人']) === '李养护')
check('待养护清单可查', listPendingMaintenance().length === 7 &&
  !listPendingMaintenance().some((item) => item.code === 'MANH-0008'))

// ---- 4. 两人同时圈同一批井：只按先到的那批办
const circleAgain = circleSegmentWells('DRAI-0001')
const batch2 = submitBatchMaintenance({
  segment: 'DRAI-0001',
  wells: circleAgain.wells.map((w) => ({ id: w.id, code: w.code })),
  measure: '井盖更换',
  inspector: '吴复查',
  operator: '另一位值班员',
  today: '2026-10-05',
})
check('后到的批次一口也办不成', batch2.succeeded === 0 && batch2.failed === 8)
check('冲突原因指名先到的批次', batch2.results.every((r) =>
  r.ok || r.reason.includes('BATCH-20261005-001') || r.reason.includes('已养护')))
check('先到批次的数据没被覆盖', String(rowByCode('MANH-0003')!['养护批次']) === 'BATCH-20261005-001' &&
  String(rowByCode('MANH-0003')!['养护措施']) === '清掏淤积')

// ---- 5. 超深井不许当普通井办
const deep = submitBatchMaintenance({
  segment: 'DRAI-0001',
  wells: [{ id: 6, code: 'MANH-0006' }],
  measure: '清掏淤积',
  inspector: '周检查',
  operator: '值班管理员',
  today: '2026-10-05',
})
check('超深井提交被拒并说明阈值', deep.failed === 1 &&
  deep.results[0].reason.includes(`${DEEP_WELL_THRESHOLD_M} 米`))
check('超深井保持原样', String(rowByCode('MANH-0006')!.status) === '待检查')

// ---- 6. 同一口井一批只出现一次
const circle3 = circleSegmentWells('DRAI-0003')
const wells3 = circle3.wells.map((w) => ({ id: w.id, code: w.code }))
const first = wells3[0]
const batch3 = submitBatchMaintenance({
  segment: 'DRAI-0003',
  wells: [first, { ...first }, ...wells3.slice(1)],
  measure: '冲洗疏通',
  inspector: '周检查',
  operator: '值班管理员',
  today: '2026-10-05',
})
check('重复圈入按一次算', batch3.results.filter((r) => r.code === first.code).length === 1 &&
  batch3.duplicatedCodes.includes(first.code))
check('已养护的井不重复安排', batch3.results.find((r) => r.code === 'MANH-0019')?.ok === false)

// ---- 6b. 需维修的井走维修流程，不随养护批办理
const circle4 = circleSegmentWells('DRAI-0002')
const batch4 = submitBatchMaintenance({
  segment: 'DRAI-0002',
  wells: circle4.wells.map((w) => ({ id: w.id, code: w.code })),
  measure: '清掏淤积',
  inspector: '周检查',
  operator: '值班管理员',
  today: '2026-10-05',
})
check('需维修的井不随养护批', batch4.results.find((r) => r.code === 'MANH-0013')?.ok === false &&
  (batch4.results.find((r) => r.code === 'MANH-0013')?.reason ?? '').includes('需维修'))
check('超深井在圈井时已分离', circle4.deepWells.map((w) => w.code).join(',') === 'MANH-0014')

// ---- 7. 井体状态重算规则
check('井体状态重算规则', computeWellBodyStatus('完好', 5.6) === '井体完好，超深井' &&
  computeWellBodyStatus('破损', 3.5) === '井盖破损' &&
  computeWellBodyStatus('缺失', null) === '井盖缺失')

// ---- 8. 批次留痕
check('批次留痕可查', recentBatches().length >= 4 &&
  recentBatches()[0].batchNo === batch4.batchNo)

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
