import { extendTheme, type ThemeConfig } from '@chakra-ui/react';
import { mode } from '@chakra-ui/theme-tools';

const config: ThemeConfig = {
  initialColorMode: 'dark',
  useSystemColorMode: false
};

const colors = {
  primary: '#32374c',
  secondary: '#4A72D5',
  secondaryDark: '#82aaff',
  tertiary: '#929ac9',
  githubBlack: '#323332'
};

const styles = {
  global: (props: Record<string, any>) => ({
    body: {
      color: mode('gray.800', 'whiteAlpha.900')(props),
      bg: mode('white', 'primary')(props),
      lineHeight: 'base'
    }
  })
};

const theme = extendTheme({ colors, config, styles });

export default theme;
