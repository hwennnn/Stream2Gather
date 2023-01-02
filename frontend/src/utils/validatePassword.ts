export const validatePassword = (password: string): boolean => {
  // min 8 letter password, with at least a symbol,
  // upper and lower case letters and a number
  const passwordReg = /^(?=.*\d)(?=.*[!@#$%^&*])(?=.*[a-z])(?=.*[A-Z]).{8,}$/;

  return password.length <= 30 && passwordReg.test(password);
};

interface ValidateFormPasswordArgs {
  password: string;
  validateComplexity?: boolean;
}

export const validateFormPassword = ({
  password,
  validateComplexity = true
}: ValidateFormPasswordArgs): string | undefined => {
  if (password === '') {
    return 'Required';
  } else if (validateComplexity && !validatePassword(password)) {
    return 'Invalid password. Must be at least 8 characters long, with at least a symbol, upper and lower case letters and a number';
  } else {
    return undefined;
  }
};
