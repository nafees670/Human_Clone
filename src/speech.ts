// ─── Web Speech API: recognition (mic) + synthesis (read aloud). Degrades silently. ───
import { useCallback, useEffect, useRef, useState } from 'react'

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } }
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> }
type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

const RecognitionImpl: RecognitionCtor | undefined =
  typeof window !== 'undefined'
    ? ((window as unknown as Record<string, RecognitionCtor | undefined>).SpeechRecognition ??
      (window as unknown as Record<string, RecognitionCtor | undefined>).webkitSpeechRecognition)
    : undefined

export function useSpeechInput(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(!!RecognitionImpl)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<Recognition | null>(null)
  const finalRef = useRef('')
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal

  const start = useCallback(() => {
    if (!RecognitionImpl || recRef.current) return
    const rec = new RecognitionImpl()
    rec.lang = 'en-IN' // copes well with English + Roman Urdu/Hinglish
    rec.interimResults = true
    rec.continuous = false // ends automatically after a pause → auto-send
    finalRef.current = ''

    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalRef.current += r[0].transcript
        else live += r[0].transcript
      }
      setInterim((finalRef.current + ' ' + live).trim())
    }
    rec.onerror = (e) => {
      // Permission denied / no mic / blocked by browser → hide the mic for this session.
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) setSupported(false)
    }
    rec.onend = () => {
      recRef.current = null
      setListening(false)
      setInterim('')
      const text = finalRef.current.trim()
      if (text) onFinalRef.current(text)
    }

    try {
      rec.start()
      recRef.current = rec
      setListening(true)
    } catch {
      setSupported(false)
    }
  }, [])

  const stop = useCallback(() => recRef.current?.stop(), [])
  const cancel = useCallback(() => {
    finalRef.current = ''
    recRef.current?.abort()
  }, [])

  useEffect(() => () => recRef.current?.abort(), [])

  return { supported, listening, interim, start, stop, cancel }
}

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = synth?.getVoices() ?? []
  return (
    voices.find((v) => /en[-_](IN|PK)/i.test(v.lang) && /male|ravi|rishi/i.test(v.name)) ??
    voices.find((v) => /en[-_](IN|PK)/i.test(v.lang)) ??
    voices.find((v) => v.lang.startsWith('en'))
  )
}

export function useSpeechOutput() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)

  const speak = useCallback((id: string, text: string) => {
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''))
    const voice = pickVoice()
    if (voice) u.voice = voice
    u.rate = 1
    u.pitch = 0.95
    u.onend = u.onerror = () => setSpeakingId((cur) => (cur === id ? null : cur))
    setSpeakingId(id)
    synth.speak(u)
  }, [])

  const stopSpeaking = useCallback(() => {
    synth?.cancel()
    setSpeakingId(null)
  }, [])

  return { supported: !!synth, speakingId, speak, stopSpeaking }
}
