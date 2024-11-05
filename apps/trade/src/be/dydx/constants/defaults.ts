export const defaults = {
  default: {
    LONG: 0.334,
    SHORT: 0.5,
    precision: 1,
  },
  'SOL-USD': {
    LONG: 0.5,
    SHORT: 0.67,
    precision: 0.1,
  },
  'AVAX-USD': {
    LONG: 0.5,
    SHORT: 0.67,
  },
  'NEAR-USD': {
    LONG: 0.67,
    SHORT: 1.33,
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
    LONG: 0.66,
    SHORT: 0.66,
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
} as {
  [key: string]: {
    LONG: number
    SHORT: number
    precision?: number
  }
}
