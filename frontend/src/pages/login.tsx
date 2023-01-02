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
import { loginWithEmailPassword } from '../auth/firebaseAuth';
import Layout from '../components/Layout';
import OAuthButtonGroup from '../components/templates/auth/OAuthButtonGroup';
import { PasswordField } from '../components/templates/auth/PasswordField';
import { Logo } from '../components/ui/Logo';
import { MeQueryKey } from '../constants/query';
import { useLoginMutation } from '../generated/graphql';
import { validateFormEmail } from '../utils/validateEmail';
import { validateFormPassword } from '../utils/validatePassword';

interface LoginFormValues {
  email: string;
  password: string;
}

interface LoginToastMessage {
  title: string;
  description: string;
  status: 'error' | 'success';
}

const Login: NextPage = () => {
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [toastMessage, setToastMessage] = useState<LoginToastMessage | null>(
    null
  );
  const { mutateAsync } = useLoginMutation({});

  const invalidateMeQueryAndRedirect = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: MeQueryKey
    });

    await router.push('/');
  };

  useEffect(() => {
    if (toastMessage !== null) {
      toast({
        title: toastMessage.title,
        description: toastMessage.description,
        status: toastMessage.status,
        duration: toastMessage.status === 'error' ? 4000 : 2000,
        isClosable: true
      });
    }
  }, [toast, toastMessage]);

  const formik = useFormik<LoginFormValues>({
    initialValues: {
      email: '',
      password: ''
    },
    onSubmit: async (values, { setSubmitting }) => {
      setToastMessage(null);

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
        setToastMessage({
          title: 'Error encountered during login',
          description: error.message,
          status: 'error'
        });
      }
    },
    validate: (values) => {
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
    }
  });

  return (
    <Layout title="Login">
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
                Log in to your account
              </Heading>
              <HStack spacing="1" justify="center">
                <Text color="muted">{"Don't have an account?"}</Text>
                <Link href="/register">
                  <Button variant="link" colorScheme="blue">
                    Register
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

                <HStack justify="space-between">
                  {/* <Checkbox defaultChecked>Remember me</Checkbox> */}
                  <Button variant="link" colorScheme="blue" size="sm">
                    Forgot password?
                  </Button>
                </HStack>

                <Stack spacing="6">
                  <Button
                    isLoading={formik.isSubmitting}
                    type="submit"
                    variant="primary"
                  >
                    Sign in
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

export default Login;
