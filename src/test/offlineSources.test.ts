import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const runtimeExtensions = new Set(['.css', '.html', '.js', '.jsx', '.ts', '.tsx', '.vue'])
const sourceRoot = process.cwd()
const ignoredExtensions = new Set(['.md', '.map', '.lock'])
const runtimePatterns = [
  /<(?:img|video|audio|source)\b[^>]+\b(?:src|poster)=["'](?:https?:|\/\/)/i,
  /\b(?:href|src)=["'](?:https?:|\/\/)/i,
  /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/,
  /url\(\s*["']?(?:https?:|\/\/)/i,
  /fonts\.(?:googleapis|gstatic)\.com/i,
  /(?:images|videos)\.pexels\.com/i,
]

function walk(path: string): string[] {
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)))
}

function scanRuntimeFiles(): string[] {
  const roots = ['src', 'public', 'index.html']
  return roots
    .map((root) => join(sourceRoot, root))
    .filter((root) => existsSync(root))
    .flatMap((root) => walk(root))
    .filter((path) => {
      const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
      return !ignoredExtensions.has(extension) && runtimeExtensions.has(extension)
    })
    .flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split(/\r?\n/)
      return lines.flatMap((line, index) =>
        runtimePatterns.some((pattern) => pattern.test(line))
          ? [`${relative(process.cwd(), path)}:${index + 1}: ${line.trim()}`]
          : [],
      )
    })
}

describe('offline asset policy', () => {
  it('has no runtime network resource reference', () => {
    const matches = scanRuntimeFiles()
    expect(matches, matches.join('\n')).toEqual([])
  })
})
