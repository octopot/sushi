import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Three pages in one build: the panel (index.html), the settings window (settings.html) and the
// window of Report a problem (report.html).
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { index: page('index.html'), settings: page('settings.html'), report: page('report.html') },
    },
  },
})
