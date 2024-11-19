export type summary = {
  ticker: string
  trades24H: any
  volume24H: number
  price: number
  priceChange24H: number
  pip: number
  asksBidsPip: number
  decimals: number
  initialPrice: number
}

export type asksAndBids = {
  minPrice: number
  maxPrice: number
  minSize: number
  maxSize: number
  asks: number[]
  bids: number[]
  sizes: Record<number, any>
}
