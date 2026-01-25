import { BECH32_PREFIX, LocalWallet, SubaccountInfo, SubaccountClient, CompositeClient, ValidatorClient, Network, IndexerClient } from '@dydxprotocol/v4-client-js'
import { getOrders } from './methods/getOrders'
import { getPositions } from './methods/getPositions'
import { orderStop } from './methods/orderStop'
import { orderMarket } from './methods/orderMarket'
import { orderLimit } from './methods/orderLimit'
import { orderCancel } from './methods/orderCancel'
import { getCandles } from './methods/getCandles'
import { getAccount } from './methods/getAccount'
import { getAsksAndBids } from './methods/getAsksAndBids'
import { getSparklines } from './methods/getSparklines'
import { getPerpetualMarket } from './methods/getPerpetualMarket'

export interface DydxInterface {
  network: Network
  indexerClient?: IndexerClient
  compositeClient?: CompositeClient
  wallet: LocalWallet
  address: string
  subaccount: SubaccountInfo
  subaccountNumber: number
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
  wallet!: LocalWallet
  address!: string
  subaccount!: SubaccountInfo
  subaccountNumber!: number

  getPerpetualMarket: typeof getPerpetualMarket
  getAsksAndBids: typeof getAsksAndBids
  getSparklines: typeof getSparklines
  getAccount: typeof getAccount
  getCandles: typeof getCandles
  getOrders: typeof getOrders
  getPositions: typeof getPositions
  orderStop: typeof orderStop
  orderMarket: typeof orderMarket
  orderLimit: typeof orderLimit
  orderCancel: typeof orderCancel

  constructor() {
    this.network = Network.mainnet()
    this.getPerpetualMarket = getPerpetualMarket.bind(this)
    this.getAsksAndBids = getAsksAndBids.bind(this)
    this.getSparklines = getSparklines.bind(this)
    this.getAccount = getAccount.bind(this)
    this.getCandles = getCandles.bind(this)
    this.getOrders = getOrders.bind(this)
    this.getPositions = getPositions.bind(this)
    this.orderStop = orderStop.bind(this)
    this.orderMarket = orderMarket.bind(this)
    this.orderLimit = orderLimit.bind(this)
    this.orderCancel = orderCancel.bind(this)
  }

  async init() {
    this.wallet = await LocalWallet.fromMnemonic(process.env.DYDX_MNEMONIC || '', BECH32_PREFIX)
    if (!this.wallet?.address) {
      throw new Error('Could not initialize wallet. Check DYDX_MNEMONIC environment variable.')
    }
    this.address = this.wallet.address
    // Use SubaccountClient (alias for SubaccountInfo in v3)
    this.subaccount = SubaccountClient.forLocalWallet(this.wallet, 0)
    this.subaccountNumber = this.subaccount.subaccountNumber
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
      this.validatorClient = await ValidatorClient.connect(this.network.validatorConfig)
    }
    return this.validatorClient
  }
}
export default Dydx
