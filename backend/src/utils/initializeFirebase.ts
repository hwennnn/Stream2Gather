import { applicationDefault, initializeApp } from "firebase-admin/app";

export const initializeFirebase = () => {
    initializeApp({
        credential: applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID,
    });
};
