import { useQueryClient } from '@tanstack/react-query';
import { ErrorMessage, Field, Form, Formik, FormikErrors } from 'formik';
import { NextPage } from 'next';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import {
  loginWithEmailPassword,
  signInWithGithub,
  signInWithGoogle
} from '../auth/firebaseAuth';
import GithubSocialButton from '../components/common/buttons/GithubSocialButton';
import GoogleSocialButton from '../components/common/buttons/GoogleSocialButton';
import Layout from '../components/common/Layout';
import LoadingSpinner from '../components/common/loading/LoadingSpinner';
import { MeQueryKey } from '../constants/query';
import { useAuth } from '../contexts/AuthContext';
import { useLoginMutation, useSocialLoginMutation } from '../generated/graphql';
import { validateFormEmail } from '../utils/validateEmail';
import { validateFormPassword } from '../utils/validatePassword';

interface LoginFormValues {
  email: string;
  password: string;
}

const Login: NextPage = () => {
  const { user } = useAuth();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  const initialValues: LoginFormValues = {
    email: '',
    password: ''
  };

  const { mutateAsync } = useLoginMutation({});

  const socialLogin = useSocialLoginMutation({});

  useEffect(() => {
    if (user !== null && user !== undefined) {
      void router.push('/');
    }
  });

  const invalidateMeQueryAndRedirect = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: MeQueryKey
    });

    await router.push('/');
  };

  const loginWithGoogle = async (): Promise<void> => {
    try {
      setErrorMessage(null);
      const { userToken, username, email } = await signInWithGoogle();
      console.log(username, email);

      await socialLogin.mutateAsync({
        options: {
          token: userToken,
          email,
          username
        }
      });

      await invalidateMeQueryAndRedirect();
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  const loginWithGithub = async (): Promise<void> => {
    try {
      setErrorMessage(null);
      const { userToken, username, email } = await signInWithGithub();
      console.log(username, email);

      await socialLogin.mutateAsync({
        options: {
          token: userToken,
          email,
          username
        }
      });

      await invalidateMeQueryAndRedirect();
    } catch (error: any) {
      setErrorMessage(error.message);
    }
  };

  return (
    <Layout title="Login">
      <div className="max-w-xl mx-auto p-6">
        <h1 className="mt-10 title-larger font-bold text-gray-900 dark:text-white">
          Login
        </h1>

        <Formik
          initialValues={initialValues}
          validate={(values) => {
            const errors: FormikErrors<LoginFormValues> = {};

            const emailValidation = validateFormEmail(values.email);
            if (emailValidation !== undefined) {
              errors.email = emailValidation;
            }

            const passwordValidation = validateFormPassword({
              password: values.password,
              validateComplexity: false
            });
            if (passwordValidation !== undefined) {
              errors.password = passwordValidation;
            }

            return errors;
          }}
          onSubmit={async (values, { setSubmitting }) => {
            setErrorMessage(null);

            const { email, password } = values;

            try {
              const token = await loginWithEmailPassword({
                email,
                password
              });

              await mutateAsync({
                options: {
                  token
                }
              });

              setSubmitting(false);

              await invalidateMeQueryAndRedirect();
            } catch (error: any) {
              setErrorMessage(error.message);
            }
          }}
        >
          {({ isSubmitting }) => (
            <Form className="mt-10">
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
                  placeholder="********"
                />
                <ErrorMessage
                  name="password"
                  component="div"
                  className="mt-1 text-red-500 title-smaller"
                />
              </div>

              <button
                type="submit"
                className="btn-blue mx-auto w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? <LoadingSpinner /> : 'Submit'}
              </button>

              {errorMessage !== null && (
                <>
                  <div className="mt-1 text-red-500 title-smaller">
                    {errorMessage}
                  </div>
                </>
              )}

              <div className="flex flex-row h-2 mt-6 items-center">
                <div className="flex-[4] h-[1px] bg-white"></div>
                <div className="flex-1 text-center font-semibold text-white">
                  Or
                </div>
                <div className="flex-[4] h-[1px] bg-white"></div>
              </div>

              <div className="flex flex-col space-y-4 mt-6">
                <GoogleSocialButton
                  title="Sign in with Google"
                  onClick={async () => await loginWithGoogle()}
                />

                <GithubSocialButton
                  title="Sign in with Github"
                  onClick={async () => await loginWithGithub()}
                />
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </Layout>
  );
};

export default Login;
