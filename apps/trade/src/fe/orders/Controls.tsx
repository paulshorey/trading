'use client'

// import { useRouter } from 'next/navigation'
import classes from './Controls.module.scss'
import { useState } from 'react'

export const revalidate = 0

type Props = {
  coin: string
}

export function Controls({ coin }: Props) {
  const [coinInput, setCoinInput] = useState('')
  const [positionBuy, setPositionBuy] = useState(true)
  const [buyDollars, setBuyDollars] = useState(100)
  const [sellDollars, setSellDollars] = useState(100)
  const [refreshInterval, setRefreshInterval] = useState(3000)
  // const router = useRouter()
  function updateTicker(oldTicker: string, newValue: string) {
    const fullHref = window.location.href.replace(
      '/' + oldTicker.replace('-USD', '').toLowerCase(),
      '/' + newValue
    )
    window.location.href = fullHref
    // const urlObj = new URL(fullHref)
    // router.push(urlObj.pathname + '?' + urlObj.searchParams)
  }
  return (
    <div className={classes.form}>
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
        <span className={classes.inputLabel}>Position:</span>
        <span
          className={classes.inputLabel}
          onClick={() => setPositionBuy(true)}
        >
          <input type="radio" checked={!!positionBuy} /> Buy
        </span>
        <span
          className={classes.inputLabel}
          onClick={() => setPositionBuy(false)}
        >
          <input type="radio" checked={!positionBuy} /> Sell
        </span>
      </div>
      <div>
        <sup>Opposite side will be placed as post-only</sup>
      </div>
      <div>
        <span className={classes.inputNospace}>Buy:&ensp;$</span>
        <input
          className={classes.input}
          type="number"
          value={buyDollars}
          onChange={(e) => setBuyDollars(Number(e.target.value))}
        />
      </div>
      <div>
        <span className={classes.inputNospace}>Sell:&ensp;$</span>
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
            setCoinInput(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateTicker(coin, coinInput)
            }
          }}
        />
      </div>
    </div>
  )
}
