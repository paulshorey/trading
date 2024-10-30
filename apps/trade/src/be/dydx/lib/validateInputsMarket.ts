import { isNumber, numberOrZero } from '@src/lib/numbers'
import { MarketOrderProps, MarketOrderOutput } from '../types'

export const validateInputsMarket = (
  input: MarketOrderProps,
  output: MarketOrderOutput
): void => {
  input.dollar = Math.abs(numberOrZero(input.dollar))
  if (!input.ticker || !input.side || !input.dollar) {
    output.error = 'bad input: !ticker | !side | !dollar'
    throw new Error(output.error)
  }
  if (!/[A-Z]-USD/.test(input.ticker)) {
    output.error = 'malformed input: ticker="' + input.ticker + '"'
    throw new Error(output.error)
  }
  if (input.side !== 'SHORT' && input.side !== 'LONG') {
    output.error = 'malformed input: side="' + input.side + '"'
    throw new Error(output.error)
  }
}
