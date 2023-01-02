import {
  AuthProvider,
  createUserWithEmailAndPassword,
  GithubAuthProvider,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  signInWithPopup,
  TwitterAuthProvider
} from 'firebase/auth';
import { ProviderName } from './../components/templates/auth/OAuthButtonGroup';
import { auth } from './firebase';

interface EmailPasswordArgs {
  email: string;
  password: string;
}

interface FirebaseAuthResult {
  userToken: string;
  username: string | null;
  email: string | null;
  displayPhoto: string | null;
}

export const registerWithEmailPassword = async ({
  email,
  password
}: EmailPasswordArgs): Promise<string> => {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    const userToken = await result.user.getIdToken();

    return userToken;
  } catch (error: any) {
    if (error.code === 'auth/email-already-in-use') {
      throw Error('Email already in use');
    }

    throw Error('Something went wrong');
  }
};

export const loginWithEmailPassword = async ({
  email,
  password
}: EmailPasswordArgs): Promise<string> => {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    const userToken = await result.user.getIdToken();

    return userToken;
  } catch (error: any) {
    console.log(error);
    if (error.code === 'auth/user-not-found') {
      throw Error('User not found');
    } else if (error.code === 'auth/wrong-password') {
      throw Error('Wrong password');
    } else if (error.code === 'auth/user-disabled') {
      throw Error('User disabled');
    }

    throw Error('Something went wrong');
  }
};

export const signInWithProvider = async (
  name: ProviderName
): Promise<FirebaseAuthResult> => {
  let provider: AuthProvider | null = null;

  switch (name) {
    case ProviderName.GOOGLE:
      provider = new GoogleAuthProvider();
      break;
    case ProviderName.GITHUB:
      provider = new GithubAuthProvider();
      break;
    case ProviderName.TWITTER:
      provider = new TwitterAuthProvider();
      break;
    default:
      throw Error('Provider cannot be found');
  }

  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userToken = await result.user.getIdToken();

    return {
      userToken,
      username: user.displayName,
      email: user.email,
      displayPhoto: user.photoURL
    };
  } catch (error: any) {
    console.log(error);
    if (
      error.code === 'auth/cancelled-popup-request' ||
      error.code === 'auth/popup-closed-by-user'
    ) {
      // DO NOTHING
      throw Error();
    } else {
      throw Error('Something went wrong');
    }
  }
};

export const firebaseLogout = async (): Promise<void> => {
  try {
    await auth.signOut();
  } catch (error: any) {
    throw Error('Something went wrong');
  }
};
