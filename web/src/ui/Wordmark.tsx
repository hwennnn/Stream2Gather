import { Mark } from './Mark';

export const Wordmark = ({ className = '' }: { className?: string }) => (
  <span className={`inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] ${className}`}>
    <Mark />
    Stream2Gather
  </span>
);
