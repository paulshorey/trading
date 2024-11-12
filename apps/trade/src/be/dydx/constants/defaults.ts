export const defaults = {
  default: {
    LONG: 5,
    SHORT: 5,
    precision: 1,
  },
  'SOL-USD': {
    precision: 0.1,
  },
  'SUI-USD': {
    LONG: 7.5,
    SHORT: 7.5,
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
