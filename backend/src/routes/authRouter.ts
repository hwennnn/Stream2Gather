import { Router } from 'express';

const authRouter = Router();

authRouter.get('/isAuth', (req, res) => {
  const isAuthenticated = req.session.userId !== undefined;
  res.json(isAuthenticated);
});

export default authRouter;
