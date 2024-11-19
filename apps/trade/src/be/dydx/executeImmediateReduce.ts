'use server'

import { catchError } from '@src/be/dydx/lib/catchError'
import Dydx from '.'
import { MarketOrderOutput } from './types'
import { cc } from '@my/be/cc'

type Input = {
  ticker: string
  size: number
  side: 'LONG' | 'SHORT'
  price: number
}

export const executeImmediateReduce = async (
  input: Input
): Promise<MarketOrderOutput> => {
  'use server'
  const output = {} as unknown as MarketOrderOutput
  cc.log(
    `executeImmediateReduce ${input.ticker} ${input.side} ${input.size} ${input.price}`,
    input
  )
  try {
    /*
     * Connection
     */
    const dydx = new Dydx()
    // wait for dydx.init()
    await new Promise((resolve) =>
      setTimeout(async () => {
        resolve(true)
      }, 250)
    )

    /*
     * Execute order
     */
    await dydx.orderReduce({
      ticker: input.ticker,
      side: input.side,
      coins: Math.abs(input.size),
      price: input.price,
      x1: 0.005,
    })

    // @ts-ignore
  } catch (err: Error) {
    catchError(err, { file: 'executeImmediateReduce' })
  }
  return output
}
