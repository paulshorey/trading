export const defaults = {
  default: {
    LONG: 0.33,
    SHORT: 0.33,
    precision: 1,
  },
  'SOL-USD': {
    precision: 0.1,
  },
  'SUI-USD': {
    precision: 10,
  },
  'ETH-USD': {
    precision: 0.001,
  },
  'BCH-USD': {
    precision: 0.01,
  },
  'BTC-USD': {
    precision: 0.0001,
  },
  'SUNDOG-USD': {
    precision: 20,
  },
} as {
  [key: string]: {
    LONG?: number
    SHORT?: number
    precision?: number
  }
}
