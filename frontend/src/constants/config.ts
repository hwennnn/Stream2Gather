export const isProd: boolean = process.env.NODE_ENV === 'production';
export const apiVersion: string = 'v1';
export const isServer: boolean = typeof window === 'undefined';
