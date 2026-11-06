export const formatTime = (seconds: number): string => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

const COLORS = ['#ff5a36', '#ffb020', '#3ddc97', '#4cc9f0', '#a78bfa', '#f472b6'];

export const avatarColor = (id: string): string => {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length] ?? '#ff5a36';
};

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

const URL_LIKE = /^(https?:\/\/|www\.|youtu\.be\/|youtube\.com\/)/i;

export const looksLikeUrl = (value: string): boolean => URL_LIKE.test(value.trim());

export const normalizeUrl = (value: string): string => {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
