export const validateEmail = (email: string): boolean => {
  const emailReg = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(.\w\w+)+$/;

  return emailReg.test(email);
};

export const validateFormEmail = (email: string): string | undefined => {
  if (email === '') {
    return 'Required';
  } else if (!validateEmail(email)) {
    return 'Invalid email address';
  } else {
    return undefined;
  }
};
