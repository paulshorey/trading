import {
  BECH32_PREFIX,
  LocalWallet,
  SubaccountClient,
  CompositeClient,
  ValidatorClient,
  Network,
  IndexerClient,
} from '@dydxprotocol/v4-client-js'
import { getOrders } from './methods/getOrders'
import { getPositions } from '@src/be/dydx/methods/getPositions'
import { orderStop } from '@src/be/dydx/methods/orderStop'
import { orderMarket } from '@src/be/dydx/methods/orderMarket'
import { orderLimit } from '@src/be/dydx/methods/orderLimit'
import { orderCancel } from '@src/be/dydx/methods/orderCancel'
import { getCandles } from '@src/be/dydx/methods/getCandles'
import { getAccount } from '@src/be/dydx/methods/getAccount'
import { getAsksAndBids } from '@src/be/dydx/methods/getAsksAndBids'
import { getSparklines } from '@src/be/dydx/methods/getSparklines'
import { getPerpetualMarket } from '@src/be/dydx/methods/getPerpetualMarket'

export interface DydxInterface {
  network: Network
  indexerClient?: IndexerClient
  compositeClient?: CompositeClient
  wallet: LocalWallet
  address: string
  subaccount: SubaccountClient
  subaccountNumber: number
  init: () => Promise<void>
  getIndexerClient: () => Promise<IndexerClient>
  getCompositeClient: () => Promise<CompositeClient>
  getValidatorClient: () => Promise<ValidatorClient>
  getAccount: typeof getAccount
  getCandles: typeof getCandles
  getOrders: typeof getOrders
  getPositions: typeof getPositions
  orderStop: typeof orderStop
  orderMarket: typeof orderMarket
  orderLimit: typeof orderLimit
  orderCancel: typeof orderCancel
}

/**
 * Usage: `const dydx = new Dydx(); await dydx.getOrders(); console.log(dydx.orders[0]);`
 * TypeScript definitions are correct, @ts-ignore properties are instantiated only a few milliseconds after constructor.
 * All values defined in this file should really be private but TypeScript does not have support for private properties.
 */
export class Dydx implements DydxInterface {
  network: Network
  indexerClient?: IndexerClient
  compositeClient?: CompositeClient
  validatorClient?: ValidatorClient
  // @ts-ignore
  wallet: LocalWallet
  // @ts-ignore
  address: string
  // @ts-ignore
  subaccount: SubaccountClient
  // @ts-ignore
  subaccountNumber: number

  constructor() {
    this.network = Network.mainnet()
    this.init()
  }

  async init() {
    this.wallet = await LocalWallet.fromMnemonic(
      process.env.DYDX_MNEMONIC || '',
      BECH32_PREFIX
    )
    this.address = this.wallet?.address as string
    this.subaccount = new SubaccountClient(this.wallet!, 0)
    this.subaccountNumber = this.subaccount?.subaccountNumber
  }

  async getIndexerClient() {
    if (!this.indexerClient) {
      this.indexerClient = new IndexerClient(this.network.indexerConfig)
    }
    return this.indexerClient
  }

  async getCompositeClient() {
    if (!this.compositeClient) {
      this.compositeClient = await CompositeClient.connect(this.network)
    }
    return this.compositeClient
  }

  async getValidatorClient() {
    if (!this.validatorClient) {
      this.validatorClient = await ValidatorClient.connect(
        this.network.validatorConfig
      )
    }
    return this.validatorClient
  }

  getPerpetualMarket = getPerpetualMarket
  getAsksAndBids = getAsksAndBids
  getSparklines = getSparklines
  getAccount = getAccount
  getCandles = getCandles
  getOrders = getOrders
  getPositions = getPositions
  orderStop = orderStop
  orderMarket = orderMarket
  orderLimit = orderLimit
  orderCancel = orderCancel
}
export default Dydx
