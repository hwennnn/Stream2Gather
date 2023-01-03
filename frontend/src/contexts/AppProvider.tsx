import { AuthProvider } from '@app/contexts/AuthContext';
import React, { PropsWithChildren } from 'react';

const AppProviders: React.FunctionComponent<PropsWithChildren> = ({
  children
}) => {
  return <AuthProvider>{children}</AuthProvider>;
};

export default AppProviders;
