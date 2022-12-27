import authApi from '../lib/authApi';

export const isAuthenticated = async (cookies: any): Promise<boolean> => {
  return await authApi.isAuth(cookies);
};
