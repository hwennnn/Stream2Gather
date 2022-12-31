import { FC, useState } from 'react';
import LoadingSpinner from '../loading/LoadingSpinner';

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
    <div
      className="w-max bg-secondary hover:bg-opacity-50 cursor-pointer px-4 py-3 rounded-lg"
      onClick={handleClick}
    >
      {isButtonLoading ? (
        <LoadingSpinner />
      ) : (
        <span className="flex font-medium title-smaller text-white justify-center">
          {title}
        </span>
      )}
    </div>
  );
};
