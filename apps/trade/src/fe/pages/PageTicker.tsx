'use client'

import { Data } from '@src/fe/blocks/Data'
import { infoTicker } from '@src/be/dydx/infoTicker'
import { VolumeColumn } from '@src/fe/blocks/VolumeColumn'
import useSWR from 'swr'
import classes from './PageTicker.module.scss'
import { roundToCustomDecimal } from '@src/lib/numbers'

export const revalidate = 0

type Params = {
  ticker: string
}

export function PageTicker({ params }: { params: Params }) {
  const ticker = params.ticker
  const fetcher = async () => {
    return await infoTicker(ticker)
  }
  const { data, error, isLoading, isValidating } = useSWR(ticker, fetcher, {
    refreshInterval: 3000,
  })
  if (!data && isLoading) return <div>Loading...</div>
  if (!data && isValidating) return <div>Validating...</div>
  if (error) return <div>Failed to load ticker="{ticker}" data</div>

  const output = {
    summary: {},
    ...data,
  } as Record<string, any>
  // Summary
  output.summary.ticker = ticker
  output.summary.trades24H = output.market.trades24H
  output.summary.volume24H = parseInt(output.market.volume24H)
  output.summary.price = Number(output.market.oraclePrice)
  output.summary.priceChange24H = Number(
    Number(output.market.priceChange24H).toFixed(2)
  )
  output.summary.price = Number(output.summary.price.toFixed(2))
  output.summary.pip = Number(output.market.tickSize)
  // Asks And Bids
  if (output.asksAndBids) {
    let sizesRaw = {} as Record<number, any>
    let sizesLinear = {} as Record<number, any>
    let minPrice = Infinity
    let maxPrice = 0
    let minSizeLinear = Infinity
    let maxSizeLinear = 0
    let asksRaw = [] as number[]
    let bidsRaw = [] as number[]
    // asks
    if (output.asksAndBids?.asks.length) {
      output.asksAndBids?.asks.forEach((row: any, i: number) => {
        let price = Number(row.price)
        let size = Number(row.size)
        sizesRaw[row.price] = size
        asksRaw.push(price)
      })
    }
    asksRaw.sort((a, b) => b - a)
    // linear asks
    let asksLinear = [] as number[]
    let medianAsk = asksRaw[Math.ceil(asksRaw.length / 2)] as number
    let asksPip = roundToCustomDecimal(
      (medianAsk - output.summary.price) / 30,
      output.summary.pip,
      'up'
    )
    let toAsksPip = output.summary.price
    for (
      let askPrice = output.summary.price;
      askPrice <= medianAsk;
      askPrice += asksPip
    ) {
      askPrice = roundToCustomDecimal(askPrice, output.summary.pip, 'up')
      asksLinear.push(askPrice)
      while (toAsksPip <= askPrice) {
        if (sizesRaw[toAsksPip]) {
          sizesLinear[askPrice] = sizesLinear[askPrice]
            ? sizesLinear[askPrice] + sizesRaw[toAsksPip]
            : sizesRaw[toAsksPip]
        } else {
          sizesLinear[askPrice] = 0
        }
        toAsksPip += output.summary.pip
        toAsksPip = roundToCustomDecimal(toAsksPip, output.summary.pip, 'up')
      }
      const askSize = sizesLinear[askPrice]
      if (askPrice > maxPrice) maxPrice = askPrice
      if (askPrice < minPrice) minPrice = askPrice
      if (askSize > maxSizeLinear) maxSizeLinear = askSize
      if (askSize < minSizeLinear) minSizeLinear = askSize
    }
    asksLinear.reverse()
    // bids
    if (output.asksAndBids?.bids.length) {
      output.asksAndBids?.bids.forEach((row: any, i: number) => {
        let price = Number(row.price)
        let size = Number(row.size)
        sizesRaw[row.price] = size
        bidsRaw.push(price)
      })
    }
    bidsRaw.sort((a, b) => b - a)

    // linear bids
    let bidsLinear = [] as number[]
    let medianBid = bidsRaw[Math.floor(bidsRaw.length / 2)] as number
    let bidsPip = roundToCustomDecimal(
      (output.summary.price - medianBid) / 30,
      output.summary.pip,
      'down'
    )
    let toBidsPip = output.summary.price
    for (
      let bidPrice = output.summary.price;
      bidPrice >= medianBid;
      bidPrice -= bidsPip
    ) {
      bidPrice = roundToCustomDecimal(bidPrice, output.summary.pip, 'down')
      bidsLinear.push(bidPrice)
      while (toBidsPip >= bidPrice) {
        if (sizesRaw[toBidsPip]) {
          sizesLinear[bidPrice] = sizesLinear[bidPrice]
            ? sizesLinear[bidPrice] + sizesRaw[toBidsPip]
            : sizesRaw[toBidsPip]
        } else {
          sizesLinear[bidPrice] = 0
        }
        toBidsPip -= output.summary.pip
        toBidsPip = roundToCustomDecimal(toBidsPip, output.summary.pip, 'down')
      }
      const bidSize = sizesLinear[bidPrice]
      if (bidPrice > maxPrice) maxPrice = bidPrice
      if (bidPrice < minPrice) minPrice = bidPrice
      if (bidSize > maxSizeLinear) maxSizeLinear = bidSize
      if (bidSize < minSizeLinear) minSizeLinear = bidSize
    }
    bidsLinear.reverse()

    // etc
    output.asksAndBids = {
      minPrice,
      maxPrice,
      minSizeBid: minSizeLinear,
      maxSizeBid: maxSizeLinear,
      minSizeAsk: minSizeLinear,
      maxSizeAsk: maxSizeLinear,
      asks: asksLinear,
      bids: bidsLinear,
      sizes: sizesLinear,
    }
  }
  return (
    <div className={classes.container}>
      <Data data={output} expandUntil={5} />
      <VolumeColumn
        asksAndBids={output.asksAndBids}
        price={Number(output.market.oraclePrice)}
      />
    </div>
  )
}
