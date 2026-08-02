globalThis.tailwind = globalThis.tailwind || {};

globalThis.tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#111319', background: '#111319', 'surface-lowest': '#0c0e13',
        'surface-low': '#191b21', 'surface-container': '#1e1f25',
        'surface-high': '#282a30', 'surface-highest': '#33353a',
        'on-surface': '#e2e2e9', 'on-surface-variant': '#bbcac5',
        outline: '#859490', 'outline-variant': '#3c4946',
        primary: '#b5fff0', 'primary-container': '#5eead4',
        secondary: '#cebdff', 'secondary-container': '#4f319c',
        tertiary: '#d5f7ff', 'tertiary-container': '#5ee6ff',
        error: '#ffb4ab', 'error-container': '#93000a',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body: ['Geist', 'sans-serif'],
        technical: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: { vessel: '2rem', control: '1.5rem' },
      boxShadow: {
        bloom: '0 0 40px rgba(94, 234, 212, 0.14)',
        violet: '0 0 44px rgba(79, 49, 156, 0.18)',
      },
    },
  },
};
