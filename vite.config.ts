import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxy local LLM servers (Ollama / llama.cpp) through Vite so the browser never hits CORS issues.
const llmProxy = {
  '/ollama': {
    target: 'http://localhost:11434',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, ''),
  },
  '/llamacpp': {
    target: 'http://localhost:8080',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/llamacpp/, ''),
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: llmProxy },
  preview: { proxy: llmProxy },
})
