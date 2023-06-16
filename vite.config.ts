import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Two pages in one build: the panel (index.html) and the settings window (settings.html).
const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { index: page('index.html'), settings: page('settings.html') },
    },
  },
})
