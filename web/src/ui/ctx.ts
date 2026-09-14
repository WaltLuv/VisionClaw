import type {Connections, State} from '../api';
import type {Camera} from '../camera';
import type {Card, RealtimeSession, SessionState, TranscriptEntry} from '../realtime';

// Two places to be, plus the gear. Anything that is not "talk to it" or "see
// what it did" is configuration and lives behind Setup.
export type Tab = 'agent' | 'history' | 'setup';

export interface Ctx {
  state: State;
  connections: Connections | null;
  /** Gateway event stream health, not network health in general. */
  streamOnline: boolean;
  session: RealtimeSession;
  sessionState: SessionState;
  sessionDetail?: string;
  camera: Camera;
  cameraMultiple: boolean;
  transcript: TranscriptEntry[];
  cards: Card[];
  tab: Tab;
  busy: boolean;
  owner: string;
  go(tab: Tab): void;
  refresh(): Promise<void>;
  rerender(): void;
  toast(message: string): void;
  signOut(): Promise<void>;
}
