// 冒烟测试运行器：用 esbuild 的 JS API 打包 TS 冒烟脚本（自动匹配当前平台的二进制），再用 node 执行。
// 这样 Windows/macOS/Linux 都能跑，不依赖 .bin 下的平台二进制。
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { buildSync } from 'esbuild'

const outfile = 'node_modules/.cache/smoke-manhole-batch.mjs'
mkdirSync('node_modules/.cache', { recursive: true })
buildSync({
  entryPoints: ['scripts/smoke-manhole-batch.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: { '@': './src' },
  outfile,
  logLevel: 'warning',
})
execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
