import { isNumber, numberOrZero } from '@/lib/numbers'
import { MarketOrderOutput, MarketOrderInput } from '../types'

export const validateInputsMarket = (input: MarketOrderInput, output: MarketOrderOutput): void => {
  input.position = numberOrZero(input.position)
  if (!input.ticker || !isNumber(input.position)) {
    output.error = 'bad input: !ticker | !isNumber(position)'
    throw new Error(output.error)
  }
  if (!/[A-Z]-USD/.test(input.ticker)) {
    output.error = 'malformed input: ticker="' + input.ticker + '"'
    throw new Error(output.error)
  }
}
