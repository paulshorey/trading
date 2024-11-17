'use client'

import classes from './Histogram.module.scss'
import { CenterVertical } from '@src/fe/containers/CenterVertical'

export function Histogram({
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
    <div className={classes.histogramContainer}>
      {asks?.map((ask: number, i: number) => (
        <div
          key={i}
          data-side="ask"
          className={classes.histogramBarContainer}
          style={{
            width: ((ask - min) / diff) * 100 + '%',
          }}
        >
          <div
            data-side="ask"
            className={classes.histogramBarContent}
            style={{
              opacity: (sizes[ask] - minSizeAsk) / sizeDiffAsk,
            }}
          >
            <span className={classes.priceFloatingLabel}>
              <span>{ask.toPrecision(4)}</span>
            </span>
          </div>
        </div>
      ))}
      <div
        data-side="oracle"
        className={classes.histogramBarContainer}
        style={{ width: ((price - min) / diff) * 100 + '%' }}
      >
        <div data-side="oracle" className={classes.histogramBarContent}>
          {/* <span>NEAR</span> */}
          <span className={classes.priceFloatingLabel}>
            <span>{price.toPrecision(4)}</span>
          </span>
        </div>
      </div>
      {bids?.map((bid: number, i: number) => (
        <div
          key={i}
          data-side="bid"
          className={classes.histogramBarContainer}
          style={{
            width: ((bid - min) / diff) * 100 + '%',
          }}
        >
          <div
            data-side="bid"
            className={classes.histogramBarContent}
            style={{
              opacity: (sizes[bid] - minSizeBid) / sizeDiffBid,
            }}
          >
            <span className={classes.priceFloatingLabel}>
              <span>{bid.toPrecision(4)}</span>
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}
