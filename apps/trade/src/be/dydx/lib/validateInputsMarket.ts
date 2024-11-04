import { isNumber, numberOrZero } from '@src/lib/numbers'
import { MarketOrderInput, MarketOrderOutput } from '../types'

export const validateInputsMarket = (
  input: MarketOrderInput,
  output: MarketOrderOutput
): void => {
  input.dollars = Math.abs(numberOrZero(input.dollars))
  if (!input.ticker || !input.side || !input.dollars) {
    output.error = 'bad input: !ticker | !side | !dollars'
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
