import { isServer } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { FC, PropsWithChildren, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { shouldRedirect } from '../../utils/shouldRedirect';
import { Loading } from './loading/Loading';

const AuthWrapper: FC<PropsWithChildren> = ({ children }) => {
  const { user } = useAuth();
  const router = useRouter();
  const { redirect, redirectPath } = shouldRedirect(
    user !== null && user !== undefined,
    router.pathname
  );

  useEffect(() => {
    if (!isServer && redirect && redirectPath !== undefined) {
      void router.push(redirectPath);
    }
  }, [redirect, redirectPath, router]);

  return <>{redirect ? <Loading /> : children}</>;
};

export default AuthWrapper;
