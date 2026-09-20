import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const release = join(root, 'release')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `${pkg.name}-${pkg.version}.tgz`
const pnpmCli = process.env.npm_execpath
if (!pnpmCli) throw new Error('Run this script through pnpm run release:build')
// Modern pnpm installations may expose npm_execpath as a standalone native
// executable rather than a JavaScript entry point. Execute the package manager
// directly so both forms keep working through their shebang/binary launcher.
const pnpm = (args, options = {}) => execFileSync(pnpmCli, args, { cwd: root, ...options })

await rm(release, { recursive: true, force: true })
await mkdir(release, { recursive: true })
pnpm(['pack', '--pack-destination', release], { stdio: 'inherit' })
const bytes = await readFile(join(release, filename))
const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase()

const dependencyTree = JSON.parse(pnpm(['list', '--prod', '--json', '--depth', '0'], { encoding: 'utf8' }))[0]
const packages = new Map()
const relationships = new Map()
const spdxId = value => `SPDXRef-Package-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
const rootId = spdxId(`${pkg.name}@${pkg.version}`)

function collect(parentId, dependencies = {}) {
  for (const [name, item] of Object.entries(dependencies)) {
    const id = spdxId(`${name}@${item.version}`)
    if (!packages.has(id)) packages.set(id, {
      SPDXID: id,
      name,
      versionInfo: item.version,
      downloadLocation: item.resolved || 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
      externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl', referenceLocator: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(item.version)}` }],
    })
    relationships.set(`${parentId}|${id}`, { spdxElementId: parentId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: id })
  }
}

const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})])
collect(rootId, Object.fromEntries(Object.entries(dependencyTree.dependencies || {}).filter(([name]) => declared.has(name))))
const namespaceHash = createHash('sha256').update(`${hash}:${[...packages.keys()].sort().join(',')}`).digest('hex')
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `${pkg.name}-${pkg.version}`,
  documentNamespace: `https://github.com/elviass/dsh-cost-insights/sbom/${namespaceHash}`,
  creationInfo: { created: new Date().toISOString(), creators: ['Tool: dsh-cost-insights-build-release'] },
  documentDescribes: [rootId],
  packages: [{ SPDXID: rootId, name: pkg.name, versionInfo: pkg.version, downloadLocation: 'NOASSERTION', filesAnalyzed: false, licenseConcluded: pkg.license || 'NOASSERTION', licenseDeclared: pkg.license || 'NOASSERTION', copyrightText: 'Copyright (c) 2026 elviass' }, ...packages.values()],
  relationships: [...relationships.values()],
}
await writeFile(join(release, `${pkg.name}-${pkg.version}.spdx.json`), `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')

console.log(`Release candidate: ${join(release, filename)}`)
console.log(`SHA-256: ${hash}`)
