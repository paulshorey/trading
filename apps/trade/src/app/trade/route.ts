import { NextRequest } from 'next/server';
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

import { formatResponse } from '@/src/lib/api/formatResponse';

type RouteParams = {
  params: {
    type: string;
  };
};

const handler = async (request: NextRequest, { params }: RouteParams) => {
  try {
    const NETWORK = Network.mainnet();
    const indexerClient = new IndexerClient(NETWORK.indexerConfig);
    const compositeClient = await CompositeClient.connect(NETWORK);
    const mnemonic = process.env.DYDX_MNEMONIC || '';
    const wallet = await LocalWallet.fromMnemonic(mnemonic, BECH32_PREFIX);
    const subaccount = new SubaccountClient(wallet, 0);

    const market = 'SOL-USD'; // perpertual market id

    /*
     * GET DATA
     */
    const response = await indexerClient.utility.getHeight();

    const data = {
      // markets: await indexerClient.markets.getPerpetualMarkets()
      blockHeight: response.height,
      blockHeightTime: response.time,
      candles: (await indexerClient.markets.getPerpetualMarketCandles(market, '1MIN')).candles,
    };

    /*
     * PLACE ORDERS
     */
    // https://docs.dydx.exchange/api_integration-clients/composite_client#placing-orders

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

    return formatResponse({
      ok: true,
      data,
    });

    // @ts-ignore
  } catch (error: Error) {
    let errorMessage = 'Something went wrong';
    const stackArray = error?.stack?.split('\n') || [];
    const stackInfo = stackArray.find((line: string) => line?.includes('.ts:'));
    if (error instanceof Error) {
      errorMessage = stackArray.length ? stackArray[0] + stackInfo : error.message;
    }
    return formatResponse({ error: errorMessage }, 500);
  }
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  return handler(request, { params });
}
