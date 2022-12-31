import * as admin from 'firebase-admin';

export const verifyFirebaseToken = async (token: string): Promise<string> => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    return decodedToken.uid;
  } catch (error) {
    throw Error('Invalid token');
  }
};
