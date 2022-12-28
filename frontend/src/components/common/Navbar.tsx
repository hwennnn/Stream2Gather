import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FC } from 'react';
import { firebaseLogout } from '../../auth/firebaseAuth';
import { MeQueryKey } from '../../constants/query';
import { useLogoutMutation, useMeQuery } from '../../generated/graphql';

const Navbar: FC = () => {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isFetching, isError } = useMeQuery(
    {},
    {
      staleTime: Infinity
    }
  );

  const { mutateAsync } = useLogoutMutation({});

  const isLoggedIn = !isError && data?.me !== null && data?.me !== undefined;

  const logout = async (): Promise<void> => {
    const result = await mutateAsync({});
    if (result.logout) {
      await firebaseLogout();
      await queryClient.invalidateQueries({ queryKey: MeQueryKey });
      await router.push('/');
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-row items-center justify-between py-4 px-8">
        <Link href="/">
          <div className="laptop:mt-0 cursor-pointer title-smaller font-bold text-black dark:text-white items-center navbar-link">
            Stream2Gather
          </div>
        </Link>

        {isLoggedIn && (
          <div className="flex flex-row space-x-6 items-center">
            <div className="title-smaller font-semibold text-secondary dark:text-secondary-dark">
              {data?.me?.username}
            </div>

            <div onClick={async () => await logout()} className="btn-underline">
              Logout
            </div>
          </div>
        )}

        {!isFetching && !isLoggedIn && (
          <div className="flex flex-row space-x-6 items-center">
            <Link href="/login">
              <div className="btn-underline">Login</div>
            </Link>

            <Link href="/register">
              <div className="btn-underline">Register</div>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default Navbar;
