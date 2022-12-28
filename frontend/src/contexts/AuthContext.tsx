import React, { PropsWithChildren, useContext } from 'react';
import LoadingSpinner from '../components/common/loading/LoadingSpinner';
import { MeQuery, useMeQuery, User } from '../generated/graphql';

export default interface AuthContextInterface {
  user: User | null | undefined;
}

const AuthContext = React.createContext<AuthContextInterface | undefined>(
  undefined
);

const AuthProvider: React.FC<PropsWithChildren> = (props) => {
  const { data, isLoading, isError, error } = useMeQuery<MeQuery, any>(
    {},
    {
      staleTime: Infinity
    }
  );

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (isError) {
    return (
      <div>
        <p>An error was encountered in the app.</p>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user: data.me }} {...props}>
      {' '}
      {props.children}
    </AuthContext.Provider>
  );
};

const useAuth = (): AuthContextInterface => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a AuthProvider');
  }
  return context;
};

export { AuthProvider, useAuth };
