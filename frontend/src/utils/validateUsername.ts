export const validateUsername = (username: string): boolean => {
  return username.length >= 3 && username.length <= 20;
};

export const validateFormUsername = (username: string): string | undefined => {
  if (username === '') {
    return 'Required';
  } else if (!validateUsername(username)) {
    return 'Invalid username. Must be between 3 and 20 characters long';
  } else {
    return undefined;
  }
};
