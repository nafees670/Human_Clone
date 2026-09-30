import { useCallback, useEffect, useRef, useState } from 'react'
import { pingBackend, streamCanned, streamChat, type Backend, type ChatTurn } from './ai'
import {
  AGREEMENT, KNOWLEDGE, PERSONA, buildSystemPrompt, cannedReply, checkRisk, retrieve,
  type Risk, type Snippet,
} from './persona'
import { useSpeechInput, useSpeechOutput } from './speech'

type Msg =
  | { id: string; role: 'user'; text: string; at: number; viaVoice?: boolean }
  | {
      id: string
      role: 'persona'
      text: string
      at: number
      streaming: boolean
      source: 'ollama' | 'canned'
      snippetIds: string[]
      caution: boolean
    }
  | { id: string; role: 'notice'; text: string; at: number }

type Phase = 'idle' | 'thinking' | 'streaming'

const SUGGESTIONS = [
  'Newton ka second law samjha dein',
  'What is Ohm’s law?',
  'Why can’t sound travel in space?',
  'Kal ka test kis chapter ka hai?',
  'Give me marks in the final exam',
]

const uid = () => Math.random().toString(36).slice(2, 10)
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function App() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  // undefined = still checking, null = no local model (canned mode)
  const [backend, setBackend] = useState<Backend | null | undefined>(undefined)
  const [lastQuery, setLastQuery] = useState<{ q: string; snippets: Snippet[]; risk: Risk; usedIds: string[] } | null>(null)
  const [agreementOpen, setAgreementOpen] = useState(false)
  const [blockedQ, setBlockedQ] = useState<string | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const tts = useSpeechOutput()

  // Ping Ollama on load and every 15s so the status pill stays honest.
  useEffect(() => {
    const check = () => pingBackend().then(setBackend)
    check()
    const id = setInterval(check, 15000)
    return () => clearInterval(id)
  }, [])

  // `send` must not close over a stale `backend` (undefined = still checking, null = offline).
  const backendRef = useRef<Backend | null | undefined>(undefined)
  useEffect(() => {
    backendRef.current = backend
  }, [backend])

  const busy = phase !== 'idle'

  const send = useCallback(
    async (raw: string, viaVoice = false) => {
      const text = raw.trim()
      if (!text || abortRef.current) return
      setInput('')
      tts.stopSpeaking()

      const history = messagesRef.current
      setMessages((m) => [...m, { id: uid(), role: 'user', text, at: Date.now(), viaVoice }])

      // 1) Risk check — high-risk requests never reach the model.
      const risk = checkRisk(text)
      const snippets = risk === 'blocked' ? [] : retrieve(text)
      // usedIds is recorded here, not derived from the last bubble: while the answer is still
      // streaming the panel must not show the *previous* question's USED badge.
      setLastQuery({ q: text, snippets, risk, usedIds: snippets.map((s) => s.id) })
      if (risk === 'blocked') {
        setBlockedQ(text)
        return
      }

      // 2) Mock RAG + generation.
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setPhase('thinking')

      const replyId = uid()
      let started = false
      let usedSource: 'ollama' | 'canned' = 'ollama'
      const onToken = (t: string) => {
        if (!started) {
          started = true
          setPhase('streaming')
          setMessages((m) => [
            ...m,
            {
              id: replyId, role: 'persona', text: t, at: Date.now(), streaming: true,
              source: usedSource, snippetIds: snippets.map((s) => s.id), caution: risk === 'caution',
            },
          ])
        } else {
          setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, text: x.text + t } : x)))
        }
      }

      let finalText = ''
      const collect = (t: string) => {
        finalText += t
        onToken(t)
      }

      try {
        // `undefined` means the startup ping is still in flight — wait for it rather than
        // declaring the app offline and answering from the canned path.
        let active = backendRef.current
        if (active === undefined) {
          active = await pingBackend()
          setBackend(active)
        }
        if (!active) throw new Error('offline')
        const turns: ChatTurn[] = [
          { role: 'system', content: buildSystemPrompt(snippets) },
          ...history
            .filter((m) => m.role !== 'notice')
            .slice(-8)
            .map((m): ChatTurn => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
          { role: 'user', content: text },
        ]
        await streamChat(active, turns, collect, ctrl.signal)
      } catch {
        if (!started && !ctrl.signal.aborted) {
          // Model unreachable → canned reply, same streaming feel.
          setBackend(null)
          usedSource = 'canned'
          await new Promise((r) => setTimeout(r, 700))
          if (!ctrl.signal.aborted) await streamCanned(cannedReply(text, snippets, risk), collect, ctrl.signal)
        }
      }

      setMessages((m) => m.map((x) => (x.id === replyId && x.role === 'persona' ? { ...x, streaming: false } : x)))
      abortRef.current = null
      setPhase('idle')
      if ((viaVoice || autoSpeak) && finalText && !ctrl.signal.aborted) tts.speak(replyId, finalText)
    },
    [autoSpeak, tts],
  )

  const stt = useSpeechInput((t) => send(t, true))

  const stop = () => {
    abortRef.current?.abort()
  }

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, phase, stt.interim, stt.listening])

  // Belongs to the question currently shown in the panel, not to the last rendered bubble.
  const lastUsedIds = lastQuery?.usedIds ?? []

  return (
    <div className="flex h-full flex-col">
      <Header backend={backend} onAgreement={() => setAgreementOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* ─── Chat column ─── */}
        <main className="chat-bg flex min-w-0 flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              <DisclaimerChip />
              {messages.length === 0 && <Welcome onPick={(s) => send(s)} disabled={busy} />}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} msg={m} />
                ) : m.role === 'notice' ? (
                  <Notice key={m.id} text={m.text} />
                ) : (
                  <PersonaBubble
                    key={m.id}
                    msg={m}
                    speaking={tts.speakingId === m.id}
                    canSpeak={tts.supported}
                    onSpeak={() => (tts.speakingId === m.id ? tts.stopSpeaking() : tts.speak(m.id, m.text))}
                  />
                ),
              )}

              {phase === 'thinking' && <TypingBubble />}
              {stt.listening && <ListeningBubble transcript={stt.interim} onCancel={stt.cancel} />}
            </div>
          </div>

          {/* Mobile context drawer */}
          <div className="border-t border-black/5 bg-white/90 backdrop-blur lg:hidden dark:border-white/10 dark:bg-slate-900/90">
            <button
              onClick={() => setContextOpen((o) => !o)}
              className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
            >
              <span>
                📚 Context Box
                {lastQuery && ` · ${lastQuery.snippets.length} note${lastQuery.snippets.length === 1 ? '' : 's'} matched`}
              </span>
              <span className={`transition-transform duration-200 ${contextOpen ? 'rotate-180' : ''}`}>▴</span>
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-250 ease-out ${contextOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden">
                <div className="max-h-[45vh] overflow-y-auto px-4 pb-3">
                  <ContextPanel lastQuery={lastQuery} usedIds={lastUsedIds} backend={backend} />
                </div>
              </div>
            </div>
          </div>

          <Composer
            input={input}
            setInput={setInput}
            inputRef={inputRef}
            busy={busy}
            onSend={() => send(input)}
            onStop={stop}
            mic={stt}
            autoSpeak={autoSpeak}
            setAutoSpeak={tts.supported ? setAutoSpeak : undefined}
          />
        </main>

        {/* ─── Desktop context sidebar ─── */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 lg:block xl:w-96 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-400 uppercase">Context Box</h2>
          <ContextPanel lastQuery={lastQuery} usedIds={lastUsedIds} backend={backend} />
        </aside>
      </div>

      {agreementOpen && <AgreementModal onClose={() => setAgreementOpen(false)} />}
      {blockedQ && (
        <ApprovalModal
          question={blockedQ}
          onClose={() => {
            setBlockedQ(null)
            setMessages((m) => [
              ...m,
              { id: uid(), role: 'notice', at: Date.now(), text: '🔒 Not answered — this needs Sir Ahmed’s written approval.' },
            ])
            inputRef.current?.focus()
          }}
          onRequest={() => {
            setBlockedQ(null)
            setMessages((m) => [
              ...m,
              { id: uid(), role: 'notice', at: Date.now(), text: '📨 Approval request logged for Sir Ahmed. He will reply in person.' },
            ])
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────── Header & consent ───────────────────────────

function Header({ backend, onAgreement }: { backend: Backend | null | undefined; onAgreement: () => void }) {
  return (
    <header className="z-20 flex items-center gap-3 bg-emerald-800 px-3 py-2.5 text-white shadow-md sm:px-5 dark:bg-slate-900 dark:shadow-black/40">
      <div className="relative">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-100 text-2xl ring-2 ring-white/30">
          {PERSONA.avatar}
        </div>
        <span className="absolute -right-0.5 -bottom-0.5 rounded-full bg-sky-500 px-1 text-[10px] font-bold ring-2 ring-emerald-800 dark:ring-slate-900">
          AI
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-semibold">{PERSONA.name}</h1>
          <div className="group sm:relative">
            <button
              onClick={onAgreement}
              className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium transition hover:bg-white/25"
            >
              <span className="text-emerald-300">✓</span> Verified consent
            </button>
            <div className="pointer-events-none invisible absolute top-full left-3 z-30 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl sm:left-0 bg-slate-900 p-3 text-xs text-slate-200 opacity-0 shadow-xl transition duration-150 group-hover:visible group-hover:opacity-100">
              <p className="font-semibold text-white">{AGREEMENT.signer}</p>
              <p className="text-slate-400">Signed {AGREEMENT.signedOn} · #{AGREEMENT.id}</p>
              <p className="mt-1.5">Scope: general Physics help in his teaching style.</p>
              <p className="mt-1.5 text-emerald-300">Click to view agreement →</p>
            </div>
          </div>
        </div>
        <p className="truncate text-xs text-white/70">{PERSONA.profession}</p>
      </div>

      <StatusPill backend={backend} />
    </header>
  )
}

const backendName = (b: Backend) => `${b.kind === 'ollama' ? 'Ollama' : 'llama.cpp'} · ${b.model}`

function StatusPill({ backend }: { backend: Backend | null | undefined }) {
  const [color, label] =
    backend === undefined ? ['bg-slate-400', 'Checking…'] : backend ? ['bg-emerald-400', backend.model] : ['bg-amber-400', 'Offline mode']
  return (
    <div
      title={backend ? backendName(backend) : 'No local model reachable — using canned responses'}
      className="hidden items-center gap-1.5 rounded-full bg-black/20 px-2.5 py-1 text-[11px] sm:flex"
    >
      <span className={`h-2 w-2 rounded-full ${color} ${backend ? 'animate-pulse' : ''}`} />
      {label}
    </div>
  )
}

function DisclaimerChip() {
  return (
    <div className="sticky top-0 z-10 mx-auto mb-2 rounded-lg bg-amber-100/95 px-3 py-1 text-center text-[11px] font-medium text-amber-900 shadow-sm backdrop-blur dark:bg-amber-900/80 dark:text-amber-100">
      🤖 {PERSONA.disclaimer}
    </div>
  )
}

// ─────────────────────────── Chat bubbles ───────────────────────────

function Welcome({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  return (
    <div className="animate-pop-in mx-auto my-6 w-full max-w-md rounded-2xl bg-white p-5 text-center shadow-sm dark:bg-slate-800">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-4xl">{PERSONA.avatar}</div>
      <h2 className="mt-3 text-lg font-semibold">Assalam-o-Alaikum! 👋</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        I’m the AI stand-in of {PERSONA.name}. Ask me any Physics question — type or tap the mic.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 transition hover:-translate-y-0.5 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Avatar() {
  return (
    <div className="mt-auto grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-100 text-lg shadow-sm">
      {PERSONA.avatar}
    </div>
  )
}

function UserBubble({ msg }: { msg: Extract<Msg, { role: 'user' }> }) {
  return (
    <div className="animate-bubble-in flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3 py-2 text-sm shadow-sm dark:bg-[#005c4b]">
        <p className="break-words whitespace-pre-wrap">{msg.text}</p>
        <p className="mt-0.5 text-right text-[10px] text-slate-500 dark:text-slate-300">
          {msg.viaVoice && '🎙️ '}
          {time(msg.at)} ✓✓
        </p>
      </div>
    </div>
  )
}

function PersonaBubble({
  msg, speaking, canSpeak, onSpeak,
}: {
  msg: Extract<Msg, { role: 'persona' }>
  speaking: boolean
  canSpeak: boolean
  onSpeak: () => void
}) {
  const sources = KNOWLEDGE.filter((k) => msg.snippetIds.includes(k.id))
  return (
    <div className="animate-bubble-in flex items-end gap-2">
      <Avatar />
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-800">
        {msg.source === 'canned' && (
          <p className="mb-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
            ⚡ Model offline, using canned response
          </p>
        )}
        <p className={`break-words whitespace-pre-wrap ${msg.streaming ? 'caret' : ''}`}>{msg.text}</p>

        {!msg.streaming && msg.caution && (
          <p className="animate-fade-in mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] text-amber-700 dark:border-slate-700 dark:text-amber-300">
            ⚠️ Please double check with Sir Ahmed.
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {sources.map((s) => (
            <span key={s.id} className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              📎 {s.source.split(' · ')[1] ?? s.source}
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-400">
            {canSpeak && !msg.streaming && (
              <button
                onClick={onSpeak}
                title={speaking ? 'Stop' : 'Read aloud'}
                className={`rounded px-1 transition hover:bg-slate-100 dark:hover:bg-slate-700 ${speaking ? 'text-emerald-600' : ''}`}
              >
                {speaking ? '⏹' : '🔊'}
              </button>
            )}
            {time(msg.at)}
          </span>
        </div>
      </div>
    </div>
  )
}

function Dots({ className = 'bg-slate-400' }: { className?: string }) {
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {[0, 150, 300].map((d) => (
        <span key={d} className={`animate-dot h-2 w-2 rounded-full ${className}`} style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

function TypingBubble() {
  return (
    <div className="animate-bubble-in flex items-end gap-2" aria-label={`${PERSONA.name} is typing`}>
      <Avatar />
      <div className="rounded-2xl rounded-bl-sm bg-white px-4 py-3 shadow-sm dark:bg-slate-800">
        <Dots />
      </div>
    </div>
  )
}

function ListeningBubble({ transcript, onCancel }: { transcript: string; onCancel: () => void }) {
  return (
    <div className="animate-bubble-in flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[#d9fdd3] px-3 py-2 text-sm shadow-sm ring-2 ring-emerald-400/60 dark:bg-[#005c4b]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200">Listening</span>
          <Dots className="bg-emerald-600 dark:bg-emerald-300" />
          <button onClick={onCancel} className="ml-2 text-[11px] text-slate-500 hover:text-red-600 dark:text-slate-300">
            Cancel
          </button>
        </div>
        {transcript && <p className="mt-1 text-slate-700 italic dark:text-slate-100">{transcript}</p>}
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="animate-fade-in my-1 flex justify-center">
      <span className="rounded-lg bg-white/90 px-3 py-1 text-[11px] text-slate-600 shadow-sm dark:bg-slate-800/90 dark:text-slate-300">
        {text}
      </span>
    </div>
  )
}

// ─────────────────────────── Composer ───────────────────────────

function Composer({
  input, setInput, inputRef, busy, onSend, onStop, mic, autoSpeak, setAutoSpeak,
}: {
  input: string
  setInput: (s: string) => void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  busy: boolean
  onSend: () => void
  onStop: () => void
  mic: ReturnType<typeof useSpeechInput>
  autoSpeak: boolean
  setAutoSpeak?: (v: boolean) => void
}) {
  const canSend = input.trim().length > 0 && !busy
  return (
    <div className="border-t border-black/5 bg-slate-50 px-3 pt-2 pb-3 dark:border-white/10 dark:bg-slate-900">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        {setAutoSpeak && (
          <button
            onClick={() => setAutoSpeak(!autoSpeak)}
            title={autoSpeak ? 'Auto read-aloud: on' : 'Auto read-aloud: off'}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg transition ${
              autoSpeak ? 'bg-emerald-100 dark:bg-emerald-900' : 'opacity-50 hover:opacity-100'
            }`}
          >
            {autoSpeak ? '🔊' : '🔈'}
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={mic.listening ? mic.interim : input}
          readOnly={mic.listening}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (canSend) onSend()
            }
          }}
          placeholder={mic.listening ? 'Listening…' : 'Ask Sir Ahmed’s stand-in a Physics question…'}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-3xl border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-emerald-900"
        />
        {busy ? (
          <RoundButton onClick={onStop} title="Stop" className="bg-slate-700 hover:bg-slate-800">
            <span className="h-3.5 w-3.5 rounded-sm bg-white" />
          </RoundButton>
        ) : input.trim() || !mic.supported ? (
          <RoundButton onClick={onSend} disabled={!canSend} title="Send" className="bg-emerald-600 hover:bg-emerald-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
              <path d="M3.4 20.4 20.85 12 3.4 3.6 3.39 10.2 15 12 3.39 13.8z" />
            </svg>
          </RoundButton>
        ) : (
          <RoundButton
            onClick={mic.listening ? mic.stop : mic.start}
            title={mic.listening ? 'Stop & send' : 'Tap to talk'}
            className={mic.listening ? 'scale-110 bg-red-500 hover:bg-red-600' : 'bg-emerald-600 hover:bg-emerald-700'}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </RoundButton>
        )}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-slate-400">🤖 {PERSONA.disclaimer}</p>
    </div>
  )
}

function RoundButton({
  children, className, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-md transition duration-150 active:scale-95 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

// ─────────────────────────── Context box ───────────────────────────

function ContextPanel({
  lastQuery, usedIds, backend,
}: {
  lastQuery: { q: string; snippets: Snippet[]; risk: Risk } | null
  usedIds: string[]
  backend: Backend | null | undefined
}) {
  const riskStyle: Record<Risk, [string, string]> = {
    ok: ['bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200', '✓ Safe — answered'],
    caution: ['bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200', '⚠ Caution — answered with disclaimer'],
    blocked: ['bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200', '⛔ Blocked — needs written approval'],
  }

  return (
    <div className="space-y-4 text-sm">
      <section className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{PERSONA.avatar}</span>
          <div>
            <p className="font-semibold">{PERSONA.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{PERSONA.profession}</p>
          </div>
        </div>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
          {PERSONA.bio.map((b) => (
            <li key={b}>• {b}</li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          Retrieved notes <span className="font-normal normal-case">(keyword match · {KNOWLEDGE.length} in library)</span>
        </h3>
        {!lastQuery ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-400 dark:border-slate-700">
            Ask a question to see which of Sir Ahmed’s notes are used.
          </p>
        ) : lastQuery.snippets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">
            No notes matched “{lastQuery.q}”.{lastQuery.risk !== 'blocked' && ' Answering from general knowledge.'}
          </p>
        ) : (
          <div className="space-y-2">
            {lastQuery.snippets.map((s, i) => {
              const used = usedIds.includes(s.id)
              return (
                <article
                  key={s.id + lastQuery.q}
                  style={{ animationDelay: `${i * 80}ms` }}
                  className={`animate-pop-in rounded-lg border p-2.5 transition ${
                    used
                      ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200 dark:bg-emerald-950/50 dark:ring-emerald-900'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">📄 {s.source}</p>
                    {used && (
                      <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase">
                        Used
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                    <Highlight text={s.text} query={lastQuery.q} keywords={s.keywords} />
                  </p>
                </article>
              )
            })}
          </div>
        )}
      </section>

      {lastQuery && (
        <section>
          <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Risk check</h3>
          <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${riskStyle[lastQuery.risk][0]}`}>
            {riskStyle[lastQuery.risk][1]}
          </span>
        </section>
      )}

      <section className="space-y-1 rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700">
        <p>
          <span className="font-semibold">Rules:</span> {PERSONA.rules}
        </p>
        <p>
          <span className="font-semibold">Model:</span>{' '}
          {backend ? `${backendName(backend)} (local)` : backend === null ? 'Offline — canned responses' : 'Checking…'}
        </p>
      </section>
    </div>
  )
}

function Highlight({ text, query, keywords }: { text: string; query: string; keywords: string[] }) {
  const q = query.toLowerCase()
  const hits = keywords.filter((k) => k.length > 2 && new RegExp(`\\b${k}\\b`).test(q))
  if (!hits.length) return <>{text}</>
  const re = new RegExp(`\\b(${hits.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
  return (
    <>
      {text.split(re).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-700/60">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

// ─────────────────────────── Modals ───────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        className="animate-pop-in max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900"
      >
        {children}
      </div>
    </div>
  )
}

function AgreementModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-wider text-emerald-600 uppercase">Consent agreement</p>
          <h2 className="text-lg font-semibold">AI Stand-In Authorization</h2>
        </div>
        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
          ✓ Verified
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-500">Signer</dt><dd>{AGREEMENT.signer}</dd>
        <dt className="text-slate-500">Signed</dt><dd>{AGREEMENT.signedOn}</dd>
        <dt className="text-slate-500">Valid until</dt><dd>{AGREEMENT.validUntil}</dd>
        <dt className="text-slate-500">Ref</dt><dd className="font-mono text-xs leading-5">{AGREEMENT.id}</dd>
      </dl>
      <p className="mt-4 text-sm font-semibold">The stand-in MAY:</p>
      <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {AGREEMENT.scope.map((s) => <li key={s}>✅ {s}</li>)}
      </ul>
      <p className="mt-3 text-sm font-semibold">The stand-in may NOT:</p>
      <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
        {AGREEMENT.excluded.map((s) => <li key={s}>🚫 {s}</li>)}
      </ul>
      <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{AGREEMENT.revocation}</p>
      <p className="mt-2 text-[10px] text-slate-400">Demo document — static sample text, not a legal agreement.</p>
      <button onClick={onClose} className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
        Close
      </button>
    </Modal>
  )
}

function ApprovalModal({ question, onClose, onRequest }: { question: string; onClose: () => void; onRequest: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-red-100 text-3xl dark:bg-red-950">🔒</div>
      <h2 className="mt-3 text-center text-lg font-semibold">This needs Sir Ahmed’s written approval</h2>
      <p className="mt-2 text-center text-sm text-slate-500 dark:text-slate-400">
        The AI stand-in isn’t allowed to handle exam papers, marks, or signatures. Only the real Sir Ahmed can.
      </p>
      <blockquote className="mt-3 rounded-lg border-l-4 border-red-300 bg-slate-50 p-2.5 text-sm text-slate-700 italic dark:bg-slate-800 dark:text-slate-300">
        “{question}”
      </blockquote>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button onClick={onClose} className="rounded-xl border border-slate-200 py-2.5 text-sm font-medium transition hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
          Ask something else
        </button>
        <button onClick={onRequest} className="rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900">
          Request approval
        </button>
      </div>
    </Modal>
  )
}
