import { NextPage } from 'next';
import Layout from '../components/common/Layout';
import styles from '../styles/Home.module.css';

const Home: NextPage = () => {
  return (
    <Layout>
      <main className={styles.main}>
        <h1 className={styles.title}>Welcome to Stream2Gather</h1>
      </main>
    </Layout>
  );
};

export default Home;
