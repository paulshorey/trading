import { isNumber } from '../../../lib/numbers'
import { MarketOrderInput } from '@/dydx/types'

export const parseOrdersText = function (text: string): MarketOrderInput[] {
  const trades: MarketOrderInput[] = []
  text = text.trim()
  const arr = text.split(/\s+/)
  for (let str of arr) {
    let trade = {} as MarketOrderInput
    let split = str.split(':') as Array<string | number>
    // ticker
    if (typeof split[0] === 'string') trade.ticker = split[0].toUpperCase() + '-USD'
    // position
    let num = Number(split[1])
    if (isNumber(num)) {
      trade.position = num
    }
    // stoploss
    let sl = Number(split[2])
    if (isNumber(sl)) {
      if (sl >= 0.1 && sl <= 10) trade.sl = sl
    }
    if (trade.ticker && trade.position !== undefined) {
      trades.push(trade)
    }
  }
  return trades
}
