<template>
  <section class="page" data-module="manhole">
    <header class="page-head">
      <div>
        <h2>检查井维护管理</h2>
        <p class="page-desc">维护检查井，围绕井编号、所属管段、井盖状况、井深做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="toggleBatch">成批安排养护</button>
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

    <section v-if="batchOpen" class="batch-panel">
      <h3>成批安排养护</h3>
      <div class="batch-form">
        <label class="filter-item">
          <span>所属管段</span>
          <select v-model="batchSegment">
            <option v-for="segment in segments" :key="segment" :value="segment">{{ segment }}</option>
          </select>
        </label>
        <div class="filter-item">
          <span>井盖状况过滤（破损必检，不可排除）</span>
          <div class="cover-checks">
            <label v-for="cover in segmentCovers" :key="cover">
              <input
                type="checkbox"
                :value="cover"
                v-model="includedCovers"
                :disabled="isDamagedCover(cover)"
              />
              {{ cover }}
              <em v-if="isDamagedCover(cover)">必检</em>
            </label>
          </div>
        </div>
        <label class="filter-item">
          <span>养护措施</span>
          <input v-model="batchMeasure" list="manhole-measures" placeholder="统一养护措施" />
          <datalist id="manhole-measures">
            <option v-for="option in measureOptions" :key="option" :value="option" />
          </datalist>
        </label>
        <label class="filter-item">
          <span>检查人</span>
          <input v-model="batchInspector" placeholder="统一检查人" />
        </label>
        <button
          class="btn primary"
          type="button"
          :disabled="!batchPreview.candidates.length"
          @click="submitBatch"
        >
          提交成批养护（{{ batchPreview.candidates.length }} 口）
        </button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>井编号</th>
            <th>井盖状况</th>
            <th>井深</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in batchPreview.candidates" :key="String(row.id)">
            <td>{{ row['井编号'] }}</td>
            <td>{{ row['井盖状况'] }}</td>
            <td>{{ row['井深'] }}</td>
            <td>{{ row.status }}</td>
          </tr>
          <tr v-if="!batchPreview.candidates.length">
            <td colspan="4" class="empty-state">该管段没有符合过滤条件的可办井</td>
          </tr>
        </tbody>
      </table>

      <template v-if="batchPreview.deepWells.length">
        <p class="deep-note">
          以下 {{ batchPreview.deepWells.length }} 口井井深超过 {{ MANHOLE_DEPTH_LIMIT }} 米，不随普通井一起办，单独提出：
        </p>
        <table class="data-table">
          <thead>
            <tr>
              <th>井编号</th>
              <th>井盖状况</th>
              <th>井深</th>
              <th>当前状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in batchPreview.deepWells" :key="String(row.id)">
              <td>{{ row['井编号'] }}</td>
              <td>{{ row['井盖状况'] }}</td>
              <td>{{ row['井深'] }}</td>
              <td>{{ row.status }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <div v-if="batchResult" class="batch-result">
        <p>{{ batchResult.message }}</p>
        <p v-if="batchResult.succeeded.length" class="result-ok">
          成功 {{ batchResult.succeeded.length }} 口：{{ succeededSummary }}
        </p>
        <template v-if="batchResult.failed.length">
          <p class="result-fail">没成 {{ batchResult.failed.length }} 口：</p>
          <ul>
            <li v-for="item in batchResult.failed" :key="item.id" class="result-fail">
              {{ item.wellNo }}：{{ item.reason }}
            </li>
          </ul>
        </template>
        <template v-if="batchResult.deepWells.length">
          <p class="result-deep">深井单独提出 {{ batchResult.deepWells.length }} 口：</p>
          <ul>
            <li v-for="item in batchResult.deepWells" :key="item.id" class="result-deep">
              {{ item.wellNo }}（井深 {{ item.depth }} 米）需单独办理
            </li>
          </ul>
        </template>
      </div>
      <p v-if="batchError" class="error-text">{{ batchError }}</p>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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

    <section class="pending-panel">
      <h3>待养护清单</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>井编号</th>
            <th>所属管段</th>
            <th>养护措施</th>
            <th>检查人</th>
            <th>检查日期</th>
            <th>井体状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in pendingWells" :key="String(row.id)">
            <td>{{ row['井编号'] }}</td>
            <td>{{ row['所属管段'] }}</td>
            <td>{{ row['养护措施'] }}</td>
            <td>{{ row['检查人'] }}</td>
            <td>{{ row['检查日期'] }}</td>
            <td>{{ row['井体状态'] }}</td>
          </tr>
          <tr v-if="!pendingWells.length">
            <td colspan="6" class="empty-state">暂无待养护的检查井，可通过成批安排养护加入</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条检查井维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  MANHOLE_DEPTH_LIMIT,
  isDamagedCover,
  previewManholeBatch,
  scheduleManholeBatch,
} from '@/api/manhole-batch'
import type { ManholeBatchResult } from '@/api/manhole-batch'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('manhole')
const columns = ["井编号", "所属管段", "井盖状况", "井深", "检查人", "检查日期", "养护措施", "井体状态"]
const actions = ["提交检查", "确认养护", "提出维修"]
const statuses = ["待检查", "待养护", "检查中", "已养护", "需维修"]
const stats = [{"label": "待检查检查井", "value": 0}, {"label": "待养护检查井", "value": 0}, {"label": "已养护检查井", "value": 0}, {"label": "需维修检查井", "value": 0}]

