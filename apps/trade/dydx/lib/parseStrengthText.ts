import { StrengthRowAdd } from '@apps/common/sql/strength'

/**
 * Parses strength data from text format: key=value key=value
 * TradingView message: ticker={{ticker}} interval={{interval}} time={{time}} timenow={{timenow}} strength={{plot("strength")}} price={{price}} volume={{volume}}
 * The strength value is saved to the column that matches the interval value
 */
export function parseStrengthText(bodyText: string) {
  const data = {} as StrengthRowAdd

  // Split by spaces and parse key=value pairs
  const pairs = bodyText.trim().split(/\s+/)
  let strengthValue: number | null = null
  let intervalValue: string | null = null

  for (const pair of pairs) {
    const [key, value] = pair.split('=')
    if (key && value !== undefined) {
      if (key === 'ticker') {
        data.ticker = value !== '{{ticker}}' ? value : null
      } else if (key === 'time') {
        if (value) {
          const parsed = new Date(value)
          data.time = isNaN(parsed.getTime()) ? null : parsed
        } else {
          data.time = null
        }
      } else if (key === 'timenow') {
        if (value) {
          const parsed = new Date(value)
          data.timenow = isNaN(parsed.getTime()) ? null : parsed
        } else {
          data.timenow = null
        }
      } else if (key === 'price') {
        const num = parseFloat(value)
        data.price = !isNaN(num) ? num : null
      } else if (key === 'strength') {
        const num = parseFloat(value)
        strengthValue = !isNaN(num) ? num : null
      } else if (key === 'interval') {
        intervalValue = value !== '{{interval}}' ? value : null
      } else if (key === 'volume') {
        const num = parseFloat(value)
        data.volume = !isNaN(num) ? num : null
      }
    }
  }

  if (strengthValue !== null && intervalValue !== null) {
    // @ts-ignore
    data[intervalValue] = strengthValue
  }

  return data
}
