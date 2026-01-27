# Contributing

## Setup

```bash
pnpm install
```

## Development

Start the dev server with hot reloading for the frontend:

```bash
pnpm start
```

This runs two processes concurrently:
- esbuild watching `entry.tsx` and rebuilding on changes
- The server at http://localhost:44100

By default it uses the current directory as the git repo. To view a different repo:

```bash
node --experimental-strip-types server.ts /path/to/repo
```

## Build

Build the production bundle:

```bash
pnpm build
```

This creates `dist/` containing:
- `server.js` - Bundled server with shebang (zero dependencies)
- `entry.bundled.js` - Bundled frontend
- `index.html` - Static HTML

## Test the CLI locally

After building, test the CLI as if it were installed from npm:

```bash
# Run from this directory
node dist/server.js /path/to/some/repo

# Or make it executable and run directly
chmod +x dist/server.js
./dist/server.js /path/to/some/repo
```

## Publish

```bash
pnpm build
npm publish
```

Users can then run:

```bash
npx git-viewer [path]
```
