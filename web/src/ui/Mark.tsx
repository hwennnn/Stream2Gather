/** A screen, and two people in front of it. */
export const Mark = ({ className = 'size-5' }: { className?: string }) => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className={className}>
    <rect x="1" y="2" width="18" height="9" rx="1.5" fill="currentColor" />
    <circle cx="6" cy="15.5" r="3.5" fill="#e0a884" />
    <circle cx="14" cy="15.5" r="3.5" fill="#72bdd0" />
  </svg>
);
