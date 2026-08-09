import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        /* ─── SREonCall Brand ─── */
        brand: {
          DEFAULT: '#FF6B2B',
          400: '#FF8F4F',
          600: '#E85D1C',
        },
        navy: {
          900: '#0D1117',
          800: '#1E3A5F',
          surface: '#161B22',
          elevated: '#1E293B',
          overlay: '#334155',
        },
        success: '#16A34A',
        warning: '#EAB308',
        error: '#DC2626',
        info: '#2563EB',
        ai: '#7C3AED',
        /* Priority colors */
        'p1': '#DC2626',
        'p2': '#EA580C',
        'p3': '#EAB308',
        'p4': '#2563EB',
        'p5': '#94A3B8',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        'ds-sm': '0 2px 8px rgba(0,0,0,0.08)',
        'ds-md': '0 4px 16px rgba(0,0,0,0.12)',
        'ds-lg': '0 8px 24px rgba(0,0,0,0.20)',
      },
      width: {
        'sidebar': '250px',
      },
      height: {
        'topbar': '50px',
      },
    },
  },
  plugins: [],
};

export default config;
