import { useState } from 'react';
import { Icon } from './Icon';

/** A video thumbnail, with a placeholder when there isn't one or it won't load. */
export const Thumb = ({ src, className = '' }: { src: string; className?: string }) => {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={`flex aspect-video shrink-0 items-center justify-center bg-raised text-muted ${className}`}>
        <Icon name="film" className="size-5" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      className={`aspect-video shrink-0 bg-raised object-cover ${className}`}
    />
  );
};
