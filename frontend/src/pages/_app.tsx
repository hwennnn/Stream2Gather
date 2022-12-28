import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { AppProps } from 'next/app';
import { isProd } from '../constants/config';
import AppProviders from '../contexts/AppProvider';
import '../styles/globals.css';

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
      <AppProviders>
        <Component {...pageProps} />;
        <ReactQueryDevtools initialIsOpen={false} />
      </AppProviders>
    </QueryClientProvider>
  );
}
