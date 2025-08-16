export type Order = {
  client_id: number
  type: 'MARKET' | 'LIMIT' | 'STOP_MARKET'
  ticker: string
  side: 'LONG' | 'SHORT'
  amount: number
  price: number
  server_name?: string
  app_name?: string
  node_env?: string
  time?: EpochTimeStamp
}
