import { Loading } from '@app/components/common/loading/Loading';
import { isServer } from '@app/constants/config';
import { useAuth } from '@app/contexts/AuthContext';
import { shouldRedirect } from '@app/utils/shouldRedirect';
import { useRouter } from 'next/router';
import { FC, PropsWithChildren, useEffect } from 'react';

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
