import { Router } from 'express';

const errorRouter = Router();

// The 404 Route (ALWAYS Keep this as the last route)
errorRouter.use('*', (_req, res) => {
  res.sendStatus(404);
});

export default errorRouter;
