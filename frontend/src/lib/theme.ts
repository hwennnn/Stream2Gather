import { theme as proTheme } from '@chakra-ui/pro-theme';
import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme(
  {
    breakpoints: {
      sm: '30em',
      md: '48em',
      lg: '62em',
      xl: '80em',
      '2xl': '96em',
      '3xl': '120em'
    },
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
    },
    components: {
      Menu: {
        ...(proTheme.components?.Menu ?? {}),
        baseStyle: {
          ...(proTheme.components?.Menu?.baseStyle ?? {})
          // item: {
          //   _focus: { bg: 'gray.700' }
          // }
        }
      }
    }
  },
  proTheme
);

export default theme;
