# Improved build prompt — "Human Stand-In" demo

> Changes from v1: acceptance tests are defined up front; the exact keyword lists, persona and knowledge content are fixed (no guessing); known pitfalls are named (CORS, keyword ties, connect timeout, speech permission); the priorities are kept but each one has a clear "done" check.

## Role & goal
You are a senior frontend engineer. Build a **single-screen** React + Vite + TypeScript + Tailwind (v4, `@tailwindcss/vite`) demo: a chat with the **AI stand-in of ONE consenting teacher, "Sir Ahmed" (Physics, Lahore)**. It is a hackathon demo, so polish and reliability matter more than completeness. **`npm run build` must pass with zero type errors.**

## Hard constraints
- One screen. One hardcoded persona. Local React state only. No persistence.
- **It must work with zero backend.** Ollama is an enhancement, never a dependency.
- `🤖 AI stand-in of Sir Ahmed — not the real person.` must be visible at all times (header area + composer).
- Hinglish / Roman Urdu + English only. No Urdu script.

## Fixed content (use as-is)
- **Persona:** name, 👨‍🏫 avatar, "Physics Teacher · Govt. Boys High School, Lahore", and a 3-line bio (18 yrs Matric/FSc, real-life examples like cricket/rickshaws, speaks "Dekho beta…").
- **Agreement (static):** ref id, signer, signed date, valid-until, 3 "MAY" scope items, 3 "may NOT" items (exam/marks/attendance; signing on his behalf; personal/medical/financial advice), plus a revocation line. Label it "demo text, not a legal agreement".
- **Knowledge:** 5 notes `{id, source, text, keywords[]}`: Newton's laws, Work & Energy, Ohm's law, Waves & Sound, Gravitation. **Keywords must be topic-specific**. Do not use generic words like "law" or "speed", or ties will pull the wrong note.
- **Retrieve:** tokenize → count keyword hits → return the top 2 with score > 0.
- **Risk:**
  - BLOCK phrases (substring match): `paper leak, exam paper, give me marks, increase my marks, marks de, number barha, pass kar do, sign my, signature, sign certificate, fake attendance, mark me present`. These never reach the model.
  - CAUTION words (whole word): `exam, test, marks, grade, result, syllabus, assignment, deadline, fees, leave, chutti, attendance, board`. Answer, then add "⚠️ Please double check with Sir Ahmed".

## AI
- `OLLAMA_MODEL = "llama3.1"`. Call through a **Vite dev/preview proxy** `/ollama → http://localhost:11434` to avoid CORS.
- Ping `/api/tags` on load and every 15s, and show a status pill.
- `/api/chat` with `stream: true`. Parse NDJSON line by line. Use a **4s connect timeout**. If the call fails before the first token → canned reply streamed word by word (~45ms/word), with a badge "⚡ Model offline, using canned response". If it fails mid-stream → keep the partial text.
- System prompt: persona + style (≤120 words, plain text, one local example, a little Roman Urdu) + rules (Physics only, never claim to be the real person, never invent exam dates or marks) + the retrieved notes.
- Send the last 8 turns as history. Provide a Stop button while generating (AbortController).

## Chat UX (most of the effort goes here)
- WhatsApp look: green user bubbles on the right, white persona bubbles on the left with an avatar, a dotted wallpaper, timestamps, 150–250ms enter animations.
- **Typing indicator:** a 3-dot staggered bounce on the persona side until the first token arrives, then a blinking caret while streaming.
- **Mic:** Web Speech `SpeechRecognition` (`webkit` prefix), `lang="en-IN"`, `interimResults`, `continuous=false`. Show a user-side "Listening" bubble with a red ping + 3 dots + live interim text + Cancel. **Auto-send on `onend`.** If the API is unsupported or the error is `not-allowed` / `audio-capture` → hide the mic, with no error UI.
- **TTS:** auto-read the reply when the question came from voice; a 🔊 button per bubble; a global auto-read toggle; prefer an en-IN/en-PK voice.
- Empty state: an intro card + 5 suggestion chips covering the demo script (2 physics, 1 caution, 1 blocked, 1 sound/waves).
- Enter sends, Shift+Enter adds a newline. Auto-scroll to the bottom. Esc closes modals.

## Context Box
- Desktop (`lg`+): a right sidebar. Mobile: a collapsible drawer above the composer showing "N notes matched".
- Contents: persona summary, the matched notes (source + excerpt, **matched keywords highlighted**, a **USED** badge on the notes behind the last answer), the risk result of the last question (Safe / Caution / Blocked), a rules line, and the model status.

## Consent & safety UI
- A "✓ Verified consent" badge in the header. Hover shows a tooltip (signer, date, scope). Click opens the agreement modal.
- A blocked question opens a modal: "This needs Sir Ahmed's written approval", quoting the question, with the buttons [Ask something else] [Request approval]. Each button adds a centered system notice in the chat.

## Acceptance tests (verify before finishing)
1. With Ollama stopped: every suggestion chip produces a streamed canned reply. No console errors.
2. "What is Ohm's law?" → the Ohm note is USED (not Newton).
3. "Kal ka test kis chapter ka hai?" → answered + ⚠️ disclaimer.
4. "Give me marks in the final exam" → modal, and no model call.
5. Firefox (no SpeechRecognition) → the mic button is hidden and send still works.
6. A 375px-wide viewport → no horizontal scroll, and the drawer toggles.
7. `npm run build` passes.

## Deliverables (priority order)
1. Chat with canned replies → 2. Ollama streaming → 3. Voice → 4. Context Box → 5. Risk modal → 6. README (demo script, what's mocked, what production needs: real e-signature consent, embeddings RAG, risk-tier classifier, multi-persona + setup flow).

Suggested files: `App.tsx` (UI), `persona.ts` (data + retrieve + risk + canned), `ai.ts` (Ollama + fallback), `speech.ts` (hooks).
