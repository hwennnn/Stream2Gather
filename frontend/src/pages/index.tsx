import { NextPage } from 'next';
import Layout from '../components/common/Layout';
import AuthenticatedApp from '../components/home/AuthenticatedApp';
import UnauthenticatedApp from '../components/home/UnauthenticatedApp';
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
