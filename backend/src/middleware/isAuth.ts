import { MyContext } from '@src/types';
import { MiddlewareFn } from 'type-graphql';

export const isAuth: MiddlewareFn<MyContext> = async (
  { context },
  next
): Promise<any> => {
  if (context.req.session.userId === undefined) {
    throw new Error('not authenticated');
  }

  return await next();
};
