import { BECH32_PREFIX, LocalWallet, SubaccountInfo, CompositeClient, ValidatorClient, Network, IndexerClient } from '@dydxprotocol/v4-client-js'
import * as dydxPackage from '@dydxprotocol/v4-client-js'
import { getOrders } from './methods/getOrders'

// DEBUG: Log package info to troubleshoot CI/CD issue with SubaccountInfo.forLocalWallet
const debugDydxPackage = () => {
  try {
    // Log Node.js version
    console.log('[DYDX DEBUG] Node.js version:', process.version)
    console.log('[DYDX DEBUG] NODE_ENV:', process.env.NODE_ENV)
    
    // Log Next.js version (from package.json at runtime)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nextPkg = require('next/package.json')
      console.log('[DYDX DEBUG] Next.js version:', nextPkg.version)
    } catch (e) {
      console.log('[DYDX DEBUG] Could not read Next.js version:', e)
    }
    
    // Log dydx client version
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const dydxPkg = require('@dydxprotocol/v4-client-js/package.json')
      console.log('[DYDX DEBUG] @dydxprotocol/v4-client-js version:', dydxPkg.version)
    } catch (e) {
      console.log('[DYDX DEBUG] Could not read dydx package.json:', e)
    }
    
    // Try to get the resolved module path
    try {
      const resolvedPath = require.resolve('@dydxprotocol/v4-client-js')
      console.log('[DYDX DEBUG] Resolved module path:', resolvedPath)
    } catch (e) {
      console.log('[DYDX DEBUG] Could not resolve module path:', e)
    }
    
    // Log what's exported from the package
    console.log('[DYDX DEBUG] dydxPackage exports:', Object.keys(dydxPackage))
    
    // Log SubaccountInfo details
    console.log('[DYDX DEBUG] SubaccountInfo type:', typeof SubaccountInfo)
    console.log('[DYDX DEBUG] SubaccountInfo:', SubaccountInfo)
    console.log('[DYDX DEBUG] SubaccountInfo keys:', SubaccountInfo ? Object.keys(SubaccountInfo) : 'undefined')
    console.log('[DYDX DEBUG] SubaccountInfo.forLocalWallet:', (SubaccountInfo as any)?.forLocalWallet)
    console.log('[DYDX DEBUG] SubaccountInfo.forLocalWallet type:', typeof (SubaccountInfo as any)?.forLocalWallet)
    
    // Check prototype chain
    if (SubaccountInfo) {
      console.log('[DYDX DEBUG] SubaccountInfo.prototype:', SubaccountInfo.prototype)
      console.log('[DYDX DEBUG] SubaccountInfo own property names:', Object.getOwnPropertyNames(SubaccountInfo))
    }
    
    // Check if it's a class vs object
    console.log('[DYDX DEBUG] SubaccountInfo.toString():', SubaccountInfo?.toString?.())
    
    // Check ESM vs CJS
    console.log('[DYDX DEBUG] dydxPackage.default:', (dydxPackage as any).default)
    console.log('[DYDX DEBUG] dydxPackage.__esModule:', (dydxPackage as any).__esModule)
  } catch (err) {
    console.error('[DYDX DEBUG] Error in debug function:', err)
  }
}

// Run debug immediately on module load
debugDydxPackage()
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
    
    // Workaround: Use dynamic approach to access forLocalWallet to handle module resolution differences
    // between local dev (Node 20) and CI/CD (Node 18) environments
    const SubaccountInfoClass = SubaccountInfo as any
    if (typeof SubaccountInfoClass.forLocalWallet === 'function') {
      this.subaccount = SubaccountInfoClass.forLocalWallet(this.wallet, 0)
    } else if (typeof SubaccountInfoClass.default?.forLocalWallet === 'function') {
      // Handle ESM default export case
      this.subaccount = SubaccountInfoClass.default.forLocalWallet(this.wallet, 0)
    } else {
      // Last resort: Try to access from the package directly
      const pkg = dydxPackage as any
      const SubaccountClass = pkg.SubaccountInfo || pkg.SubaccountClient || pkg.default?.SubaccountInfo
      if (SubaccountClass && typeof SubaccountClass.forLocalWallet === 'function') {
        this.subaccount = SubaccountClass.forLocalWallet(this.wallet, 0)
      } else {
        console.error('[DYDX ERROR] Could not find forLocalWallet method')
        console.error('[DYDX ERROR] SubaccountInfo:', SubaccountInfo)
        console.error('[DYDX ERROR] SubaccountInfo keys:', Object.getOwnPropertyNames(SubaccountInfo))
        console.error('[DYDX ERROR] dydxPackage keys:', Object.keys(dydxPackage))
        throw new Error('SubaccountInfo.forLocalWallet not available. Check dydx package exports.')
      }
    }
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
