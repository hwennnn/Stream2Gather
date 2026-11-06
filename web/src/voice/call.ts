import {
  ConnectionError,
  ConnectionErrorReason,
  ConnectionState,
  DisconnectReason,
  MediaDeviceFailure,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import { ApiError, post, type VoiceState } from '../api/http';
import type { PlayerAdapter } from '../players/types';
import { Ducker } from './ducker';
import { isTyping, PushToTalk } from './talk';

const SETTINGS = 's2g:voice';
const HINTED = 's2g:voice-hinted';

export const UNAVAILABLE = 'Voice unavailable';
const NO_NETWORK = 'Voice can’t connect on this network';
const MOVED = 'Voice moved to another tab';
const REMOVED = 'You were removed from voice';

type Settings = { pushToTalk: boolean; duck?: boolean };

const readSettings = (): Settings => {
  try {
    return { pushToTalk: false, ...(JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<Settings>) };
  } catch {
    return { pushToTalk: false };
  }
};

/** What a failed join should tell the viewer. */
export const joinCopy = (error: unknown): string => {
  if (error instanceof ApiError) return UNAVAILABLE;
  // The server refused us or isn't there, neither of which is the viewer's network.
  const ours = [ConnectionErrorReason.NotAllowed, ConnectionErrorReason.ServerUnreachable, ConnectionErrorReason.ServiceNotFound];
  return error instanceof ConnectionError && ours.includes(error.reason) ? UNAVAILABLE : NO_NETWORK;
};

/** What the button says after the call ended without the viewer asking. */
export const endCopy = (reason: DisconnectReason | undefined): string | null => {
  if (reason === DisconnectReason.DUPLICATE_IDENTITY) return MOVED;
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) return REMOVED;
  return null;
};

export const micCopy = (error: unknown): string => {
  const failure = MediaDeviceFailure.getFailure(error);
  if (failure === MediaDeviceFailure.PermissionDenied) {
    return 'Your mic is blocked. Allow it for this site in your browser, then try again. You can still listen.';
  }
  if (failure === MediaDeviceFailure.NotFound) return 'No microphone found. You can still listen.';
  return 'Your mic didn’t start. You can still listen.';
};

export type CallView = {
  connecting: boolean;
  reconnecting: boolean;
  /** Null until the first unmute, as that's what asks for the mic. */
  mic: 'muted' | 'live' | null;
  /** The browser refused to play audio without a tap. */
  needsTap: boolean;
  pushToTalk: boolean;
  duck: boolean;
};

export type CallDeps = {
  slug: string;
  player: () => PlayerAdapter | null;
  /** The source of what's playing. Ducking is off by default for YouTube. */
  source: () => string | undefined;
  report: (state: VoiceState | 'off') => void;
  speakers: (userIds: string[]) => void;
  say: (text: string) => void;
  /** The call is over. The note says why, if the viewer didn't ask for it. */
  onEnd: (note: string | null) => void;
};

/** One tab's place in a room's call. */
export class VoiceCall {
  private readonly room = new Room({ adaptiveStream: false, dynacast: false });
  private readonly settings = readSettings();
  private readonly listeners = new Set<() => void>();
  private readonly ducker: Ducker;
  private readonly talk = new PushToTalk((talking) => this.setMic(talking));
  private readonly elements = new Set<HTMLMediaElement>();
  private stopListening: () => void = () => {};
  private view: CallView;
  private wanted = false;
  private live = false;
  private applying = false;
  private over = false;

