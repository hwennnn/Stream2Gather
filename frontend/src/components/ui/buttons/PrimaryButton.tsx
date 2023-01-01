import { Button } from '@chakra-ui/react';
import { FC, useState } from 'react';

interface ButtonProps {
  title: string;
  onClick?: () => Promise<void>;
}

export const PrimaryButton: FC<ButtonProps> = ({ title, onClick }) => {
  const [isButtonLoading, setButtonLoading] = useState(false);

  const handleClick = async (): Promise<void> => {
    setButtonLoading(true);
    if (onClick !== undefined) {
      await onClick();
    }
    setButtonLoading(false);
  };

  return (
    <Button
      colorScheme="blue"
      isLoading={isButtonLoading}
      onClick={handleClick}
    >
      {title}
    </Button>
  );
};
