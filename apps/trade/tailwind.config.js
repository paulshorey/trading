const baseConfig = require('@repo/config/tailwind/base')

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './dydx/**/*.{js,ts,jsx,tsx,mdx}',
    './fe/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
    '../data/fe/**/*.{js,ts,jsx,tsx,mdx}'
  ],
}