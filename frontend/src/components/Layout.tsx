import Head from 'next/head';
import { useRouter } from 'next/router';
import { FC, PropsWithChildren, useEffect } from 'react';
import { useMeQuery } from '../generated/graphql';
import Navbar from './Navbar';

interface LayoutProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
  forLoggedInUser?: boolean | undefined;
}

const shouldRedirectHome = (forLoggedInUser: boolean, user: any): boolean => {
  if (forLoggedInUser) {
    return typeof user === 'undefined' || user === null;
  } else {
    return typeof user !== 'undefined' && user !== null;
  }
};

const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  description,
  children,
  forLoggedInUser
}) => {
  const { data, isLoading } = useMeQuery();
  const router = useRouter();

  useEffect(() => {
    if (
      !isLoading &&
      forLoggedInUser !== undefined &&
      shouldRedirectHome(forLoggedInUser, data?.me)
    ) {
      void router.replace('/');
    }
  }, [isLoading, data, forLoggedInUser, router]);

  return (
    <div className="mx-auto w-full">
      <Head>
        <title>
          {title !== undefined ? `${title} - Stream2Gather` : 'Stream2Gather'}
        </title>
        <meta
          name="description"
          content={
            description ??
            'A platform to watch videos in sync with your friends'
          }
        />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {!isLoading && (
        <>
          <Navbar />
          {children}
        </>
      )}
    </div>
  );
};

export default Layout;
