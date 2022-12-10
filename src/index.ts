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

io.on("connection", (socket) => {
    socket.on('join_room', ({ uid, roomID }: { uid: string, roomID: string }) => {
        console.log(`${uid} has joined the ${roomID}`);
        socket.emit("message", "Welcome to Stream2Gether. " + socket.id);
        socket.join(roomID);
    });

    // Runs when client disconnects
    socket.on('disconnect', () => {
        console.log(`${socket.id} has left the room`);
    });
});

httpServer.listen(PORT);