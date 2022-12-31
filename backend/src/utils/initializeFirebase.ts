import { applicationDefault, initializeApp } from 'firebase-admin/app';

export const initializeFirebase = (): void => {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
};
