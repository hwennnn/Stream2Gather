/** The lights are down and nothing's on: a dim screen, and the backs of the seats in front of it. */
export const DarkRoom = () => (
  <svg aria-hidden="true" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="dark-room">
    <rect x="340" y="72" width="920" height="518" rx="8" className="dark-room-screen" />
    <g className="dark-room-far">
      <rect y="760" width="1600" height="140" />
      <path d={`M-40 900${'v-221.5a38.5 38.5 0 0 1 77 0v221.5zm88 0'.repeat(20)}`} />
    </g>
    <path d={`M-96 900${'v-109a56 56 0 0 1 112 0v109zm128 0'.repeat(14)}`} className="dark-room-near" />
  </svg>
);
