import type { CodegenConfig } from '@graphql-codegen/cli';
import 'dotenv-safe/config';

const config: CodegenConfig = {
  overwrite: true,
  schema: process.env.APOLLO_SERVER_URL,
  documents: 'src/graphql/**/*.graphql',
  generates: {
    'src/generated/graphql.tsx': {
      plugins: [
        'typescript',
        'typescript-operations',
        'typescript-react-query'
      ],
      config: {
        fetcher: {
          endpoint: process.env.APOLLO_SERVER_URL,
          fetchParams: {
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          }
        },
        exposeQueryKeys: true,
        addInfiniteQuery: true
      }
    }
  }
};

export default config;
