import Head from "next/head";
import { PropsWithChildren } from "react";
import Navbar from "./Navbar";

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
        <div className="mx-auto w-full">
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

            <Navbar />

            {children}
        </div>
    );
};

export default Layout;
