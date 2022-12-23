// @ts-ignore
import { SessionData } from "express-session";
// @ts-ignore
import { Socket } from "socket.io";

declare module "express-session" {
    interface SessionData {
        userId?: string;
    }
}

declare module "socket.io" {
    interface Socket {
        roomId?: string;
    }
}
