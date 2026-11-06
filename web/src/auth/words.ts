/** What the sign-in window says. It opens from something someone was doing, so it says what that was. */
export type SignInAsk = { title: string; subtitle: string };

const NEW_HERE = 'New here? This makes your account too.';

export const SIGN_IN: SignInAsk = { title: 'Sign in to Stream2Gather', subtitle: `Your crews and past nights are here. ${NEW_HERE}` };

export const joinCrewAsk = (crew: string): SignInAsk => ({ title: `Join ${crew}`, subtitle: `Sign in to keep your seat in the crew. ${NEW_HERE}` });

export const START_CREW: SignInAsk = { title: 'Start a crew', subtitle: `A crew keeps one room, its watchlist and its past nights. ${NEW_HERE}` };

export const KEEP_ROOM: SignInAsk = { title: 'Keep this room', subtitle: `Sign in and it stays yours after tonight. ${NEW_HERE}` };

/** Clerk's own copy opens with "Welcome back!", which is wrong for someone who has never been here. */
export const clerkWords = ({ title, subtitle }: SignInAsk) => {
  const start = { title, titleCombined: title, subtitle, subtitleCombined: subtitle };
  return { signIn: { start }, signUp: { start } };
};
