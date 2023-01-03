import { NextPage } from 'next';
import Layout from '../components/common/layouts/Layout';
import AuthenticatedApp from '../components/home/Authenticated/AuthenticatedApp';
import UnauthenticatedApp from '../components/home/Unauthenticated/UnauthenticatedApp';

import { useAuth } from '../contexts/AuthContext';

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
