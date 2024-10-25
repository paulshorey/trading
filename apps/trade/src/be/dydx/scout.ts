import {
  OrderExecution,
  OrderSide,
  OrderType,
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  OrderTimeInForce,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { sendToMyselfSMS } from '@src/be/twillio/sendToMyselfSMS'
import { add } from '@my/be/sql/log/add'

type Output = Record<string, any>

/**
 * Throws error if something went wrong!
 */
export const dydxScout = async (): Promise<Output | undefined> => {
  const data = {} as Output
  try {
    // Connect to my DYDX
    const NETWORK = Network.mainnet()
    const client = new IndexerClient(NETWORK.indexerConfig)
    const ticker = 'SOL-USD'

    // const compositeClient = await CompositeClient.connect(NETWORK);
    const mnemonic = process.env.DYDX_MNEMONIC || ''
    const wallet = await LocalWallet.fromMnemonic(mnemonic, BECH32_PREFIX)
    const address = wallet.address || ''
    const subaccount = new SubaccountClient(wallet, 0)
    const subaccountNumber = subaccount.subaccountNumber

    // Fetch data
    const blockHeight = await client.utility.getHeight()
    const trades = (await client.markets.getPerpetualMarketTrades(ticker))
      ?.trades
    const orders = await client.account.getSubaccountOrders(
      address,
      subaccountNumber
    )

    // Format data
    data.blockHeight = blockHeight.height
    data.blockHeightTime = blockHeight.time
    data.orders = orders
    data.trades = trades

    // markets: await indexerClient.markets.getPerpetualMarkets()
    // candles: (
    //   await indexerClient.markets.getPerpetualMarketCandles(market, '1MIN')
    // ).candles,

    /*
     * PLACE ORDERS
     */
    // https://docs.dydx.exchange/api_integration-clients/composite_client#placing-orders

    // const clientId = Math.ceil(Math.random() * 1000000); // set to a number, can be used by the client to identify the order
    // const type = OrderType.MARKET; // order type
    // const side = OrderSide.SELL; // side of the order
    // const timeInForce = OrderTimeInForce.FOK; // UX TimeInForce
    // const execution = OrderExecution.DEFAULT;
    // const price = 1; //= 30_000; // price of 30,000;
    // const size = 1; // subticks are calculated by the price of the order
    // const postOnly = false; // If true, order is post only
    // const reduceOnly = false; // if true, the order will only reduce the position size
    // const triggerPrice = undefined; // = null; // required for conditional orders

    // const tx = await compositeClient.placeOrder(
    //   subaccount,
    //   market,
    //   type,
    //   side,
    //   price,
    //   size,
    //   clientId,
    //   timeInForce,
    //   0,
    //   execution,
    //   postOnly,
    //   reduceOnly,
    //   triggerPrice
    // );

    // const tx = await compositeClient.cancelOrder(
    //   subaccount,
    //   125,
    //   64,
    //   'AVAX-USD',
    //   0,
    //   Date.now() / 1000 + 1000
    // );
    // console.log('tx', tx);

    // @ts-ignore
  } catch (err: Error) {
    // Error
    const message =
      'DYDX Error! ' +
      (typeof err?.message === 'string' ? err?.message : 'unknown')
    // notify sms
    sendToMyselfSMS(message)
    // notify log
    await add('trade-error', message, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }
  return data
}
