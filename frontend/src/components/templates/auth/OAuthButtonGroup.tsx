import {
  Button,
  ButtonGroup,
  useToast,
  VisuallyHidden
} from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { FC, useEffect, useState } from 'react';
import { signInWithProvider } from '../../../auth/firebaseAuth';
import { MeQueryKey } from '../../../constants/query';
import { useSocialLoginMutation } from '../../../generated/graphql';
import { GitHubIcon, GoogleIcon, TwitterIcon } from './ProviderIcons';

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

interface LoginToastMessage {
  title: string;
  description: string;
  status: 'error' | 'success';
}

const OAuthButtonGroup: FC = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { mutateAsync } = useSocialLoginMutation({});
  const toast = useToast();
  const [toastMessage, setToastMessage] = useState<LoginToastMessage | null>(
    null
  );
  const [isButtonLoading, setIsButtonLoading] = useState<ProviderName | null>(
    null
  );

  useEffect(() => {
    if (toastMessage !== null) {
      toast({
        title: toastMessage.title,
        description: toastMessage.description,
        status: toastMessage.status,
        duration: toastMessage.status === 'error' ? 4000 : 2000,
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
      const { userToken, username, email } = await signInWithProvider(name);
      console.log(username, email);

      await mutateAsync({
        options: {
          token: userToken,
          email,
          username
        }
      });

      await invalidateMeQueryAndRedirect();
    } catch (error: any) {
      setIsButtonLoading(null);
      setToastMessage({
        title: 'Error encountered',
        description: error.message,
        status: 'error'
      });
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
