/** The end of a language tag, as a hint of where someone is. The server ignores anything but a region. */
export const viewerRegion = (language: string) => language.split('-').pop() ?? '';
