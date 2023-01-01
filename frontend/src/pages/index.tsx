import { NextPage } from 'next';
import Layout from '../components/Layout';
import AuthenticatedApp from '../components/templates/home/Authenticated/AuthenticatedApp';
import UnauthenticatedApp from '../components/templates/home/Unauthenticated/UnauthenticatedApp';
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
