<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>检查井维护管理</h2>
        <p class="page-desc">维护检查井，围绕井编号、所属管段、井盖状况、井深做登记、筛选与状态流转，支持按管段成批安排养护。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openBatch">成批养护安排</button>
        <button class="btn" type="button" @click="openCreate">登记检查井</button>
        <button class="btn" type="button" @click="exportRows">导出检查井维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <section class="pending-panel">
      <header class="pending-head">
        <h3>待养护清单</h3>
        <span class="pending-desc">成批养护的结论落在这里，共 {{ pendingList.length }} 口，按批次与井编号排列</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>井编号</th>
            <th>所属管段</th>
            <th>养护批次</th>
            <th>养护措施</th>
            <th>检查人</th>
            <th>安排日期</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in pendingList" :key="item.id">
            <td>{{ item.code }}</td>
            <td>{{ item.segment }}</td>
            <td>{{ item.batchNo || '—' }}</td>
            <td>{{ item.measure || '—' }}</td>
            <td>{{ item.inspector || '—' }}</td>
            <td>{{ item.date || '—' }}</td>
          </tr>
          <tr v-if="!pendingList.length">
            <td colspan="6" class="empty-state">待养护清单为空，可用「成批养护安排」按管段圈井办理</td>
          </tr>
        </tbody>
      </table>
      <p v-if="batches.length" class="batch-log">
        最近批次：
        <span v-for="batch in batches" :key="batch.batchNo" class="legend-item">
          {{ batch.batchNo }}（{{ batch.operator }}，成 {{ batch.succeeded }}/{{ batch.total }} 口）
        </span>
      </p>
    </section>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无检查井维护数据，可先登记检查井</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条检查井维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="batchOpen" class="modal-mask" @click.self="closeBatch">
      <div class="modal">
        <header class="modal-head">
          <h3>成批养护安排</h3>
          <button class="link" type="button" @click="closeBatch">关闭</button>
        </header>

        <div v-if="!batchResult" class="modal-body">
          <div class="batch-form">
            <label class="filter-item">
              <span>所属管段</span>
              <select v-model="batchSegment">
                <option value="" disabled>选择要圈井的管段</option>
                <option v-for="segment in segments" :key="segment" :value="segment">{{ segment }}</option>
              </select>
            </label>
            <label class="filter-item">
              <span>井盖状况过滤</span>
              <input v-model="coverFilter" placeholder="如：完好；破损的井始终留在选中里" />
            </label>
            <button class="btn" type="button" @click="doCircle">圈井</button>
          </div>
          <p class="batch-hint">按井编号把整段管段圈成一批；井深超过 {{ deepThreshold }} 米的井单独提出，不随普通批办理。</p>

          <template v-if="preview">
            <p class="batch-summary">
              本批圈定 {{ preview.wells.length }} 口
              <template v-if="preview.deepWells.length"> · 超深单独提出 {{ preview.deepWells.length }} 口</template>
              <template v-if="keptDamagedCount"> · 破损保留 {{ keptDamagedCount }} 口</template>
              <template v-if="preview.duplicatedCodes.length">
                · 重复圈入按一次算：{{ preview.duplicatedCodes.join('、') }}
              </template>
            </p>

            <table class="data-table">
              <thead>
                <tr>
                  <th>井编号</th>
                  <th>井盖状况</th>
                  <th>井深（米）</th>
                  <th>当前状态</th>
                  <th>标记</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="well in preview.wells" :key="well.id">
                  <td>{{ well.code }}</td>
                  <td>{{ well.cover || '—' }}</td>
                  <td>{{ well.depth ?? '—' }}</td>
                  <td>{{ well.status }}</td>
                  <td><span v-if="well.keptByDamage" class="tag warn">破损保留</span></td>
                </tr>
                <tr v-if="!preview.wells.length">
                  <td colspan="5" class="empty-state">这段管段上没有可成批办理的井</td>
                </tr>
              </tbody>
            </table>

            <template v-if="preview.deepWells.length">
              <h4 class="deep-title">超深井（单独提出，不随本批办理）</h4>
              <table class="data-table">
                <thead>
                  <tr>
                    <th>井编号</th>
                    <th>井盖状况</th>
                    <th>井深（米）</th>
                    <th>当前状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="well in preview.deepWells" :key="well.id">
                    <td>{{ well.code }}</td>
                    <td>{{ well.cover || '—' }}</td>
                    <td>{{ well.depth ?? '—' }}</td>
                    <td>{{ well.status }}</td>
                  </tr>
                </tbody>
              </table>
            </template>

            <div class="batch-form">
              <label class="filter-item">
                <span>养护措施（统一）</span>
                <select v-model="measure">
                  <option value="" disabled>选择养护措施</option>
                  <option v-for="option in measureOptions" :key="option" :value="option">{{ option }}</option>
                </select>
              </label>
              <label class="filter-item">
                <span>检查人（统一）</span>
                <input v-model="inspector" placeholder="本批井统一的检查人" />
              </label>
              <button
                class="btn primary"
                type="button"
                :disabled="!preview.wells.length"
                @click="submitBatch"
              >
                提交成批养护（{{ preview.wells.length }} 口）
              </button>
            </div>
          </template>
        </div>

        <div v-else class="modal-body">
          <p class="batch-summary">
            批次 {{ batchResult.batchNo }}：成功 {{ batchResult.succeeded }} 口、未成 {{ batchResult.failed }} 口
          </p>
          <p class="batch-hint">{{ batchResult.message }}</p>
          <table class="data-table">
            <thead>
              <tr>
                <th>井编号</th>
                <th>结果</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in batchResult.results" :key="item.id">
                <td>{{ item.code || '—' }}</td>
                <td>
                  <span class="tag" :class="item.ok ? 'ok' : 'fail'">{{ item.ok ? '成功' : '未成' }}</span>
                </td>
                <td>{{ item.reason }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="batchResult.duplicatedCodes.length" class="batch-hint">
            重复圈入按一次算：{{ batchResult.duplicatedCodes.join('、') }}
          </p>
          <div class="modal-foot">
            <button class="btn" type="button" @click="backToCircle">继续下一批</button>
            <button class="btn primary" type="button" @click="closeBatch">完成</button>
          </div>
        </div>

        <p v-if="dialogError" class="error-text modal-error">{{ dialogError }}</p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  DEEP_WELL_THRESHOLD_M,
  circleSegmentWells,
  listPendingMaintenance,
  listSegments,
  recentBatches,
  submitBatchMaintenance,
} from '@/api/manhole-batch'
import type {
  BatchRecord,
  BatchSubmitResult,
  CirclePreview,
  PendingMaintainRow,
} from '@/api/manhole-batch'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('manhole')
const columns = ["井编号", "所属管段", "井盖状况", "井深", "检查人", "检查日期", "养护措施", "养护批次", "井体状态"]
const actions = ["提交检查", "确认养护", "提出维修"]
const statuses = ["待检查", "待养护", "检查中", "需维修", "已养护"]
const measureOptions = ["清掏淤积", "井盖更换", "井壁勾缝修补", "防坠网补装", "冲洗疏通"]
const deepThreshold = DEEP_WELL_THRESHOLD_M

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() =>
  statuses
    .filter((status) => status !== '检查中')
    .map((status) => ({
      label: `${status}检查井`,
      value: rows.value.filter((row) => String(row.status) === status).length,
    })),
)

