import { ErrorTemplate } from '@src/components/ErrorTemplate';
import {
  OrderExecution,
  OrderSide,
  OrderType,
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  Network,
  OrderTimeInForce,
  IndexerClient,
} from '@dydxprotocol/v4-client-js';
import Json from '@/src/components/ui/Json';

export const revalidate = 0;

export default async function () {
  try {
    const NETWORK = Network.mainnet();
    const client = new IndexerClient(NETWORK.indexerConfig);
    const compositeClient = await CompositeClient.connect(NETWORK);
    const mnemonic = process.env.DYDX_MNEMONIC || '';
    const wallet = await LocalWallet.fromMnemonic(mnemonic, BECH32_PREFIX);
    const subaccount = new SubaccountClient(wallet, 0);
    // console.log('subaccount', subaccount);
    const market = 'SOL-USD'; // perpertual market id

    /*
     * GET DATA
     * https://docs.dydx.exchange/api_integration-clients/indexer_client#get-block-height-and-block-time-parsed-by-indexer
     */
    const dataHeight = await client.utility.getHeight();
    const dataOrders = await client.account.getSubaccountOrders(
      wallet.address || '',
      subaccount.subaccountNumber || 0
    );
    const data = {
      dataOrders,
      // markets: await indexerClient.markets.getPerpetualMarkets()
      blockHeight: dataHeight.height,
      blockHeightTime: dataHeight.time,
      candles: (await client.markets.getPerpetualMarketCandles(market, '1MIN')).candles,
    };

    /*
     * PLACE ORDERS
     * https://docs.dydx.exchange/api_integration-clients/composite_client#placing-orders
     */

    const clientId = Math.ceil(Math.random() * 1000000); // set to a number, can be used by the client to identify the order
    const type = OrderType.MARKET; // order type
    const side = OrderSide.SELL; // side of the order
    const timeInForce = OrderTimeInForce.FOK; // UX TimeInForce
    const execution = OrderExecution.DEFAULT;
    const price = 1; //= 30_000; // price of 30,000;
    const size = 1; // subticks are calculated by the price of the order
    const postOnly = false; // If true, order is post only
    const reduceOnly = false; // if true, the order will only reduce the position size
    const triggerPrice = undefined; // = null; // required for conditional orders

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

    return <Json data={data} />;
    // @ts-ignore
  } catch (error: Error) {
    // addLog('Error accessing logs page (in app/page.tsx SSR)', error);
    return (
      <ErrorTemplate
        filePath="app/page.tsx"
        error={{
          name: error.name,
          message: error.message,
          stack: error.stack,
        }}
      />
    );
  }
}
