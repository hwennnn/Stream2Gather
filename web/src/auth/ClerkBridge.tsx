import { ClerkFailed, ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { useEffect } from 'react';
import { account } from './account';

// Matches the tokens in index.css.
const appearance = {
  variables: {
    colorPrimary: '#90cef3',
    colorPrimaryForeground: '#121929',
    colorBackground: '#191f2b',
    colorForeground: '#eef1f6',
    colorMutedForeground: '#a7b0c0',
    colorInput: '#2a3241',
    colorInputForeground: '#eef1f6',
    colorNeutral: '#eef1f6',
    fontFamily: "'Geist Variable', ui-sans-serif, system-ui, sans-serif",
    borderRadius: '0.75rem',
  },
};

const Sync = () => {
  const clerk = useClerk();
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    account.attach(clerk);
    if (isSignedIn) void account.clerkSignedIn(() => getToken());
    else void account.clerkSignedOut();
  }, [clerk, getToken, isLoaded, isSignedIn, userId]);

  return null;
};

const Failed = () => {
  useEffect(() => account.clerkFailed(), []);
  return null;
};

/** Everything Clerk-specific lives here, so guests never download it. */
const ClerkBridge = ({ publishableKey }: { publishableKey: string }) => (
  <ClerkProvider publishableKey={publishableKey} appearance={appearance} telemetry={false}>
    <Sync />
    <ClerkFailed>
      <Failed />
    </ClerkFailed>
  </ClerkProvider>
);

export default ClerkBridge;
