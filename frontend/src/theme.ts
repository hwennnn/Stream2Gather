import { extendTheme } from '@chakra-ui/react';
import { mode } from '@chakra-ui/theme-tools';

const theme = extendTheme({
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false
  },
  fonts: {
    heading: 'Inter',
    body: "'Montserrat', sans-serif"
  },
  colors: {
    primary: '#32374c',
    secondary: '#4A72D5',
    secondaryDark: '#82aaff',
    tertiary: '#929ac9',
    githubBlack: '#323332'
  },
  styles: {
    global: (props: Record<string, any>) => ({
      body: {
        color: mode('gray.800', 'whiteAlpha.900')(props),
        bg: mode('white', 'primary')(props),
        lineHeight: 'base'
      }
    })
  }
});

export default theme;
