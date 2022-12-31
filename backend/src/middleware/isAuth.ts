import { MiddlewareFn } from 'type-graphql';
import { MyContext } from '../types';

export const isAuth: MiddlewareFn<MyContext> = async (
  { context },
  next
): Promise<any> => {
  if (context.req.session.userId === undefined) {
    throw new Error('not authenticated');
  }

  return await next();
};
