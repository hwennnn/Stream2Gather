/* eslint-disable @typescript-eslint/no-unused-vars */

// @ts-expect-error
import { SessionData } from 'express-session';
// @ts-expect-error
import { Socket } from 'socket.io';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare module 'socket.io' {
  interface Socket {
    roomId?: string;
    uid?: string;
  }
}
