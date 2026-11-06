/** Two seats on one row: yours, and the one you've saved. Drawn on a 16px grid so it stays sharp in a tab. */
export const Mark = ({ className = 'size-5' }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M0 11V5.5a3.5 3.5 0 0 1 7 0V11zM9 11V5.5a3.5 3.5 0 0 1 7 0V11zM11 9h3V5.5a1.5 1.5 0 0 0-3 0zM1 12h14a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1z"
    />
  </svg>
);
