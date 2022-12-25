import * as admin from "firebase-admin";

export const verifyFirebaseToken = async (token: string) => {
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        return decodedToken.uid;
    } catch (error) {
        console.error(error);
        throw Error("Invalid token");
    }
};
