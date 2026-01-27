import * as esbuild from 'esbuild'
import * as fs from 'node:fs'

// Clean dist folder
fs.rmSync('dist', { recursive: true, force: true })
fs.mkdirSync('dist', { recursive: true })

// Build the server (bundle all dependencies)
await esbuild.build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/server.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
})

// Build the frontend
await esbuild.build({
  entryPoints: ['entry.tsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'esm',
  outfile: 'dist/entry.bundled.js',
})

// Copy index.html to dist
fs.copyFileSync('index.html', 'dist/index.html')

console.log('Build complete!')
