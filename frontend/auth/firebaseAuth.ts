import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";

interface CreateWithEmailPasswordArgs {
    email: string;
    password: string;
}

const createWithEmailPassword = async ({
    email,
    password,
}: CreateWithEmailPasswordArgs): Promise<string> => {
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

export default createWithEmailPassword;