const segments = ref<string[]>([])
const pendingList = ref<PendingMaintainRow[]>([])
const batches = ref<BatchRecord[]>([])

const batchOpen = ref(false)
const batchSegment = ref('')
const coverFilter = ref('')
const measure = ref('')
const inspector = ref('')
const preview = ref<CirclePreview | null>(null)
const batchResult = ref<BatchSubmitResult | null>(null)
const dialogError = ref('')
const keptDamagedCount = computed(
  () => preview.value?.wells.filter((well) => well.keptByDamage).length ?? 0,
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '检查井登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openBatch() {
  batchSegment.value = ''
  coverFilter.value = ''
  measure.value = ''
  inspector.value = ''
  preview.value = null
  batchResult.value = null
  dialogError.value = ''
  batchOpen.value = true
}

function closeBatch() {
  batchOpen.value = false
  preview.value = null
  batchResult.value = null
  dialogError.value = ''
}

function doCircle() {
  dialogError.value = ''
  if (!batchSegment.value) {
    dialogError.value = '先选择要圈井的所属管段'
    return
  }
  preview.value = circleSegmentWells(batchSegment.value, coverFilter.value)
  batchResult.value = null
}

function submitBatch() {
  dialogError.value = ''
  if (!preview.value) {
    dialogError.value = '先圈井再提交'
    return
  }
  if (!measure.value) {
    dialogError.value = '给这批井统一选一个养护措施'
    return
  }
  if (!inspector.value.trim()) {
    dialogError.value = '给这批井统一填一个检查人'
    return
  }
  batchResult.value = submitBatchMaintenance({
    segment: batchSegment.value,
    wells: preview.value.wells.map((well) => ({ id: well.id, code: well.code })),
    measure: measure.value,
    inspector: inspector.value.trim(),
    operator: session.operator,
  })
  reload()
}

function backToCircle() {
  batchResult.value = null
  preview.value = null
  dialogError.value = ''
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    segments.value = listSegments()
    pendingList.value = listPendingMaintenance()
    batches.value = recentBatches().slice(0, 5)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '检查井维护列表读取失败'
  }
}

onMounted(reload)
</script>
