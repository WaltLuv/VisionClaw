// Speaking instead of typing, using the browser's own speech recognition.
//
// This is deliberately not the realtime conversation: that needs LiveKit and a
// realtime model. This needs nothing at all, works offline of any account, and
// covers the common case — saying a job rather than thumbing it in on a ladder.
//
// What it hears goes into the box for you to look at before it is sent. A field
// agent mishearing "Unit 12" as "Unit 20" and acting on it unprompted is worse
// than a moment spent reading it back.

type RecognitionEvent = {results: ArrayLike<ArrayLike<{transcript: string}> & {isFinal: boolean}>; resultIndex: number};
interface Recognition extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: {error: string}) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

const ctor = (): RecognitionCtor | undefined =>
  (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition;

export const dictationSupported = () => !!ctor();

export type DictationState = 'idle' | 'listening' | 'denied' | 'unavailable';

export interface DictationHandlers {
  /** Called as words arrive; `final` marks a settled phrase. */
  onText(text: string, final: boolean): void;
  onState(state: DictationState, detail?: string): void;
}

export class Dictation {
  private recognition: Recognition | null = null;
  private settled = '';
  state: DictationState = 'idle';

  constructor(private readonly handlers: DictationHandlers) {}

  private set(state: DictationState, detail?: string) {
    this.state = state;
    this.handlers.onState(state, detail);
  }

  /** Begin listening. Returns the text captured so far, which starts empty. */
  start(startingFrom = '') {
    const Ctor = ctor();
    if (!Ctor) {this.set('unavailable'); return;}
    this.stop();
    this.settled = startingFrom ? startingFrom.replace(/\s*$/, ' ') : '';
    const recognition = new Ctor();
    this.recognition = recognition;
    // Keep listening through pauses: someone describing a job stops to look at it.
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) this.settled += text.replace(/^\s*/, this.settled ? ' ' : '');
        else interim += text;
      }
      this.handlers.onText((this.settled + (interim ? ' ' + interim : '')).trim(), !interim);
    };
    recognition.onerror = e => {
      // "no-speech" and "aborted" are ordinary; only a refusal needs saying.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.set('denied');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') this.set('idle', 'Could not hear that. Try again.');
    };
    recognition.onend = () => {if (this.state === 'listening') this.set('idle');};

    try {recognition.start(); this.set('listening');}
    catch {this.set('idle', 'Could not start listening.');}
  }

  stop() {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = recognition.onerror = recognition.onend = null;
    try {recognition.stop();} catch {/* already stopped */}
    if (this.state === 'listening') this.set('idle');
  }

  get listening() {return this.state === 'listening';}
}

export const dictationMessage: Record<DictationState, string> = {
  idle: '',
  listening: 'Listening… tap the microphone again when you are done.',
  denied: 'Microphone access is off. Turn it on for this site in your browser settings.',
  unavailable: '',
};
