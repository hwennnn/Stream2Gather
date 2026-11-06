import { useCallback, useEffect, useState } from 'react';

export const canFullscreen = () => document.fullscreenEnabled && !/iPhone|iPod/.test(navigator.userAgent);

export const useFullscreen = () => {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // YouTube's own fullscreen is the iframe's business, not this layout's.
    const update = () => setOn(document.fullscreenElement === document.documentElement);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const toggle = useCallback(() => {
    const change = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    void change.catch(() => {});
  }, []);

  return { on, toggle };
};
