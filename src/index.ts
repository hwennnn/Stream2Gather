import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import helmet from 'helmet';

dotenv.config()

const PORT = process.env.PORT;

const app = express();

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

app.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
