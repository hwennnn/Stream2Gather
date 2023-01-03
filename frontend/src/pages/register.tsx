import { registerWithEmailPassword } from '@app/auth/firebaseAuth';
import OAuthButtonGroup from '@app/components/auth/OAuthButtonGroup';
import { PasswordField } from '@app/components/auth/PasswordField';
import Layout from '@app/components/common/layouts/Layout';
import { Logo } from '@app/components/common/Logo';
import { MeQueryKey } from '@app/constants/query';
import { useRegisterMutation } from '@app/generated/graphql';
import { validateFormEmail } from '@app/utils/validateEmail';
import { validateFormPassword } from '@app/utils/validatePassword';
import { validateFormUsername } from '@app/utils/validateUsername';
import {
  Box,
  Button,
  Container,
  Divider,
  FormControl,
  FormLabel,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
  useBreakpointValue,
  useColorModeValue,
  useToast
} from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { FormikErrors, useFormik } from 'formik';
import { NextPage } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

interface RegisterFormValues {
  username: string;
  email: string;
  password: string;
}

const Register: NextPage = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const { mutateAsync } = useRegisterMutation({});

  const invalidateMeQueryAndRedirect = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: MeQueryKey
    });

    await router.push('/');
  };

  useEffect(() => {
    if (toastMessage !== null) {
      toast({
        title: 'Error encountered during login',
        description: toastMessage,
        status: 'error',
        duration: 4000,
        isClosable: true
      });
    }
  }, [toast, toastMessage]);

  const formik = useFormik<RegisterFormValues>({
    initialValues: {
      username: '',
      email: '',
      password: ''
    },
    onSubmit: async (values, { setSubmitting }) => {
      setToastMessage(null);

      const { email, password, username } = values;

      try {
        const token = await registerWithEmailPassword({
          email,
          password
        });

        await mutateAsync({
          options: {
            token,
            email,
            username
          }
        });

        setSubmitting(false);

        await invalidateMeQueryAndRedirect();
      } catch (error: any) {
        setToastMessage(error.message);
      }
    },
    validate: (values) => {
      const errors: FormikErrors<RegisterFormValues> = {};

      const usernameValidation = validateFormUsername(values.username);
      if (usernameValidation !== undefined) {
        errors.username = usernameValidation;
      }

      const emailValidation = validateFormEmail(values.email);
      if (emailValidation !== undefined) {
        errors.email = emailValidation;
      }

      const passwordValidation = validateFormPassword({
        password: values.password
      });
      if (passwordValidation !== undefined) {
        errors.password = passwordValidation;
      }

      return errors;
    }
  });

  return (
    <Layout title="Register">
      <Container
        maxW="lg"
        py={{ base: '12', md: '24' }}
        px={{ base: '0', sm: '8' }}
      >
        <Stack spacing="8">
          <Stack spacing="6">
            <Logo />
            <Stack spacing={{ base: '2', md: '3' }} textAlign="center">
              <Heading size={useBreakpointValue({ base: 'xs', md: 'sm' })}>
                Create an account
              </Heading>
              <HStack spacing="1" justify="center">
                <Text color="muted">{'Already have an account?'}</Text>
                <Link href="/login">
                  <Button variant="link" colorScheme="blue">
                    Log in
                  </Button>
                </Link>
              </HStack>
            </Stack>
          </Stack>
          <Box
            py={{ base: '0', sm: '8' }}
            px={{ base: '4', sm: '10' }}
            bg={useBreakpointValue({ base: 'transparent', sm: 'bg-surface' })}
            boxShadow={{ base: 'none', sm: useColorModeValue('md', 'md-dark') }}
            borderRadius={{ base: 'none', sm: 'xl' }}
          >
            <form onSubmit={formik.handleSubmit}>
              <Stack spacing="6">
                <Stack spacing="5">
                  <FormControl>
                    <FormLabel htmlFor="username">Name</FormLabel>
                    <Input
                      id="username"
                      name="username"
                      type="username"
                      placeholder="Saul Goodman"
                      onChange={formik.handleChange}
                      value={formik.values.username}
                    />
                    <Text mt={2} color="error">
                      {formik.errors.username}
                    </Text>
                  </FormControl>
                  <FormControl>
                    <FormLabel htmlFor="email">Email</FormLabel>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="name@gmail.com"
                      onChange={formik.handleChange}
                      value={formik.values.email}
                    />
                    <Text mt={2} color="error">
                      {formik.errors.email}
                    </Text>
                  </FormControl>
                  <PasswordField
                    aria-errormessage={formik.errors.password}
                    placeholder="********"
                    onChange={formik.handleChange}
                    value={formik.values.password}
                  />
                </Stack>

                <Stack spacing="6">
                  <Button
                    isLoading={formik.isSubmitting}
                    type="submit"
                    variant="primary"
                  >
                    Create Account
                  </Button>
                  <HStack>
                    <Divider />
                    <Text fontSize="sm" whiteSpace="nowrap" color="muted">
                      or continue with
                    </Text>
                    <Divider />
                  </HStack>
                  <OAuthButtonGroup />
                </Stack>
              </Stack>
            </form>
          </Box>
        </Stack>
      </Container>
    </Layout>
  );
};

export default Register;
