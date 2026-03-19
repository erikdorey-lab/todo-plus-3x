# To-Do Plus

An ADHD-friendly to-do app with Focus Mode, AI Brain Dump, and satisfying task completion.

## Features

- **Focus Mode** — shows one task at a time so you're not overwhelmed
- **AI Brain Dump** — speak or type freely, AI turns it into structured tasks
- **Time sizing** — Quick (<15 min), Medium (~1 hr), Big (1hr+)
- **Priority levels** — High / Medium / Low with color-coded indicators
- **Categories** — organize tasks by topic (Work, Home, Health, etc.)
- **Confetti** — satisfying animation when you complete a task
- **Progress bar** — see how much you've knocked out today
- **Auto-save** — everything saves to your browser automatically
- **Keyboard shortcuts** — N (new task), B (brain dump), F (focus mode), Esc (close)

## Quick Start

```bash
npm install
npm run dev
```

Then open the URL shown in your terminal (usually http://localhost:5173).

## AI Brain Dump Setup

The Brain Dump feature uses OpenAI to parse your thoughts into tasks. To enable it:

1. Get an API key at https://platform.openai.com/api-keys
2. Open the app and click the gear icon (Settings)
3. Paste your key — it's stored only in your browser, never sent anywhere else

## Project Structure

```
index.html   — page structure and layout
style.css    — all visual styling
main.js      — app logic (state, rendering, AI, confetti, etc.)
package.json — project config and scripts
```

## Available Scripts

| Command           | What it does                                  |
| ----------------- | --------------------------------------------- |
| `npm run dev`     | Start the dev server with live reload         |
| `npm run build`   | Build for production (outputs to `dist/`)     |
| `npm run preview` | Preview the production build locally          |
