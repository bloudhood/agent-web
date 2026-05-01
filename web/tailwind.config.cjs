const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{ts,svelte,html}'),
  ],
  darkMode: ['class', '[data-theme="washi-dark"]'],
  theme: {
    extend: {
      colors: {
        // semantic tokens — values come from CSS variables defined in design/tokens.css
        surface: {
          page: 'rgb(var(--rgb-surface-page) / <alpha-value>)',
          panel: 'rgb(var(--rgb-surface-panel) / <alpha-value>)',
          muted: 'rgb(var(--rgb-surface-muted) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--rgb-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--rgb-text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--rgb-text-muted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--rgb-accent) / <alpha-value>)',
          hover: 'rgb(var(--rgb-accent-hover) / <alpha-value>)',
          dim: 'rgb(var(--rgb-accent-dim) / <alpha-value>)',
        },
        state: {
          success: 'rgb(var(--rgb-success) / <alpha-value>)',
          danger: 'rgb(var(--rgb-danger) / <alpha-value>)',
          warning: 'rgb(var(--rgb-warning) / <alpha-value>)',
          info: 'rgb(var(--rgb-info) / <alpha-value>)',
        },
        border: 'rgb(var(--rgb-border) / <alpha-value>)',
      },
      fontFamily: {
        ui: ['Poppins', 'Arial', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        body: ['Lora', 'Georgia', 'PingFang SC', 'Microsoft YaHei', 'serif'],
        mono: ['SFMono-Regular', 'ui-monospace', 'Consolas', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
      boxShadow: {
        '1': 'var(--shadow-1)',
        '2': 'var(--shadow-2)',
        '3': 'var(--shadow-3)',
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
