import { FC } from 'react';
import { SiGithub } from 'react-icons/si';

type GithubSocialButtonProps = {
  title?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const GithubSocialButton: FC<GithubSocialButtonProps> = ({
  title,
  ...props
}: GithubSocialButtonProps) => {
  return (
    <div
      {...props}
      className="flex flex-row bg-black cursor-pointer p-3 rounded-lg items-center"
    >
      <SiGithub className="text-2xl" color="white" />
      <span className="-ml-5 flex-1 font-medium title-smaller text-white text-center">
        {title ?? 'Sign up with Github'}
      </span>
    </div>
  );
};

export default GithubSocialButton;
