'use server'

import { infoAccount } from '@/dydx/infoAccount'

export async function getAccountData() {
  const data = (await infoAccount()) || {}
  if (data.orders) {
    let orders = {} as Record<string, any>
    for (let row of data.orders) {
      orders[`${row.ticker} ${row.size} ${row.status}`] = row
    }
    data.orders = orders
  }
  // if (data.asksAndBids) {
  //   let asks = {} as Record<string, any>
  //   let bids = {} as Record<string, any>
  //   if (data.asksAndBids?.asks.length) {
  //     data.asksAndBids?.asks.forEach((row: any, i: number) => {
  //       asks[row.price.toString()] = row.size
  //     })
  //   }
  //   if (data.asksAndBids?.asks.length) {
  //     data.asksAndBids?.bids.forEach((row: any, i: number) => {
  //       bids[row.price.toString()] = row.size
  //     })
  //   }
  //   data.asksAndBids = { asks, bids }
  // }
  return data
}
