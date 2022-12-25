import { useQueryClient } from "@tanstack/react-query";
import { ErrorMessage, Field, Form, Formik, FormikErrors } from "formik";
import { useRouter } from "next/router";
import { FC } from "react";
import Layout from "../components/Layout";
import LoadingSpinner from "../components/LoadingSpinner";
import { MeQueryKey } from "../constants/query";
import { useRegisterMutation } from "../generated/graphql";
import { validateFormEmail } from "../utils/validateEmail";
import { validateFormPassword } from "../utils/validatePassword";
import { validateFormUsername } from "../utils/validateUsername";

interface RegisterFormValues {
    email: string;
    password: string;
    username: string;
}

const Register: FC<{}> = () => {
    const queryClient = useQueryClient();
    const router = useRouter();

    const initialValues: RegisterFormValues = {
        email: "",
        password: "",
        username: "",
    };

    const { mutateAsync } = useRegisterMutation();

    return (
        <Layout title="Register">
            <div className="max-w-lg mx-auto">
                <h1 className="mt-10 title-larger font-bold text-gray-900 dark:text-white">
                    Register an Account
                </h1>

                <Formik
                    initialValues={initialValues}
                    validate={(values) => {
                        let errors: FormikErrors<RegisterFormValues> = {};

                        let usernameValidation = validateFormUsername(
                            values.username
                        );
                        if (usernameValidation !== undefined) {
                            errors.username = usernameValidation;
                        }

                        let emailValidation = validateFormEmail(values.email);
                        if (emailValidation !== undefined) {
                            errors.email = emailValidation;
                        }

                        let passwordValidation = validateFormPassword(
                            values.password
                        );
                        if (passwordValidation !== undefined) {
                            errors.password = passwordValidation;
                        }

                        return errors;
                    }}
                    onSubmit={async (values, { setSubmitting }) => {
                        console.log(values);
                        const result = await mutateAsync({
                            options: {
                                email: values.email,
                                username: values.username,
                            },
                        });
                        setSubmitting(false);
                        console.log(result.register);

                        queryClient.invalidateQueries({ queryKey: MeQueryKey });
                        router.push("/");
                    }}
                >
                    {({ isSubmitting }) => (
                        <Form className="mt-10">
                            <div className="mb-6">
                                <label
                                    htmlFor="email"
                                    className="block mb-2 title-small text-gray-900 dark:text-white"
                                >
                                    Your username
                                </label>
                                <Field
                                    className="bg-gray-50 border border-gray-300 text-gray-900 title-smaller rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                    type="username"
                                    name="username"
                                    placeholder="Saul Goodman"
                                />
                                <ErrorMessage
                                    name="username"
                                    component="div"
                                    className="mt-1 text-red-500 title-smaller"
                                />
                            </div>

                            <div className="mb-6">
                                <label
                                    htmlFor="email"
                                    className="block mb-2 title-small text-gray-900 dark:text-white"
                                >
                                    Your email
                                </label>
                                <Field
                                    className="bg-gray-50 border border-gray-300 text-gray-900 title-smaller rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                    type="email"
                                    name="email"
                                    placeholder="name@email.com"
                                />
                                <ErrorMessage
                                    name="email"
                                    component="div"
                                    className="mt-1 text-red-500 title-smaller"
                                />
                            </div>

                            <div className="mb-6">
                                <label
                                    htmlFor="password"
                                    className="block mb-2 title-small text-gray-900 dark:text-white"
                                >
                                    Your password
                                </label>
                                <Field
                                    className="bg-gray-50 border border-gray-300 text-gray-900 title-smaller rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500"
                                    type="password"
                                    name="password"
                                />
                                <ErrorMessage
                                    name="password"
                                    component="div"
                                    className="mt-1 text-red-500 title-smaller"
                                />
                            </div>

                            {/* <button className="btn-blue">
                                <LoadingSpinner />
                            </button> */}

                            <button
                                type="submit"
                                className={"btn-blue mx-auto"}
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? <LoadingSpinner /> : "Submit"}
                            </button>
                        </Form>
                    )}
                </Formik>
            </div>
        </Layout>
    );
};

export default Register;
