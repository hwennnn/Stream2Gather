import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "./firebase";

interface EmailPasswordArgs {
    email: string;
    password: string;
}

export const registerWithEmailPassword = async ({
    email,
    password,
}: EmailPasswordArgs): Promise<string> => {
    try {
        const result = await createUserWithEmailAndPassword(
            auth,
            email,
            password
        );
        const userToken = await result.user.getIdToken();

        return userToken;
    } catch (error: any) {
        if (error.code === "auth/email-already-in-use") {
            throw Error("Email already in use");
        }

        throw Error("Something went wrong");
    }
};

export const loginWithEmailPassword = async ({
    email,
    password,
}: EmailPasswordArgs): Promise<string> => {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        const userToken = await result.user.getIdToken();

        return userToken;
    } catch (error: any) {
        console.log(error);
        if (error.code === "auth/user-not-found") {
            throw Error("User not found");
        } else if (error.code === "auth/wrong-password") {
            throw Error("Wrong password");
        } else if (error.code === "auth/user-disabled") {
            throw Error("User disabled");
        }

        throw Error("Something went wrong");
    }
};
