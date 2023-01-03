import Layout from '@app/components/common/layouts/Layout';
import AuthenticatedApp from '@app/components/home/Authenticated/AuthenticatedApp';
import UnauthenticatedApp from '@app/components/home/Unauthenticated/UnauthenticatedApp';
import { useAuth } from '@app/contexts/AuthContext';
import { NextPage } from 'next';

const Home: NextPage = () => {
  const { user } = useAuth();

  const isAuthenticated = user !== null && user !== undefined;

  return (
    <Layout>
      {isAuthenticated ? <AuthenticatedApp /> : <UnauthenticatedApp />}
    </Layout>
  );
};

export default Home;
