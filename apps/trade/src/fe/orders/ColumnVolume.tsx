'use client'

import classes from './ColumnVolume.module.scss'
import { CenterVertical } from '@src/fe/containers/CenterVertical'
import { asksAndBids, summary } from './types'
import { log001 } from '@src/lib/numbers'
import { executeImmediateLimit } from '../../be/dydx/executeImmediateLimit'
import { executeImmediateReduce } from '../../be/dydx/executeImmediateReduce'

function xvol(x: number) {
  if (x <= 0) return 'x0'
  if (x <= 0.001) return 'x1'
  if (x <= 0.01) return 'x2'
  if (x <= 0.5) return 'x3'
  return 'x4'
}

export function VolumeColumn({
  summary,
  asksAndBids,
  initialPrice,
  initialTime,
  buyDollars,
  sellDollars,
  primarilyBuy,
}: {
  summary: summary
  asksAndBids: asksAndBids
  initialPrice: number
  initialTime: number
  buyDollars: number
  sellDollars: number
  primarilyBuy: boolean
}) {
  let {
    // minPrice: min,
    // maxPrice: max,
    asks,
    bids,
    sizes,
    minSize,
    maxSize,
  } = asksAndBids
  // let diff = max - min
  let sizeDiff = maxSize - minSize
  if (!asks || !bids) {
    return <div>no data</div>
  }
  return (
    <CenterVertical className={classes.centerVerticalContainer}>
      <div className={classes.ladder}>
        {asks.map((ask: number, i: number) => {
          const per1 = Math.abs((ask / summary.price - 1) * 100)
          return (
            <div
              key={i}
              data-side="ask"
              data-initialprice={
                // equals initial price
                (initialPrice >= ask &&
                  asks[i - 1] &&
                  initialPrice < (asks[i - 1] as number)) ||
                // between initial and current price
                (ask <= initialPrice && ask > summary.price)
              }
              data-xvol={xvol((sizes[ask] - minSize) / sizeDiff)}
              className={classes.step}
              onClick={() => {
                if (primarilyBuy) {
                  executeImmediateLimit({
                    ticker: summary.ticker,
                    side: 'LONG',
                    size: buyDollars / ask,
                    price: ask,
                  })
                } else {
                  executeImmediateReduce({
                    ticker: summary.ticker,
                    side: 'LONG',
                    size: buyDollars / ask,
                    price: ask,
                  })
                }
              }}
            >
              <div>
                <div>
                  <span>{ask.toFixed(summary.decimals)}</span>
                </div>
                <div>{per1.toFixed(2)}%</div>
                <div>${((per1 / 100) * 100).toFixed(2)}</div>
              </div>
            </div>
          )
        })}
        <div
          data-side="oracle"
          data-initialprice={
            initialPrice < (asks[asks.length - 1] as number) &&
            initialPrice > (bids[0] as number)
          }
          className={classes.step}
        >
          <div>
            <div>
              <span>{summary.price.toFixed(summary.decimals)}</span>
            </div>
            <div>{Math.ceil((Date.now() - initialTime) / 1000)}s</div>
          </div>
        </div>
        {bids?.map((bid: number, i: number) => {
          const per1 = Math.abs((bid / summary.price - 1) * 100)
          return (
            <div
              key={i}
              data-side="bid"
              data-initialprice={
                // equals initial price
                (initialPrice <= bid &&
                  bids[i + 1] &&
                  initialPrice > (bids[i + 1] as number)) ||
                // between initial and current price
                (bid >= initialPrice && bid < summary.price)
              }
              className={classes.step}
              data-xvol={xvol((sizes[bid] - minSize) / sizeDiff)}
              onClick={() => {
                if (primarilyBuy) {
                  executeImmediateReduce({
                    ticker: summary.ticker,
                    side: 'SHORT',
                    size: sellDollars / bid,
                    price: bid,
                  })
                } else {
                  executeImmediateLimit({
                    ticker: summary.ticker,
                    side: 'SHORT',
                    size: sellDollars / bid,
                    price: bid,
                  })
                }
              }}
            >
              <div>
                <div>
                  <span>{bid.toFixed(summary.decimals)}</span>
                </div>
                <div>{per1.toFixed(2)}%</div>
                <div>${((per1 / 100) * 100).toFixed(2)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </CenterVertical>
  )
}
