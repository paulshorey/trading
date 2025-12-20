export const CHART_WIDTH_INITIAL = 2400
export const HOURS_BACK_INITIAL = 240

/**
 * Chart color palette
 * - Main series (strength, price) are more prominent
 * - Individual series (_i suffix) are lighter/transparent for background context
 */
export const COLORS = {
  // Main aggregated lines
  strength: 'hsl(35 100% 50%)', // Orange
  // price: 'hsl(275 85% 70%)', // Purple
  price: 'hsl(233 100% 75%)', // Blue
  neutral: '#B5B5B566', // Gray

  // Individual lines (lighter versions)
  strength_i: 'hsla(35 100% 50% / 0.67)', // Orange transparent
  // price_i: 'hsla(275 85% 70% / 0.5)', // Purple transparent
  price_i: 'hsla(233 100% 75% / 0.67)', // Blue transparent
  neutral_i: '#CDCCC835',
}
