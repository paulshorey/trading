import { cc } from '@my/be/cc'
import { isNumber, numberOrZero } from '../../../lib/numbers'

type Output = {
  side: 'LONG' | 'SHORT'
  ticker: string
  dollars: number
  dollarsMax: number
  sl?: number
  reduce?: boolean
}

export const parseOrdersText = function (text: string): Output[] {
  const trades: Output[] = []
  text = text.trim()
  const arr = text.split(/\s+/)
  for (let str of arr) {
    let trade = {} as Output
    let split = str.split(':') as Array<string | number>
    // side
    if (split[0] === 'buy' || split[0] === 'long') trade.side = 'LONG'
    if (split[0] === 'sell' || split[0] === 'short') trade.side = 'SHORT'
    // ticker
    if (typeof split[1] === 'string')
      trade.ticker = split[1].toUpperCase() + '-USD'
    // dollars amount
    let narr = split[2]?.toString().split('/')
    let num = numberOrZero(narr?.[0])
    if (isNumber(num) && num >= 1 && num <= 1000) trade.dollars = num
    // max dollars is required. If undefined will be 0 (reduce only)
    trade.dollarsMax = numberOrZero(narr?.[1])
    // stop loss | reduce
    let sl = Number(split[3])
    if (isNumber(sl)) {
      if (sl >= 0.1 && sl <= 10) trade.sl = sl
    } else {
      let reduce = split[3]
      if (reduce === 'reduce') trade.reduce = true
    }
    if (trade.side && trade.ticker && trade.dollars) {
      trades.push(trade)
    }
  }
  return trades
}
