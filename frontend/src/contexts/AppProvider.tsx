import React, { PropsWithChildren } from 'react';

import { AuthProvider } from './AuthContext';

const AppProviders: React.FunctionComponent<PropsWithChildren> = ({
  children
}) => {
  return <AuthProvider>{children}</AuthProvider>;
};

export default AppProviders;
