import { StrengthDataAdd } from '@lib/common/sql/strength/types'

/**
 * Parses strength data from text format: key=value key=value
 * TradingView message: ticker={{ticker}} interval={{interval}} time={{time}} strength={{plot("strength")}} price={{price}} volume={{volume}}
 * The strength value is saved to the column that matches the interval value
 */
export function parseStrengthText(bodyText: string) {
  const data = {} as StrengthDataAdd

  // Split by spaces and parse key=value pairs
  const pairs = bodyText.trim().split(/\s+/)

  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      if (key === 'ticker') {
        data.ticker = value !== '{{ticker}}' ? value : null
      } else if (key === 'interval') {
        data.interval = value !== '{{interval}}' ? value : null
      } else if (key === 'time') {
        if (value) {
          const parsed = new Date(value)
          data.time = isNaN(parsed.getTime()) ? null : parsed
        } else {
          data.time = null
        }
      } else if (key === 'price') {
        const num = parseFloat(value)
        data.price = !isNaN(num) ? num : null
      } else if (key === 'strength') {
        const num = parseFloat(value)
        data.strength = !isNaN(num) ? num : null
      } else if (key === 'volume') {
        const num = parseFloat(value)
        data.volume = !isNaN(num) ? num : null
      }
    }
  }

  return data
}
