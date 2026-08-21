import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const filename = `${pkg.name}-${pkg.version}.tgz`
const archive = process.argv[2] ? join(root, process.argv[2]) : join(root, 'release', filename)
const listing = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' }).replace(/\r/g, '').trim().split('\n')
const forbidden = listing.filter(path => /(?:^|\/)(?:test|scripts|\.github|node_modules|release|\.dsh-home)(?:\/|$)|\.(?:sqlite|tgz|png|zstd)$|credentials/i.test(path))
const required = ['package/package.json', 'package/cordis.patch.yml', 'package/lib/index.js', 'package/lib/client.js', 'package/LICENSE', 'package/README.md', 'package/README.zh.md', 'package/SECURITY.md']
const missing = required.filter(path => !listing.includes(path))
if (forbidden.length || missing.length) {
  forbidden.forEach(path => console.error(`forbidden package path: ${path}`))
  missing.forEach(path => console.error(`missing package path: ${path}`))
  process.exit(1)
}
const extracted = await mkdtemp(join(tmpdir(), 'dsh-usage-package-verify-'))
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
try {
  execFileSync('tar', ['-xf', archive, '-C', extracted])
  for (const path of listing.filter(path => !path.endsWith('/'))) {
    const relativePath = path.replace(/^package\//, '')
    const [source, packed] = await Promise.all([readFile(join(root, relativePath)), readFile(join(extracted, path))])
    if (relativePath === 'package.json') {
      const sourceManifest = JSON.parse(source), packedManifest = JSON.parse(packed)
      delete sourceManifest.packageManager
      if (JSON.stringify(canonical(sourceManifest)) !== JSON.stringify(canonical(packedManifest))) throw new Error('packed package.json differs semantically from source')
    } else if (!source.equals(packed)) throw new Error(`packed file differs from source: ${relativePath}`)
  }
} finally {
  await rm(extracted, { recursive: true, force: true })
}
const bytes = await readFile(archive)
const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase()
const checksums = await readFile(join(dirname(archive), 'SHA256SUMS.txt'), 'utf8')
if (!checksums.includes(`${hash}  ${filename}`)) throw new Error('SHA256SUMS.txt does not match the archive')
const sbomPath = join(dirname(archive), `${pkg.name}-${pkg.version}.spdx.json`)
const sbom = JSON.parse(await readFile(sbomPath, 'utf8'))
if (sbom.spdxVersion !== 'SPDX-2.3' || !sbom.documentDescribes?.length || !sbom.packages?.length) throw new Error('release SPDX SBOM is missing or incomplete')
console.log(`Verified ${listing.length} package files and SHA-256 ${hash}.`)
