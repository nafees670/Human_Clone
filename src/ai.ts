// ─── AI layer: local LLM streaming with a canned, always-works fallback ───
// Tries Ollama first, then a llama.cpp `llama-server` (OpenAI-compatible API).

export const OLLAMA_MODEL = 'llama3.2:3b'
const OLLAMA_BASE = '/ollama' // proxied to http://localhost:11434 by vite.config.ts
const LLAMACPP_BASE = '/llamacpp' // proxied to http://localhost:8080 by vite.config.ts
// Only used once a ping succeeded, so it can be generous: CPU model load can take a while.
const FIRST_BYTE_TIMEOUT_MS = 30000

export type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }
export type Backend = { kind: 'ollama' | 'llamacpp'; model: string }

async function pingOllama(): Promise<Backend | null> {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(2000) })
  if (!res.ok) return null
  const data = (await res.json()) as { models?: { name: string }[] }
  const found = data.models?.find((m) => m.name.split(':')[0] === OLLAMA_MODEL.split(':')[0])
  return found ? { kind: 'ollama', model: OLLAMA_MODEL } : null
}

async function pingLlamaCpp(): Promise<Backend | null> {
  const res = await fetch(`${LLAMACPP_BASE}/v1/models`, { signal: AbortSignal.timeout(2000) })
  if (!res.ok) return null
  const data = (await res.json()) as { data?: { id: string }[] }
  const id = data.data?.[0]?.id
  return id ? { kind: 'llamacpp', model: id.replace(/\.gguf$/, '').split('/').pop()! } : null
}

/** Returns the first reachable local backend, or null (→ canned mode). */
export async function pingBackend(): Promise<Backend | null> {
  for (const ping of [pingOllama, pingLlamaCpp]) {
    try {
      const b = await ping()
      if (b) return b
    } catch {
      /* try next */
    }
  }
  return null
}

/**
 * Streams tokens from the given backend. Throws if it fails before the first
 * token, so the caller can fall back to a canned reply.
 */
export async function streamChat(
  backend: Backend,
  messages: ChatTurn[],
  onToken: (t: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const connect = new AbortController()
  const timer = setTimeout(() => connect.abort(), FIRST_BYTE_TIMEOUT_MS)
  const onAbort = () => connect.abort()
  signal.addEventListener('abort', onAbort)

  const isOllama = backend.kind === 'ollama'
  const url = isOllama ? `${OLLAMA_BASE}/api/chat` : `${LLAMACPP_BASE}/v1/chat/completions`
  const body = isOllama
    ? { model: backend.model, messages, stream: true, options: { temperature: 0.6 } }
    : { messages, stream: true, temperature: 0.6, max_tokens: 300 }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: connect.signal,
    })
    if (!res.ok || !res.body) throw new Error(`${backend.kind} HTTP ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let first = true
    for (;;) {
      const { done, value } = await reader.read()
      if (first) {
        first = false
        clearTimeout(timer)
      }
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        if (isOllama) {
          // NDJSON: {"message":{"content":"..."},"done":false}
          const chunk = JSON.parse(line) as { message?: { content?: string }; error?: string }
          if (chunk.error) throw new Error(chunk.error)
          if (chunk.message?.content) onToken(chunk.message.content)
        } else {
          // SSE: data: {"choices":[{"delta":{"content":"..."}}]}
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') return
          const chunk = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
          const t = chunk.choices?.[0]?.delta?.content
          if (t) onToken(t)
        }
      }
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** Simulates token streaming for canned replies so the UI feels identical offline. */
export function streamCanned(text: string, onToken: (t: string) => void, signal: AbortSignal): Promise<void> {
  const tokens = text.match(/\S+\s*/g) ?? [text]
  return new Promise((resolve) => {
    let i = 0
    const id = setInterval(() => {
      if (signal.aborted || i >= tokens.length) {
        clearInterval(id)
        return resolve()
      }
      onToken(tokens[i++])
    }, 45)
  })
}
