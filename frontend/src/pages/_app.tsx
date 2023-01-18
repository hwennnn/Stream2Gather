import AuthWrapper from '@app/components/common/layouts/AuthWrapper';
import ErrorBoundary from '@app/components/ErrorBoundary';
import { isProd } from '@app/constants/config';
import AppProviders from '@app/contexts/AppProvider';
import theme from '@app/lib/theme';
import { ChakraProvider } from '@chakra-ui/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { AppProps } from 'next/app';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: isProd
    }
  }
});

export default function App({ Component, pageProps }: AppProps): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <ChakraProvider theme={theme}>
        <ErrorBoundary>
          <AppProviders>
            <AuthWrapper>
              <Component {...pageProps} />
              <ReactQueryDevtools initialIsOpen={false} />
            </AuthWrapper>
          </AppProviders>
        </ErrorBoundary>
      </ChakraProvider>
    </QueryClientProvider>
  );
}
