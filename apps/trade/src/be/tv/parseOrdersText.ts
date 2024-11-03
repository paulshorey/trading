import { isNumber } from '../../lib/numbers'

type Output = {
  side: 'LONG' | 'SHORT'
  ticker: string
  dollars: number
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
    split[2] = Number(split[2])
    if (isNumber(split[2]) && split[2] >= 10 && split[2] <= 1000)
      trade.dollars = split[2]
    // stop loss | reduce
    let sl = Number(split[3])
    if (isNumber(sl)) {
      if (sl >= 0.1 && sl <= 5) trade.sl = sl
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
