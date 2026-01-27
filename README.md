# git-viewer

A visual git log viewer with branch graph and diff display. Runs locally in your browser.

## Usage

```bash
pnpm dlx git-viewer [path]
```

Then open http://localhost:44100

### Examples

```bash
# View current directory
pnpm dlx git-viewer

# View a specific repo
pnpm dlx git-viewer ~/projects/my-app
```

## Features

- Branch graph visualization
- Browse local and remote branches
- Search commits by message, author, or SHA
- View diffs with syntax highlighting
- Filter commits by branch

## Requirements

- Node.js 20+
- Git
