const FAR = { top: 640, size: 11, pitch: 88, from: -40 };
const NEAR = { top: 735, size: 16, pitch: 128, from: -96 };
const SEATS_ACROSS = 20;

const Row = ({ top, size, pitch, from }: typeof FAR) =>
  Array.from({ length: SEATS_ACROSS }, (_, index) => <use key={index} href="#dark-room-seat" transform={`translate(${from + index * pitch} ${top}) scale(${size})`} />);

/** The lights are down and nothing's on: a dim screen, and the backs of the seats in front of it. */
export const DarkRoom = () => (
  <svg aria-hidden="true" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" className="dark-room">
    <defs>
      <path id="dark-room-seat" d="M0 16V3.5a3.5 3.5 0 0 1 7 0V16z" />
    </defs>
    <rect x="340" y="72" width="920" height="518" rx="8" className="dark-room-screen" />
    <g className="dark-room-far">
      <rect y="760" width="1600" height="140" />
      <Row {...FAR} />
    </g>
    <g className="dark-room-near">
      <Row {...NEAR} />
    </g>
  </svg>
);
