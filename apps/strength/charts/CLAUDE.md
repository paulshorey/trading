This folder is a folder of React components in a NextJS app.

This React component is rendered at localhost:3000/?hoursBack=240h&controlInterval=%5B"1"%2C"4"%2C"12"%2C"60"%2C"240"%5D&controlTickers=%5B"TN1%21"%5D&priceTicker=TN1%21
The URL parameters are read by this React component, not passed down from NextJS.

This component is a standalone mini-app.

SyncedChartsWrapper.tsx waits until the window and document are ready. Then it loads the components and passes to them the available screen height.

SyncedCharts.tsx is a full-screen app that renders 2 financial data charts to compare side by side. The x-axis (time) is synced, so scrolling or interacting with the time in one does the same in the other.

One chart is the strength (similar to the RSI number, but from -100 to 100 instead of 0 to 100). The other is price. The user controls which data to show in each chart.

The folder and file names are self explanatory.

- components - general UI
- controls - dropdowns and selectors
- lib - mainly utilities to configure the charts or filter data
- state - Zustand store, synced with the URL query params

Most of the logic is in SyncedCharts.tsx. We must be careful not to let it get huge and messy. Please try to separate and group logic into reusable functions, saved in a folder/file that makes the most sense.
