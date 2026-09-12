// The preview has no realtime credentials, so the app hides the conversation
// control entirely. This stub keeps 555 kB of SDK out of the preview bundle;
// nothing here is reachable from the preview's UI.
const unavailable = () => {throw new Error('Realtime voice is not part of this preview.');};
export class Room {constructor() {unavailable();}}
export class LocalVideoTrack {constructor() {unavailable();}}
export const RoomEvent = {ConnectionStateChanged: 'x', Disconnected: 'y'} as const;
export const ConnectionState = {Reconnecting: 'r', Connected: 'c'} as const;
export const Track = {Source: {Camera: 'camera'}} as const;
