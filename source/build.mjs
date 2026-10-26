import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const sourceDir = path.join(root, 'source-app')
const outputDir = path.join(root, 'dist', 'client')
const distDir = path.join(root, 'dist')
const mainDocument = '方片招聘网站界面.html'
const wordmarkAsset = './assets/fangpian-wordmark.png'

function externalizeEmbeddedWordmark(html) {
  return html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, wordmarkAsset)
}

export async function buildStaticSite({ quiet = false } = {}) {
  // This app has no package dependencies, so pnpm does not create this directory.
  // The production image copies it unconditionally after running this build.
  await mkdir(path.join(root, 'node_modules'), { recursive: true })
  await rm(distDir, { recursive: true, force: true })
  await mkdir(distDir, { recursive: true })
  await writeFile(path.join(distDir, 'package.json'), '{"type":"commonjs"}\n')
  await cp(path.join(sourceDir, 'company-calendar.js'), path.join(distDir, 'company-calendar.js'))
  await mkdir(path.join(distDir, 'modules', 'background-checks'), { recursive: true })
  await cp('server/modules/background-checks/gdbf-des.cjs', path.join(distDir, 'modules', 'background-checks', 'gdbf-des.cjs'))
  await mkdir(outputDir, { recursive: true })
  await cp(sourceDir, outputDir, { recursive: true, force: true, filter: source => path.relative(sourceDir, source) !== 'vue' })

  await esbuild.build({
    entryPoints: [
      path.join(sourceDir, 'vue', 'api-documentation.js'),
      path.join(sourceDir, 'vue', 'points-ranking.js'),
      path.join(sourceDir, 'vue', 'scheduled-tasks.js'),
      path.join(sourceDir, 'vue', 'analytics.js'),
      path.join(sourceDir, 'vue', 'referral-overview.js'),
      path.join(sourceDir, 'vue', 'question-bank.js'),
      path.join(sourceDir, 'vue', 'overview.js'),
      path.join(sourceDir, 'vue', 'job-dialog.js'),
    ],
    outdir: path.join(outputDir, 'vue'),
    bundle: true,
    format: 'iife',
    target: ['es2018'],
    loader: { '.js': 'jsx' },
    jsx: 'transform',
    jsxFactory: 'h',
    minify: true,
  })

  await mkdir(path.join(outputDir, 'assets'), { recursive: true })
  await mkdir(path.join(outputDir, 'assets', 'fonts'), { recursive: true })
  await cp(
    path.join(sourceDir, 'fangpian-wordmark.png'),
    path.join(outputDir, 'assets', 'fangpian-wordmark.png'),
  )
  const importedHtml = await readFile(path.join(sourceDir, mainDocument), 'utf8')
  const runtimeHtml = externalizeEmbeddedWordmark(importedHtml)
  await writeFile(path.join(outputDir, mainDocument), runtimeHtml)
  await writeFile(path.join(outputDir, 'index.html'), runtimeHtml)

  if (!quiet) {
    console.log(`Built restored application into ${path.relative(root, outputDir)}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildStaticSite()
}
