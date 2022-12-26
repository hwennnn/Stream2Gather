import React, { FC } from 'react';
import { FcGoogle } from 'react-icons/fc';

type GoogleSocialButtonProps = {
  title?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const GoogleSocialButton: FC<GoogleSocialButtonProps> = ({
  title,
  ...props
}: GoogleSocialButtonProps) => {
  return (
    <div
      {...props}
      className="flex flex-row bg-white hover:bg-gray-300 cursor-pointer p-3 rounded-lg items-center"
    >
      <FcGoogle className="text-2xl" />
      <span className="-ml-5 flex-1 font-medium title-smaller text-black text-center">
        {title ?? 'Sign up with Google'}
      </span>
    </div>
  );
};

export default GoogleSocialButton;
