export const isLoggedIn = (cookies: any): boolean => {
  return typeof cookies.qid === 'string';
};
