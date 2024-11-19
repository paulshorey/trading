'use client'

import { Data } from '@src/fe/blocks/Data'
import { infoTicker } from '@src/be/dydx/infoTicker'
import { VolumeColumn } from '@src/fe/orders/ColumnVolume'
import useSWR from 'swr'
import classes from './PageTickerOrderbook.module.scss'
import { roundToCustomDecimal } from '@src/lib/numbers'
import { asksAndBids, summary } from './types'
import { useState } from 'react'
import { infoAccount } from '@src/be/dydx/infoAccount'
import { useSearchParams } from 'next/navigation'

export const revalidate = 0

type Params = {
  ticker: string
}
type Output = {
  summary: summary
  asksAndBids: asksAndBids
}

let initialTime = Date.now()
let initialTopAsk = 0
let initialTopBid = Infinity
let initialPrice = 1000000

let numberAsksAndBidsTotal = 70
let numberAsksOrBidsOnScreen = 20

function updateTicker(oldTicker: string, newValue: string) {
  window.location.href = window.location.href.replace(
    '/' + oldTicker.replace('-USD', '').toLowerCase(),
    '/' + newValue
  )
}

export function PageTickerOrderbook({ params }: { params: Params }) {
  const searchParams = useSearchParams()
  const access_key = searchParams.get('access_key')
  if (!access_key) throw new Error('!access_key')
  if (!(access_key === 'supdupddd')) {
    throw new Error('wrong access_key')
  }

  const [tickerInput, setTickerInput] = useState('')
  const [primarilyBuy, setPrimarilyBuy] = useState(true)
  const [buyDollars, setBuyDollars] = useState(100)
  const [sellDollars, setSellDollars] = useState(100)
  const [refreshInterval, setRefreshInterval] = useState(3000)
  const ticker = (params.ticker.toUpperCase() + '-USD').replace(
    '-USD-USD',
    '-USD'
  )
  const fetcherTicker = async () => {
    return await infoTicker(ticker)
  }
  const { data, error, isLoading, isValidating } = useSWR(
    ticker,
    fetcherTicker,
    {
      refreshInterval,
    }
  )
  if (!data && isLoading) return <div>Loading...</div>
  if (!data && isValidating) return <div>Validating...</div>
  if (error) return <div>Failed to load ticker="{ticker}" data</div>
  if (!data?.market) return <div>No data for ticker="{ticker}"</div>

  const output = {
    summary: {},
    asksAndBids: {},
  } as Output
  /*
   * Summary
   */
  output.summary.ticker = ticker
  output.summary.trades24H = data.market.trades24H
  output.summary.volume24H = parseInt(data.market.volume24H)
  let pip = Number(data.market.tickSize)
  // price
  output.summary.priceChange24H = Number(
    Number(data.market.priceChange24H).toFixed(2)
  )
  output.summary.price = Number(data.market.oraclePrice)
  output.summary.price = roundToCustomDecimal(output.summary.price, pip)
  if (initialPrice === 1000000) {
    initialPrice = output.summary.price
    console.log('initialPrice', initialPrice)
  }
  output.summary.initialPrice = initialPrice
  // pips
  output.summary.pip = pip
  // @ts-ignore
  output.summary.decimals = (
    output.summary.pip.toString().split('.')[1] || ''
  ).length
  /*
   * Asks And Bids
   */
  if (data.asksAndBids) {
    // helpers
    let asksRaw = [] as number[]
    let bidsRaw = [] as number[]
    let sizesRaw = {} as Record<number, any>
    // asks
    if (data.asksAndBids.asks.length) {
      data.asksAndBids.asks.forEach((row: any, i: number) => {
        let price = Number(row.price)
        if (price > output.summary.price * 1.1) return
        let size = Number(row.size)
        sizesRaw[row.price] = size
        asksRaw.push(price)
      })
    }
    asksRaw.sort((a, b) => b - a)
    if (!asksRaw[asksRaw.length - 1]) return <div>no asks</div>
    // bids
    if (data.asksAndBids.bids.length) {
      data.asksAndBids.bids.forEach((row: any, i: number) => {
        let price = Number(row.price)
        if (price < output.summary.price * 0.91) return
        let size = Number(row.size)
        sizesRaw[row.price] = size
        bidsRaw.push(price)
      })
    }
    bidsRaw.sort((a, b) => b - a)
    if (!bidsRaw[bidsRaw.length - 1]) return <div>no bids</div>

    // output
    let minPrice = Infinity
    let maxPrice = 0
    let minSize = Infinity
    let maxSize = 0
    let sizes = {} as Record<number, any>
    // linear pips
    if (initialTopAsk === 0) {
      initialTopAsk = asksRaw[0] as number
    }
    if (initialTopBid === Infinity) {
      initialTopBid = bidsRaw[bidsRaw.length - 1] as number
    }
    let asksBidsPip = roundToCustomDecimal(
      // @ts-ignore
      (initialTopAsk - initialTopBid) / numberAsksAndBidsTotal,
      output.summary.pip,
      'up'
    )
    output.summary.asksBidsPip = asksBidsPip

    // linear asks
    let asks = [] as number[]
    {
      let toAsksPip = output.summary.price
      let loopedPips = 0
      for (
        let askPrice = output.summary.price + output.summary.pip;
        askPrice <= initialTopAsk;
        askPrice += asksBidsPip
      ) {
        askPrice = roundToCustomDecimal(askPrice, output.summary.pip, 'up')
        asks.push(askPrice)
        while (toAsksPip <= askPrice) {
          if (sizesRaw[toAsksPip]) {
            sizes[askPrice] = sizes[askPrice]
              ? sizes[askPrice] + sizesRaw[toAsksPip]
              : sizesRaw[toAsksPip]
          } else {
            sizes[askPrice] = 0
          }
          toAsksPip += output.summary.pip
          toAsksPip = roundToCustomDecimal(toAsksPip, output.summary.pip, 'up')
        }
        const askSize = sizes[askPrice]
        if (askPrice > maxPrice) maxPrice = askPrice
        if (askPrice < minPrice) minPrice = askPrice
        if (loopedPips < numberAsksOrBidsOnScreen && askSize > maxSize)
          maxSize = askSize
        if (loopedPips < numberAsksOrBidsOnScreen && askSize < minSize)
          minSize = askSize
        loopedPips++
      }
      asks.reverse()
    }

    // linear bids
    let bids = [] as number[]
    {
      let toBidsPip = output.summary.price
      let loopedPips = 0
      for (
        let bidPrice = output.summary.price - output.summary.pip;
        bidPrice >= initialTopBid;
        bidPrice -= asksBidsPip
      ) {
        bidPrice = roundToCustomDecimal(bidPrice, output.summary.pip, 'down')
        bids.push(bidPrice)
        while (toBidsPip >= bidPrice) {
          if (sizesRaw[toBidsPip]) {
            sizes[bidPrice] = sizes[bidPrice]
              ? sizes[bidPrice] + sizesRaw[toBidsPip]
              : sizesRaw[toBidsPip]
          } else {
            sizes[bidPrice] = 0
          }
          toBidsPip -= output.summary.pip
          toBidsPip = roundToCustomDecimal(
            toBidsPip,
            output.summary.pip,
            'down'
          )
        }
        const bidSize = sizes[bidPrice]
        if (bidPrice > maxPrice) maxPrice = bidPrice
        if (bidPrice < minPrice) minPrice = bidPrice
        if (loopedPips < numberAsksOrBidsOnScreen && bidSize > maxSize)
          maxSize = bidSize
        if (loopedPips < numberAsksOrBidsOnScreen && bidSize < minSize)
          minSize = bidSize
        loopedPips++
      }
    }

    // etc
    output.asksAndBids = {
      minPrice,
      maxPrice,
      minSize,
      maxSize,
      asks,
      bids,
      sizes,
    }
  }

  return (
    <div className={classes.container}>
      <div className={classes.floatingLabels}></div>
      <div className={classes.floatingTools}>
        <div>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(1000)}
          >
            <input type="radio" checked={refreshInterval === 1000} />
            1s
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(3000)}
          >
            <input type="radio" checked={refreshInterval === 3000} />
            3s
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(5000)}
          >
            <input type="radio" checked={refreshInterval === 5000} />
            5s
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(15000)}
          >
            <input type="radio" checked={refreshInterval === 15000} />
            15s
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(60000)}
          >
            <input type="radio" checked={refreshInterval === 60000} />
            60s
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setRefreshInterval(600000)}
          >
            <input type="radio" checked={refreshInterval === 600000} />
            600s
          </span>
        </div>
        <div>
          <span className={classes.inputLabel}>Primarily:</span>
          <span
            className={classes.inputLabel}
            onClick={() => setPrimarilyBuy(true)}
          >
            <input type="radio" checked={!!primarilyBuy} /> Buy
          </span>
          <span
            className={classes.inputLabel}
            onClick={() => setPrimarilyBuy(false)}
          >
            <input type="radio" checked={!primarilyBuy} /> Sell
          </span>
        </div>
        <div>
          <span className={classes.inputLabel}>Buy$:</span>
          <input
            className={classes.input}
            type="number"
            value={buyDollars}
            onChange={(e) => setBuyDollars(Number(e.target.value))}
          />
        </div>
        <div>
          <span className={classes.inputLabel}>Sell$:</span>
          <input
            className={classes.input}
            type="number"
            value={sellDollars}
            onChange={(e) => setSellDollars(Number(e.target.value))}
          />
        </div>
        <div>
          <span className={classes.inputLabel}>Coin:</span>
          <input
            className={classes.input}
            type="text"
            onChange={(e) => {
              setTickerInput(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateTicker(ticker, tickerInput)
              }
            }}
          />
        </div>
      </div>
      {/* <Data data={output} expandUntil={5} /> */}
      <VolumeColumn
        summary={output.summary}
        asksAndBids={output.asksAndBids}
        initialPrice={initialPrice}
        initialTime={initialTime}
        buyDollars={buyDollars}
        sellDollars={sellDollars}
        primarilyBuy={primarilyBuy}
      />
    </div>
  )
}
