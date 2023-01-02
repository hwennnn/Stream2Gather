import { theme as proTheme } from '@chakra-ui/pro-theme';
import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme(
  {
    config: {
      initialColorMode: 'dark',
      useSystemColorMode: false
    },
    colors: {
      primary: '#32374c',
      secondary: '#4A72D5',
      secondaryDark: '#82aaff',
      tertiary: '#929ac9',
      githubBlack: '#323332',
      ...proTheme.colors,
      brand: proTheme.colors.blue
    }
  },
  proTheme
);

export default theme;
