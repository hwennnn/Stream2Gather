import authApi from '@app/lib/authApi';

export const isAuthenticated = async (cookies: any): Promise<boolean> => {
  return await authApi.isAuth(cookies);
};
