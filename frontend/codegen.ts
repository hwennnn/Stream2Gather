import type { CodegenConfig } from "@graphql-codegen/cli";

const config: CodegenConfig = {
    overwrite: true,
    schema: "http://localhost:8080/graphql",
    documents: "graphql/**/*.graphql",
    generates: {
        "generated/graphql.tsx": {
            plugins: [
                "typescript",
                "typescript-operations",
                "typescript-react-query",
            ],
            config: {
                fetcher: {
                    endpoint: "http://localhost:8080/graphql",
                    fetchParams: {
                        headers: {
                            "Content-Type": "application/json",
                        },
                    },
                },
            },
        },
    },
};

export default config;