  constructor(private readonly deps: CallDeps) {
    this.ducker = new Ducker({ player: deps.player, enabled: () => this.duckingOn() });
    this.view = {
      connecting: true,
      reconnecting: false,
      mic: null,
      needsTap: false,
      pushToTalk: this.settings.pushToTalk,
      duck: this.duckingOn(),
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = () => this.view;

  private update(next: Partial<CallView>): void {
    this.view = { ...this.view, ...next };
    for (const listener of this.listeners) listener();
  }

  private duckingOn(): boolean {
    return this.settings.duck ?? this.deps.source() !== 'youtube';
  }

  /** Call this inside the click: the browser only lets a gesture start audio. */
  async join(): Promise<void> {
    void this.room.startAudio().catch(() => {});
    this.watchRoom();
    try {
      const { url, token } = await post<{ url: string; token: string }>(`/v1/rooms/${this.deps.slug}/voice-token`);
      if (this.over) return;
      await this.room.connect(url, token);
    } catch (error) {
      if (!this.over) this.finish(joinCopy(error));
      return;
    }
    if (this.over) {
      void this.room.disconnect();
      return;
    }
    this.syncAudio();
    this.update({ connecting: false });
    this.deps.report('listening');
    this.stopListening = this.listen();
  }

  private watchRoom(): void {
    this.room
      .on(RoomEvent.TrackSubscribed, (track) => this.play(track))
      .on(RoomEvent.TrackUnsubscribed, (track) => this.silence(track))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => this.speakersChanged(speakers))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => this.syncAudio())
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
        if (!this.view.connecting) this.update({ reconnecting });
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (!this.over && !this.view.connecting) this.finish(endCopy(reason));
      });
  }

  private play(track: RemoteTrack): void {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach();
    element.hidden = true;
    document.body.append(element);
    this.elements.add(element);
  }

  private silence(track: RemoteTrack): void {
    for (const element of track.detach()) {
      element.remove();
      this.elements.delete(element);
    }
  }

  private speakersChanged(speakers: Participant[]): void {
    this.deps.speakers(speakers.map((speaker) => speaker.identity));
    this.ducker.speaking(speakers.some((speaker) => !speaker.isLocal));
  }

  private syncAudio(): void {
    this.update({ needsTap: !this.room.canPlaybackAudio });
  }

  private listen(): () => void {
    const stopTalk = this.settings.pushToTalk ? this.talk.attach() : () => {};
    const key = (event: KeyboardEvent) => {
      const bare = !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (bare && event.key.toLowerCase() === 'm' && !isTyping(event) && !this.view.pushToTalk) this.toggleMic();
    };
    window.addEventListener('keydown', key);
    return () => {
      stopTalk();
      window.removeEventListener('keydown', key);
    };
  }

  toggleMic(): void {
    this.setMic(!this.wanted);
  }

  private setMic(on: boolean): void {
    if (this.over) return;
    this.wanted = on;
    if (on && localStorage.getItem(HINTED) === null) {
      localStorage.setItem(HINTED, '1');
      this.deps.say('Headphones keep the video out of your mic.');
    }
    void this.applyMic();
  }

  /** The first unmute waits on a browser prompt, and a release can arrive during it. */
  private async applyMic(): Promise<void> {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.wanted !== this.live && !this.over) {
        const next = this.wanted;
        await this.room.localParticipant.setMicrophoneEnabled(next);
        this.live = next;
        if (this.over) return;
        this.update({ mic: next ? 'live' : 'muted' });
        this.deps.report(next ? 'live' : 'muted');
      }
    } catch (error) {
      this.wanted = this.live;
      this.deps.say(micCopy(error));
    } finally {
      this.applying = false;
    }
  }

  holdToTalk(held: boolean): void {
    if (held) this.talk.press('pointer');
    else this.talk.release('pointer');
  }

  tapToHear(): void {
    void this.room.startAudio().then(
      () => this.syncAudio(),
      () => this.syncAudio(),
    );
  }

  setPushToTalk(on: boolean): void {
    this.save({ pushToTalk: on });
    this.setMic(false);
    this.stopListening();
    this.update({ pushToTalk: on });
    this.stopListening = this.listen();
  }

  setDucking(on: boolean): void {
    this.save({ duck: on });
    if (!on) this.ducker.stop();
    this.update({ duck: on });
  }

  private save(change: Partial<Settings>): void {
    Object.assign(this.settings, change);
    localStorage.setItem(SETTINGS, JSON.stringify(this.settings));
  }

  /** The switch shows what applies to this video, which can change under it. */
  videoChanged(): void {
    this.update({ duck: this.duckingOn() });
  }

  leave(): void {
    if (this.over) return;
    this.finish(null);
    void this.room.disconnect();
  }

  private finish(note: string | null): void {
    this.over = true;
    this.stopListening();
    this.ducker.stop();
    for (const element of this.elements) element.remove();
    this.elements.clear();
    this.deps.speakers([]);
    this.deps.report('off');
    this.deps.onEnd(note);
  }
}
