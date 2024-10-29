import { isNumber } from '../../lib/numbers'

type Output = {
  side: 'LONG' | 'SHORT'
  ticker: string
  dollar: number
  sl?: number
}

export const parseOrdersText = function (text: string): Output[] {
  const trades: Output[] = []
  text = text.trim()
  const arr = text.split(' ')
  for (let str of arr) {
    let t = {} as Output
    let p = str.split('-') as Array<string | number>
    if (p[0] === 'buy') t.side = 'LONG'
    if (p[0] === 'sell') t.side = 'SHORT'
    if (typeof p[1] === 'string') t.ticker = p[1].toUpperCase() + '-USD'
    p[2] = Number(p[2])
    if (isNumber(p[2]) && p[2] >= 10 && p[2] <= 1000) t.dollar = p[2]
    p[3] = Number(p[3])
    if (isNumber(p[3]) && p[3] > 0 && p[3] <= 5) t.sl = p[3]
    if (t.side && t.ticker && t.dollar) {
      trades.push(t)
    }
  }
  return trades
}
