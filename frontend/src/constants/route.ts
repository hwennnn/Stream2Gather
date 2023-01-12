// Public routes (can be accessed by every user)
export const Home: string = '/';
export const publicRoutes: string[] = [Home];

// Accessible by non-authenticated users only
export const Login: string = '/login';
export const Register: string = '/register';
export const ForgotPassword: string = '/forgot-password';
export const nonAuthRoutes: string[] = [Login, Register, ForgotPassword];

// Accessible by authenticated users only
export const Room: string = '/room/[slug]';
export const protectedRoutes: string[] = [Room];
