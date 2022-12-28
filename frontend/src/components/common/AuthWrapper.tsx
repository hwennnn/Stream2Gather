import { isServer } from '@tanstack/react-query';
import { useRouter } from 'next/router';
import { FC, PropsWithChildren, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { shouldRedirect } from '../../utils/shouldRedirect';
import LoadingSpinner from './loading/LoadingSpinner';

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

  return (
    <div className="mx-auto w-full">
      {redirect ? <LoadingSpinner /> : children}
    </div>
  );
};

export default AuthWrapper;
