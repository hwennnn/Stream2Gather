import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { createServer } from "http";
import { Server } from "socket.io";

dotenv.config()

const PORT = process.env.PORT;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN,
        methods: ["GET", "POST"]
    }
});

/**
 *  App Configuration
 */
app.use(helmet()); //safety
app.use(cors()); //safety
app.use(
    (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
    ): void => {
        express.json()(req, res, next);
    }
);


/**
 * Server Activation
 */
app.get("/", (req, res) => {
    res.json("hello world");
});

//The 404 Route (ALWAYS Keep this as the last route)
app.use('*', function (req: Request, res: Response) {
    res.sendStatus(404);
});

let rooms: Map<string, Array<SocketUser>> = new Map();
let socketToUser: Map<string, SocketUser> = new Map();

interface SocketUser {
    uid: string;
    socketID: string;
    sessionRoomID: string;
}

io.on("connection", (socket) => {
    socket.on('join-room', ({ uid, roomID }: { uid: string, roomID: string }) => {
        console.log(`${uid} has joined the room with id ${roomID}`);
        socket.emit("message", "Welcome to Stream2Gether. " + socket.id);
        socket.join(roomID);

        const user: SocketUser = { uid: uid, socketID: socket.id, sessionRoomID: roomID };
        if (rooms[roomID] === undefined) {
            rooms[roomID] = [];
        }
        rooms[roomID].push(user);
        socketToUser.set(socket.id, user);
    });

    // Runs when client disconnects
    socket.on('disconnect', () => {
        const { uid, sessionRoomID }: SocketUser = socketToUser.get(socket.id);
        rooms = rooms[sessionRoomID].filter((user: SocketUser) => user.uid !== uid);
        socketToUser.delete(socket.id);

        console.log(`${uid} has left the room with id ${sessionRoomID}`);
    });
});

httpServer.listen(PORT);