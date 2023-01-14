import dateFormat, { masks } from 'dateformat';

export const formatMsToMinutesSeconds = (ms: string): string => {
  const date = new Date(parseInt(ms));
  return dateFormat(date, masks.shortTime);
};
