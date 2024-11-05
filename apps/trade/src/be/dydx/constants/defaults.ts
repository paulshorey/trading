export const defaults = {
  default: {
    LONG: 0.33,
    SHORT: 0.5,
    precision: 1,
  },
  'SOL-USD': {
    LONG: 0.33,
    SHORT: 0.5,
    precision: 0.1,
  },
  'AVAX-USD': {
    LONG: 0.33,
    SHORT: 0.5,
  },
  'NEAR-USD': {
    LONG: 0.5,
    SHORT: 0.67,
  },
  'FIL-USD': {
    LONG: 0.33,
    SHORT: 0.5,
  },
  'SUI-USD': {
    LONG: 1,
    SHORT: 1.25,
    precision: 10,
  },
  'ATOM-USD': {
    LONG: 0.33,
    SHORT: 0.33,
  },
  'ETH-USD': {
    LONG: 0.33,
    SHORT: 0.33,
    precision: 0.001,
  },
  'BCH-USD': {
    LONG: 0.33,
    SHORT: 0.33,
    precision: 0.01,
  },
  'BTC-USD': {
    LONG: 0.33,
    SHORT: 0.33,
    precision: 0.0001,
  },
  'SUNDOG-USD': {
    precision: 1000,
  },
} as {
  [key: string]: {
    LONG?: number
    SHORT?: number
    precision?: number
  }
}
