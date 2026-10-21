import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const pkg = JSON.parse(await read('package.json'))
const failures = []
const requireText = (condition, message) => { if (!condition) failures.push(message) }

const [client, store, changelog, workspace, license] = await Promise.all([
  read('lib/client.js'), read('lib/store.js'), read('CHANGELOG.md'), read('pnpm-workspace.yaml'), read('LICENSE'),
])

requireText(pkg.private === true, 'package.json must remain private for GitHub-only distribution')
requireText(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(pkg.version), 'release version must be a semantic version')
requireText(pkg.repository?.url === 'git+https://github.com/elviass/dsh-cost-insights.git', 'repository URL mismatch')
const dshRange = pkg.dshhub?.compatibility?.dsh
requireText(typeof dshRange === 'string' && dshRange.trim() !== '', 'DSH compatibility range is missing')
requireText(pkg.engines?.dsh === dshRange, 'engines.dsh must match the dshhub DSH compatibility range')
requireText(pkg.peerDependencies?.['@deepseek-ai/dsh'] === dshRange, 'DSH peer range must match the dshhub compatibility range')
requireText(pkg.engines?.node === pkg.dshhub?.compatibility?.node, 'Node engine range must match the dshhub compatibility range')
requireText(new Set(pkg.dsh?.client?.inject || []).size === (pkg.dsh?.client?.inject || []).length, 'dsh.client.inject must not contain duplicates')
requireText(client.includes(`const PLUGIN_VERSION = '${pkg.version}'`), 'client version does not match package.json')
requireText(store.includes(`version: '${pkg.version}'`), 'diagnostic version does not match package.json')
requireText(changelog.includes(`## ${pkg.version} - `), 'CHANGELOG lacks the release version')
requireText(license.includes('Copyright (c) 2026 elviass'), 'LICENSE copyright holder mismatch')
requireText(!workspace.includes('set this to true or false'), 'pnpm build policy still contains placeholders')
requireText(!Object.keys(pkg.scripts || {}).some(name => /publish/i.test(name)), 'npm publish script is forbidden')

const productionFiles = ['lib', 'scripts', '.github']
const secretPatterns = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
]
async function walk(path) {
  const entries = await readdir(new URL(`${path}/`, root), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relative = join(path, entry.name).replaceAll('\\', '/')
    if (entry.isDirectory()) files.push(...await walk(relative))
    else files.push(relative)
  }
  return files
}
for (const directory of productionFiles) {
  for (const file of await walk(directory)) {
    const content = await read(file)
    requireText(!/[A-Za-z]:[\\/]Users[\\/]/i.test(content), `${file} contains a machine-specific user path`)
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0
      requireText(!pattern.test(content), `${file} contains a credential-like value`)
    }
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`release-check: ${failure}`)
  process.exit(1)
}
console.log('Release metadata, version consistency, portability, and secret checks passed.')
