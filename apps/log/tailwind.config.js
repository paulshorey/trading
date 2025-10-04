const baseConfig = require('@repo/config/tailwind/base')

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    './list/**/*.{js,ts,jsx,tsx,mdx}',
    '../data/fe/**/*.{js,ts,jsx,tsx,mdx}',
  ],
}