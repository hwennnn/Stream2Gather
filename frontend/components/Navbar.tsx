import Link from "next/link";
import { useMeQuery } from "../generated/graphql";

const Navbar = () => {
    const { data, isLoading, error } = useMeQuery();

    const isLoggedIn =
        !isLoading && !error && data?.me !== null && data?.me !== undefined;

    const logout = async () => {};

    return (
        <div className="flex flex-col">
            <div className="flex flex-row items-center justify-between py-4 px-8">
                <Link href="/">
                    <div className="laptop:mt-0 cursor-pointer title-smaller font-bold text-black dark:text-white items-center navbar-link">
                        Stream2Gather
                    </div>
                </Link>

                {isLoggedIn === true && (
                    <div className="flex flex-row space-x-6 items-center">
                        <div className="title-smaller font-semibold text-black dark:text-white">
                            {data?.me?.username}
                        </div>

                        <div onClick={logout} className="btn-underline">
                            Logout
                        </div>
                    </div>
                )}

                {isLoggedIn === false && (
                    <div className="flex flex-row space-x-6 items-center">
                        <Link href="/login">
                            <div className="btn-underline">Login</div>
                        </Link>

                        <Link href="/register">
                            <div className="btn-underline">Register</div>
                        </Link>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Navbar;
