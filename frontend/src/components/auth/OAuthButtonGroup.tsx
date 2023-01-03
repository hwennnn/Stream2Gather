import { signInWithProvider } from '@app/auth/firebaseAuth';
import {
  GitHubIcon,
  GoogleIcon,
  TwitterIcon
} from '@app/components/auth/ProviderIcons';
import { MeQueryKey } from '@app/constants/query';
import { useSocialLoginMutation } from '@app/generated/graphql';
import {
  Button,
  ButtonGroup,
  useToast,
  VisuallyHidden
} from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';

import { useRouter } from 'next/router';
import { FC, useEffect, useState } from 'react';

export enum ProviderName {
  GOOGLE = 'Google',
  TWITTER = 'Twitter',
  GITHUB = 'GitHub'
}

interface ProviderProps {
  name: ProviderName;
  icon: JSX.Element;
}

const providers: ProviderProps[] = [
  {
    name: ProviderName.GOOGLE,
    icon: <GoogleIcon boxSize="5" />
  },
  {
    name: ProviderName.TWITTER,
    icon: <TwitterIcon boxSize="5" />
  },
  {
    name: ProviderName.GITHUB,
    icon: <GitHubIcon boxSize="5" />
  }
];

const OAuthButtonGroup: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { mutateAsync } = useSocialLoginMutation({});
  const toast = useToast();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isButtonLoading, setIsButtonLoading] = useState<ProviderName | null>(
    null
  );

  useEffect(() => {
    if (toastMessage !== null) {
      toast({
        title: 'Error encountered',
        description: toastMessage,
        status: 'error',
        duration: 4000,
        isClosable: true
      });
    }
  }, [toast, toastMessage]);

  const invalidateMeQueryAndRedirect = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: MeQueryKey
    });

    await router.push('/');
  };

  const loginWithProvider = async (name: ProviderName): Promise<void> => {
    setIsButtonLoading(name);

    try {
      setToastMessage(null);
      const { userToken, username, email, displayPhoto } =
        await signInWithProvider(name);

      if (username === null) {
        throw Error('Username is not provided');
      }

      await mutateAsync({
        options: {
          token: userToken,
          email,
          username,
          displayPhoto
        }
      });

      await invalidateMeQueryAndRedirect();
    } catch (error: any) {
      setIsButtonLoading(null);
      setToastMessage(error.message);
    }
  };

  return (
    <ButtonGroup variant="outline" spacing="4" width="full">
      {providers.map(({ name, icon }) => (
        <Button
          onClick={async () => await loginWithProvider(name)}
          isLoading={isButtonLoading === name}
          key={name}
          width="full"
        >
          <VisuallyHidden>Continue with {name}</VisuallyHidden>
          {icon}
        </Button>
      ))}
    </ButtonGroup>
  );
};

export default OAuthButtonGroup;
