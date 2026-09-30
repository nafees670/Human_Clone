# Human Stand-In — Sir Ahmed (Hackathon Demo)

A one-screen chat app where students talk to an **AI stand-in of one consenting real teacher**, "Sir Ahmed" (Physics). It answers in his warm English + Roman Urdu style, shows **which of his notes** it used, is always labelled as *not the real person*, and **refuses high-risk requests** (exam papers, marks, signatures) by sending them to the real teacher for written approval.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
npm run lint
npm run build          # tsc --noEmit && vite build
```

Optional, for real AI answers — **any one** of these is enough, the app picks whichever answers first:

```bash
ollama pull llama3.2:3b && ollama serve     # → localhost:11434
# or a llama.cpp `llama-server`             # → localhost:8080
```

It works with **no backend at all**. If no local model is reachable, replies are canned (shown as "⚡ Model offline, using canned response") and stream in the same way. The header pill shows the live model status and is re-checked every 15s. Both backends are reached through Vite proxies (`/ollama → :11434`, `/llamacpp → :8080`), so there are no CORS problems. To change the model, edit `OLLAMA_MODEL` in `src/ai.ts`.

The first question waits for the startup ping instead of assuming the app is offline, so a slow-loading model does not get answered from the canned path. The connect timeout is **30s** (CPU model load can be slow), and it only applies until the first token arrives.

## 60-second demo script

1. Hover **✓ Verified consent** to see the tooltip, then click it to open the agreement modal.
2. Tap **"Newton ka second law samjha dein"**. The typing dots appear, then the answer streams in. The Context Box highlights the matched note with a **USED** badge.
3. Tap **"Kal ka test kis chapter ka hai?"**. It is answered with **⚠️ Please double check with Sir Ahmed**.
4. Tap **"Give me marks in the final exam"**. The 🔒 approval modal opens and nothing reaches the model.
5. Tap the 🎙️ mic and ask "What is Ohm's law?". The listening bubble shows your live transcript, sends automatically on silence, and reads the reply aloud.

## What's real vs. mocked

| Feature | Demo | What production needs |
|---|---|---|
| Consent | Static "Verified" badge and agreement text | Real e-signature flow, identity verification, signed and hashed agreement, revocation that actually disables the persona |
| Knowledge / RAG | 5 hardcoded notes, keyword match with light stemming (`src/persona.ts`) | Teacher uploads material → chunking → embeddings → vector search with citations |
| Safety | Keyword block/caution lists, incl. Roman-Urdu variants | A trained risk-tier classifier, a human approval queue, audit log |
| Persona | One hardcoded teacher | Multi-persona support, a persona creation and setup flow, per-persona scopes |
| AI | Local Ollama or llama.cpp, or canned fallback | Hosted model, evals for tone and accuracy, rate limits |
| Voice | Browser Web Speech API (hidden if unsupported or denied) | Server STT/TTS, optionally a consented voice clone |

The safety layer is keyword-based **on purpose** for a zero-backend demo, which also means it is easy to get around — "give me marks" is blocked, but no list of strings is a real filter. Treat it as a UI affordance, not a control.

## Files

- `src/App.tsx`: the whole UI (chat bubbles, context box, modals, composer)
- `src/persona.ts`: persona, agreement text, knowledge notes, `retrieve()`, `checkRisk()`, canned replies, system prompt
- `src/ai.ts`: Ollama NDJSON + llama.cpp SSE streaming, 30s first-token timeout, simulated streaming for the canned path
- `src/speech.ts`: `useSpeechInput` / `useSpeechOutput` hooks
- `eslint.config.js`: lint config

### A note on lint

`typescript-eslint` cannot run against this project's `typescript@7` — it hard-errors with *"typescript-eslint does not support TS 7.0"* (its peer range is `>=4.8.4 <6.1.0`, tracked in typescript-eslint#10940). So `npm run lint` uses `@babel/eslint-parser` instead, which parses TS/TSX fine but provides **no type-aware rules**. Types are covered by `tsc --noEmit` in `npm run build`. If you later move to typescript-eslint, drop back to a single `npm i -D typescript-eslint eslint-plugin-react-hooks` and swap the parser block in `eslint.config.js`.

**Next steps:** real consent and e-signature, real embeddings RAG, a risk-tier classifier, multi-persona plus a setup flow, a settings panel, Urdu script (Nastaliq) rendering.
