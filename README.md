# Human Stand-In — Sir Ahmed (Hackathon Demo)

A one-screen chat app where students talk to an **AI stand-in of one consenting real teacher**, "Sir Ahmed" (Physics). It answers in his warm English + Roman Urdu style, shows **which of his notes** it used, is always labelled as *not the real person*, and **refuses high-risk requests** (exam papers, marks, signatures) by sending them to the real teacher for written approval.

## Run

```bash
npm install
npm run dev            # http://localhost:5173
# optional, for real AI answers:
ollama pull llama3.2:3b && ollama serve
```

It works with **no backend at all**. If Ollama isn't running, replies are canned (shown as "⚡ Model offline, using canned response") and stream in the same way. The header pill shows the live model status and is re-checked every 15s. Ollama goes through a Vite proxy (`/ollama → localhost:11434`), so there are no CORS problems. To change the model, edit `OLLAMA_MODEL` in `src/ai.ts`.

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
| Knowledge / RAG | 5 hardcoded notes with keyword matching (`src/persona.ts`) | Teacher uploads material → chunking → embeddings → vector search with citations |
| Safety | One keyword list: block or caution | A trained risk-tier classifier, a human approval queue, audit log |
| Persona | One hardcoded teacher | Multi-persona support, a persona creation and setup flow, per-persona scopes |
| AI | Local Ollama, or canned fallback | Hosted model, evals for tone and accuracy, rate limits |
| Voice | Browser Web Speech API (hidden if unsupported or denied) | Server STT/TTS, optionally a consented voice clone |

## Files

- `src/App.tsx`: the whole UI (chat bubbles, context box, modals, composer)
- `src/persona.ts`: persona, agreement text, knowledge notes, `retrieve()`, `checkRisk()`, canned replies, system prompt
- `src/ai.ts`: Ollama NDJSON streaming, a 4s connect timeout, simulated streaming for the canned path
- `src/speech.ts`: `useSpeechInput` / `useSpeechOutput` hooks

**Next steps:** real consent and e-signature, real embeddings RAG, a risk-tier classifier, multi-persona plus a setup flow, a settings panel, Urdu script (Nastaliq) rendering.
