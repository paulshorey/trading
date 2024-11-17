'use client'

import classes from './VolumeColumn.module.scss'
import { CenterVertical } from '@src/fe/containers/CenterVertical'

export function VolumeColumn({
  asksAndBids,
  price,
}: {
  asksAndBids: Record<string, any>
  price: number
}) {
  let {
    minPrice: min,
    maxPrice: max,
    asks,
    bids,
    sizes,
    minSizeBid,
    maxSizeBid,
    minSizeAsk,
    maxSizeAsk,
  } = asksAndBids
  let diff = max - min
  let sizeDiffBid = maxSizeBid - minSizeBid
  let sizeDiffAsk = maxSizeAsk - minSizeAsk
  return (
    <div className={classes.centerVerticalContainer}>
      <div className={classes.histogramContainer}>
        {asks?.map((ask: number, i: number) => (
          <div
            key={i}
            data-side="ask"
            className={classes.bar}
            style={{
              opacity: (sizes[ask] - minSizeAsk) / sizeDiffAsk,
            }}
          >
            <span>{ask.toPrecision(4)}</span>
          </div>
        ))}
        <div data-side="oracle" className={classes.bar}>
          <span>{price.toPrecision(4)}</span>
        </div>
        {bids?.map((bid: number, i: number) => (
          <div
            key={i}
            data-side="bid"
            className={classes.bar}
            style={{
              opacity: (sizes[bid] - minSizeBid) / sizeDiffBid,
            }}
          >
            <span>{bid.toPrecision(4)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
