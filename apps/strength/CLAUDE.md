# Strength app codebase

This project is the "strength" app. It renders 2 charts side by side, to compare price and strength.

Chart 1: strength. Similar to the RSI number, but from -100 to 100 instead of 0 to 100.
Chart 2: price. The user controls which data to show in each chart.

### Filesystem:

- ./charts/SyncedChartsWrapper.tsx waits until the window and document are ready. Then it loads the components and passes to them the available screen height.

- ./charts/SyncedCharts.tsx is a full-screen app that renders 2 financial data charts to compare side by side. The x-axis (time) is synced, so scrolling or interacting with the time in one does the same in the other.

- ./charts/components - general UI
- ./charts/controls - dropdowns and selectors
- ./charts/lib - utilities to configure the charts or filter data
- ./charts/state - Zustand store, synced with the URL query params

### Use PNPM instead of NPM:

If you need to run `npm i` or `npm install`, run `pnpm install` instead. Same for other npm commands, use pnpm: `pnpm run build`.

### Questions:

If you do not understand what I mean, or have confusion about the code and user experience, please ask me to clarify.
