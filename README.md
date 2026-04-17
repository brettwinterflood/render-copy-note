# Note Renderer

Readable source project for an Obsidian plugin that renders notes into clean markdown for LLM context and export workflows.

## Commands

- `npm install`
- `npm run build`
- `npm run install-plugin`
- `npm run build-and-install`

## What it does

- Renders the active note into clean markdown suitable for LLM context
- Executes Dataview code blocks and inline expressions
- Optionally expands linked notes recursively
- Can append backlink snippets
- Can save a rendered copy to the desktop for easy sharing
- Can copy recent daily notes
- Resolves links and queries for easier context transfer

## Local install

Set `OBSIDIAN_PLUGIN_DIR` in `.env` to your vault plugin folder, then run:

```bash
npm run install-plugin
```
