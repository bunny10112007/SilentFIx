/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#0B0D12',
        surface: {
          DEFAULT: 'rgba(255,255,255,0.03)',
          hover: 'rgba(255,255,255,0.06)',
          active: 'rgba(255,255,255,0.08)',
        },
        accent: {
          indigo: '#6366f1',
          violet: '#8b5cf6',
          cyan: '#22d3ee',
        },
      },
      borderColor: {
        glass: 'rgba(255,255,255,0.08)',
        'glass-hover': 'rgba(255,255,255,0.14)',
      },
      backdropBlur: {
        glass: '16px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.4)',
        'glow-indigo': '0 0 20px rgba(99,102,241,0.15)',
        'glow-violet': '0 0 20px rgba(139,92,246,0.15)',
        'glow-emerald': '0 0 20px rgba(16,185,129,0.15)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { opacity: '0.5' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
