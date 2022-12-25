/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme')

module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      'xxs': "250px",
      'xs': "320px",
      's': '475px',
      ...defaultTheme.screens,
    },
    extend: {
      colors: {
        'primary': '#32374c',
        'secondary': '#4A72D5',
        'secondary-dark': '#82aaff',
        'tertiary': '#929ac9',
        "github-black": "#323332",
      },
      fontFamily: {
        'mont': "Montserrat",
      },
      screens: {
        '3xl': '1800px',
        '4xl': '2100px',
        'tablet': '640px',
        // => @media (min-width: 640px) { ... }
        'laptop': '1024px',
        // => @media (min-width: 1024px) { ... }
        'desktop': '1280px',
        // => @media (min-width: 1280px) { ... }
        'phone': '320px'
        // => @media (min-width: 320px) { ... }
      },
    },
  },
  plugins: [],
}