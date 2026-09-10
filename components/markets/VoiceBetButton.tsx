'use client';

import { useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import { MicIcon } from '@/components/ui/icons';
import { parseSpokenBet, type SpokenBet } from '@/lib/voiceBet';
import { cn } from '@/lib/cn';

/**
 * Hold-to-talk for the create-market wizard's title field. Press and hold, say the bet, let go:
 * the transcript streams into the title while you talk, and on release lib/voiceBet.ts turns it
 * into a type, a title, a line, or a set of roster picks for the wizard to pre-fill. Nothing is
 * submitted from here; the wizard's own steps still stand between this and a real market.
 *
 * Native only. On the web (and in an app build from before the plugin shipped, where the bridge
 * would answer UNIMPLEMENTED, see "The native shells run current JS against a plugin layer that
 * can be months old" in ARCHITECTURE.md) the component renders nothing at all: a desktop user
 * types, and there is no Web Speech API fallback on purpose, since that path would send audio to
 * a browser vendor's server.
 *
 * Permission is asked for on the first press, not on mount, so the OS dialog appears next to the
 * thing it's about. A denial has no error state: the button is replaced by one quiet caption and
 * the field stays a text field. A denial already on record hides the button outright.
 *
 * What leaves the phone: nothing from this code. The transcript is handed to a pure parser and
 * the form. The recognizer itself runs on-device where the OS supports it; we ask the plugin for
 * that path (`useOnDeviceRecognition`) whenever `isOnDeviceRecognitionAvailable()` says it exists
 * for en-US, and fall back to the platform's default recognizer otherwise, which on iOS can mean
 * Apple's server-side recognition for the audio of that one utterance.
 */

type Phase = 'hidden' | 'idle' | 'listening' | 'finishing' | 'typing';

const LANGUAGE = 'en-US';
/** How long to wait after `stop()` for the recognizer's final pass before parsing what we have. */
const FINAL_RESULT_GRACE_MS = 1500;

export function VoiceBetButton({
  rosterNicknames,
  onPartial,
  onResult,
}: {
  /** Nicknames the parser may pre-pick, and that the recognizer is told to expect. */
  rosterNicknames: string[];
  /** Live transcript while the button is held; the wizard mirrors it into the title. */
  onPartial: (transcript: string) => void;
  onResult: (bet: SpokenBet) => void;
}) {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [grantedJustNow, setGrantedJustNow] = useState(false);

  // Refs rather than state for everything the pointer handlers read mid-gesture: a hold and a
  // release can land within one render, and the plugin's listeners fire outside React entirely.
  const phaseRef = useRef<Phase>('hidden');
  const permissionGranted = useRef(false);
  const onDevice = useRef(false);
  const latest = useRef('');
  const holding = useRef(false);
  const finalized = useRef(true);
  const stoppedResolve = useRef<(() => void) | null>(null);
  const listeners = useRef<PluginListenerHandle[]>([]);
  const roster = useRef(rosterNicknames);
  roster.current = rosterNicknames;
  const callbacks = useRef({ onPartial, onResult });
  callbacks.current = { onPartial, onResult };

  function go(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('SpeechRecognition')) return;
    let cancelled = false;
    (async () => {
      try {
        const { available } = await SpeechRecognition.available();
        if (!available) return;
        const { speechRecognition } = await SpeechRecognition.checkPermissions();
        // Already refused once: don't dangle a button that can only lead back to the same dialog.
        if (speechRecognition === 'denied') return;
        permissionGranted.current = speechRecognition === 'granted';
        try {
          onDevice.current = (await SpeechRecognition.isOnDeviceRecognitionAvailable({ language: LANGUAGE })).available;
        } catch {
          onDevice.current = false;
        }
        if (!cancelled) go('idle');
      } catch {
        // A shell without the native half of the plugin, or a device with no recognizer: stay hidden.
      }
    })();
    return () => {
      cancelled = true;
      detachListeners();
      SpeechRecognition.stop().catch(() => {});
    };
  }, []);

  async function attachListeners() {
    detachListeners();
    const partial = await SpeechRecognition.addListener('partialResults', (event) => {
      const text = (event.accumulatedText ?? event.matches?.[0] ?? '').trim();
      if (!text) return;
      latest.current = text;
      if (phaseRef.current === 'listening') callbacks.current.onPartial(capitalize(text));
    });
    const state = await SpeechRecognition.addListener('listeningState', (event) => {
      const stopped = event.state === 'stopped' || event.status === 'stopped';
      if (!stopped) return;
      stoppedResolve.current?.();
      // The recognizer gave up on its own (silence, an error) while the button was still held:
      // treat it as a release so the user isn't holding a dead button.
      if (holding.current) void finish();
    });
    listeners.current = [partial, state];
  }

  function detachListeners() {
    for (const l of listeners.current) l.remove().catch(() => {});
    listeners.current = [];
  }

  async function requestPermission() {
    try {
      const { speechRecognition } = await SpeechRecognition.requestPermissions();
      if (speechRecognition === 'granted') {
        permissionGranted.current = true;
        setGrantedJustNow(true);
        go('idle');
      } else {
        go('typing');
      }
    } catch {
      go('typing');
    }
  }

  async function press(e: React.PointerEvent<HTMLButtonElement>) {
    if (phaseRef.current !== 'idle') return;
    e.preventDefault();
    if (!permissionGranted.current) {
      // The OS dialog takes the pointer with it, so this press only asks; the next one listens.
      go('finishing');
      await requestPermission();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    holding.current = true;
    finalized.current = false;
    latest.current = '';
    setGrantedJustNow(false);
    go('listening');
    try {
      await attachListeners();
      await SpeechRecognition.start({
        language: LANGUAGE,
        maxResults: 1,
        popup: false,
        partialResults: true,
        contextualStrings: roster.current,
        useOnDeviceRecognition: onDevice.current,
      });
      // A tap so short the release beat the recognizer's start-up: stop it now, since the
      // release handler already ran with nothing to stop.
      if (!holding.current) void finish();
    } catch {
      holding.current = false;
      finalized.current = true;
      detachListeners();
      go('idle');
    }
  }

  function release() {
    if (!holding.current) return;
    holding.current = false;
    void finish();
  }

  /** Stop, give the recognizer a moment to emit its final pass, then hand whatever was heard to
   * the parser. Idempotent per hold: the release handler, the plugin's own stop event, and the
   * short-tap path can all reach here for the same utterance. */
  async function finish() {
    if (finalized.current) return;
    finalized.current = true;
    holding.current = false;
    go('finishing');
    const stopped = new Promise<void>((resolve) => {
      stoppedResolve.current = resolve;
      setTimeout(resolve, FINAL_RESULT_GRACE_MS);
    });
    try {
      await SpeechRecognition.stop();
    } catch {
      // Already stopped, or never started: nothing to wait for beyond the grace period.
    }
    await stopped;
    stoppedResolve.current = null;
    let text = latest.current;
    try {
      const last = await SpeechRecognition.getLastPartialResult();
      if (last.available && last.text.trim()) text = last.text.trim();
    } catch {
      // Older native half without getLastPartialResult: the partial listener's last value stands.
    }
    detachListeners();
    go('idle');
    if (text.trim()) callbacks.current.onResult(parseSpokenBet(text, roster.current));
  }

  if (phase === 'hidden') return null;
  if (phase === 'typing') return <p className="mt-3 text-[11.5px] text-espresso-400">Typing it is.</p>;

  const listening = phase === 'listening';
  const caption = listening
    ? 'Listening. Let go when you are done.'
    : phase === 'finishing'
      ? 'One sec'
      : grantedJustNow
        ? 'Now hold the mic and say the bet'
        : 'Hold to say the bet';

  return (
    <div className="mt-3 flex items-center gap-2.5">
      <button
        type="button"
        aria-label="Hold to say the bet"
        aria-pressed={listening}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'flex h-10 w-10 shrink-0 touch-none items-center justify-center rounded-full border-[1.5px] select-none [-webkit-touch-callout:none] transition-colors',
          listening
            ? 'border-honey-500 bg-honey-500 text-paper-white animate-pulse'
            : phase === 'finishing'
              ? 'border-honey-500 bg-honey-50 text-honey-800'
              : 'border-espresso-200 bg-paper-white text-espresso-600'
        )}
      >
        <MicIcon className="h-[18px] w-[18px]" />
      </button>
      <span className={cn('text-[12.5px] font-bold', listening ? 'text-honey-800' : 'text-espresso-400')}>{caption}</span>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
