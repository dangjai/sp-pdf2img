import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/noto-sans-thai/400.css';
import '@fontsource/noto-sans-thai/500.css';
import '@fontsource/noto-sans-thai/600.css';
import '@fontsource/noto-sans-thai/700.css';
import { createTheme, CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import './styles.css';

const theme = createTheme({
  palette: {
    primary: { main: '#194c42' },
    secondary: { main: '#b9653f' },
    background: { default: '#f6f7f4', paper: '#ffffff' },
    text: { primary: '#000000', secondary: '#000000' },
  },
  typography: {
    fontFamily: '"Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif',
    button: { textTransform: 'none', fontWeight: 600 },
    h6: { fontWeight: 700 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { color: '#000000', '&.Mui-disabled': { color: '#000000' } },
        contained: { backgroundColor: '#dfeee1', '&:hover': { backgroundColor: '#cbdccd' } },
      },
    },
    MuiAlert: { styleOverrides: { root: { color: '#000000' } } },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ThemeProvider theme={theme}><CssBaseline /><App /></ThemeProvider></React.StrictMode>,
);
