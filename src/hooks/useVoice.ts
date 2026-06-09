import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API has different vendor prefixes across browsers.
// SpeechRecognition is Chrome/Edge only; Safari/Firefox don't implement it.
const SR =
  typeof window !== "undefined"
    ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null)
    : null;

const SYNTH = typeof window !== "undefined" ? window.speechSynthesis : null;

export interface UseVoiceOptions {
  ttsEnabled: boolean;
  sttEnabled: boolean;
  voiceName: string | null;
  wakeWord: string | null;
  onWake?: () => void; // fired when wake_word detected; consumer should start one-shot mic
}

export interface UseVoiceResult {
  ttsSupported: boolean;
  sttSupported: boolean;
  voices: SpeechSynthesisVoice[];
  speak: (text: string) => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  startListeningOnce: () => Promise<string>; // resolves with the transcript
  isListeningOnce: boolean;
  wakeListening: boolean;
}

/**
 * Voice hook: text-to-speech, one-shot speech-to-text, and a continuous
 * background wake-word listener. All gracefully no-op on unsupported browsers.
 */
export function useVoice(opts: UseVoiceOptions): UseVoiceResult {
  const { ttsEnabled, sttEnabled, voiceName, wakeWord, onWake } = opts;

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListeningOnce, setIsListeningOnce] = useState(false);
  const [wakeListening, setWakeListening] = useState(false);

  const ttsSupported = !!SYNTH;
  const sttSupported = !!SR;

  // Refs to persist recognizers across renders without re-allocating
  const oneShotRef = useRef<any>(null);
  const wakeRecRef = useRef<any>(null);
  const wakeShouldRunRef = useRef(false);
  const onWakeRef = useRef(onWake);
  const wakeWordRef = useRef((wakeWord || "").toLowerCase().trim());
  onWakeRef.current = onWake;
  wakeWordRef.current = (wakeWord || "").toLowerCase().trim();

  // ─── Voices: populate when available (async on some browsers) ─────────────
  useEffect(() => {
    if (!SYNTH) return;
    const refresh = () => {
      const list = SYNTH.getVoices();
      if (list && list.length > 0) setVoices(list);
    };
    refresh();
    SYNTH.addEventListener?.("voiceschanged", refresh);
    return () => SYNTH.removeEventListener?.("voiceschanged", refresh);
  }, []);

  // ─── TTS ──────────────────────────────────────────────────────────────────
  const speak = useCallback(
    (text: string) => {
      if (!SYNTH || !ttsEnabled || !text) return;
      try {
        SYNTH.cancel(); // stop any prior utterance
        const u = new SpeechSynthesisUtterance(text);
        if (voiceName) {
          const v = voices.find((vv) => vv.voiceURI === voiceName || vv.name === voiceName);
          if (v) u.voice = v;
        }
        u.rate = 1;
        u.pitch = 1;
        u.onstart = () => setIsSpeaking(true);
        u.onend = () => setIsSpeaking(false);
        u.onerror = () => setIsSpeaking(false);
        SYNTH.speak(u);
      } catch {
        setIsSpeaking(false);
      }
    },
    [ttsEnabled, voiceName, voices],
  );

  const stopSpeaking = useCallback(() => {
    if (!SYNTH) return;
    SYNTH.cancel();
    setIsSpeaking(false);
  }, []);

  // ─── One-shot STT (push-to-talk style) ────────────────────────────────────
  const startListeningOnce = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!SR) return reject(new Error("Speech recognition not supported in this browser"));
      try {
        const rec = new SR();
        oneShotRef.current = rec;
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.continuous = false;

        let finalTranscript = "";
        rec.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
          }
        };
        rec.onend = () => {
          setIsListeningOnce(false);
          oneShotRef.current = null;
          resolve(finalTranscript.trim());
        };
        rec.onerror = (e: any) => {
          setIsListeningOnce(false);
          oneShotRef.current = null;
          reject(new Error(e.error || "Recognition error"));
        };

        setIsListeningOnce(true);
        rec.start();
      } catch (e) {
        setIsListeningOnce(false);
        reject(e as Error);
      }
    });
  }, []);

  // ─── Wake-word listener (continuous) ──────────────────────────────────────
  useEffect(() => {
    if (!SR) return;
    const shouldRun = !!(sttEnabled && wakeWord && wakeWord.trim().length > 0);
    wakeShouldRunRef.current = shouldRun;

    if (!shouldRun) {
      try { wakeRecRef.current?.stop(); } catch {/* noop */}
      wakeRecRef.current = null;
      setWakeListening(false);
      return;
    }

    let stopped = false;

    const start = () => {
      if (stopped || !wakeShouldRunRef.current) return;
      try {
        const rec = new SR();
        wakeRecRef.current = rec;
        rec.lang = "en-US";
        rec.interimResults = true;
        rec.continuous = true;

        rec.onresult = (e: any) => {
          let combined = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            combined += e.results[i][0].transcript;
          }
          const lower = combined.toLowerCase();
          const wake = wakeWordRef.current;
          if (wake && lower.includes(wake)) {
            // Trigger! Stop the wake recognizer; the consumer starts the one-shot.
            try { rec.stop(); } catch {/* noop */}
            onWakeRef.current?.();
          }
        };
        rec.onerror = () => {/* swallow — auto-restart in onend */};
        rec.onend = () => {
          setWakeListening(false);
          if (!stopped && wakeShouldRunRef.current) {
            // small delay so the mic isn't grabbed during the one-shot
            setTimeout(start, 800);
          }
        };

        setWakeListening(true);
        rec.start();
      } catch {
        // Mic permission denied or busy — try again later
        if (!stopped && wakeShouldRunRef.current) setTimeout(start, 5000);
      }
    };

    start();

    return () => {
      stopped = true;
      try { wakeRecRef.current?.stop(); } catch {/* noop */}
      wakeRecRef.current = null;
      setWakeListening(false);
    };
  }, [sttEnabled, wakeWord]);

  return {
    ttsSupported,
    sttSupported,
    voices,
    speak,
    stopSpeaking,
    isSpeaking,
    startListeningOnce,
    isListeningOnce,
    wakeListening,
  };
}
