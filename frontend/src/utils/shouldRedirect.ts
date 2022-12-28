import {
  nonAuthRoutes,
  protectedRoutes,
  publicRoutes
} from './../constants/route';

export interface IRedirect {
  redirect: boolean;
  redirectPath?: string;
}

export const shouldRedirect = (
  isAuth: boolean,
  pathname: string
): IRedirect => {
  if (publicRoutes.includes(pathname)) {
    return { redirect: false };
  }

  // if the user is authenticated and visits a non-protected route
  if (isAuth && nonAuthRoutes.includes(pathname)) {
    return { redirect: true, redirectPath: '/' };
  }

  // if the user is not authenticated and visits protected route
  if (!isAuth && protectedRoutes.includes(pathname)) {
    return { redirect: true, redirectPath: '/login' };
  }

  return { redirect: false };
};
