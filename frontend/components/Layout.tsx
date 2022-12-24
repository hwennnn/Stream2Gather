import Head from "next/head";
import { PropsWithChildren } from "react";

interface LayoutProps {
    title?: string;
    description?: string;
    children: React.ReactNode;
}

const Layout: React.FC<PropsWithChildren<LayoutProps>> = ({
    title,
    description,
    children,
}) => {
    return (
        <div className="mx-auto">
            <Head>
                <title>{title ?? "Stream2Gather"}</title>
                <meta
                    name="description"
                    content={
                        description ??
                        "A platform to watch videos in sync with your friends"
                    }
                />
                <link rel="icon" href="/favicon.ico" />
            </Head>

            {children}
        </div>
    );
};

export default Layout;