const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const allWells = ref<EntryRow[]>([])
const pendingWells = ref<EntryRow[]>([])
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

// 成批安排养护：先按管段把井圈成一整段，再统一定养护措施与检查人。
const batchOpen = ref(false)
const batchSegment = ref('')
const includedCovers = ref<string[]>([])
const batchMeasure = ref('')
const batchInspector = ref(session.operator)
const batchResult = ref<ManholeBatchResult | null>(null)
const batchError = ref('')
const measureOptions = ['清掏井室', '井盖更换', '井壁修补', '防坠网更换', '井圈加固']

const segments = computed(() => [
  ...new Set(allWells.value.map((row) => String(row['所属管段'] ?? '')).filter(Boolean)),
])
const segmentCovers = computed(() => [
  ...new Set(
    allWells.value
      .filter((row) => String(row['所属管段'] ?? '') === batchSegment.value)
      .map((row) => String(row['井盖状况'] ?? ''))
      .filter(Boolean),
  ),
])
const batchPreview = computed(() =>
  batchSegment.value
    ? previewManholeBatch(allWells.value, batchSegment.value, includedCovers.value)
    : { candidates: [], deepWells: [] },
)
const succeededSummary = computed(() =>
  (batchResult.value?.succeeded ?? []).map((item) => item.wellNo).join('、'),
)

watch(batchSegment, () => {
  // 换管段时默认全选该管段的井盖状况；破损项锁定勾选，不许悄悄漏掉。
  includedCovers.value = [...segmentCovers.value]
  batchResult.value = null
  batchError.value = ''
})

function toggleBatch() {
  batchOpen.value = !batchOpen.value
  if (batchOpen.value && !batchSegment.value && segments.value.length > 0) {
    batchSegment.value = segments.value[0]
  }
}

function submitBatch() {
  batchError.value = ''
  batchResult.value = null
  const result = scheduleManholeBatch({
    wellIds: batchPreview.value.candidates.map((row) => Number(row.id)),
    measure: batchMeasure.value,
    inspector: batchInspector.value,
    operator: session.operator,
  })
  if (!result.ok) {
    batchError.value = result.message
    return
  }
  batchResult.value = result
  reload()
}

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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    allWells.value = listEntries(meta.key).items
    // 成批养护的结论落在待养护清单里，跟随每次刷新重算。
    pendingWells.value = allWells.value.filter((row) => String(row.status) === '待养护')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '检查井维护列表读取失败'
  }
}

onMounted(reload)
</script>
