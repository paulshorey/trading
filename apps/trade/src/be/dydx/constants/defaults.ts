export const defaults = {
  default: {
    LONG: 0.33,
    SHORT: 0.5,
    floor: 1,
  },
  'SOL-USD': {
    LONG: 0.67,
    SHORT: 0.75,
    floor: 0.1,
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
  'STX-USD': {
    LONG: 0.33,
    SHORT: 0.5,
    floor: 1,
  },
  'SUI-USD': {
    LONG: 1,
    SHORT: 1.25,
    floor: 10,
  },
  'ATOM-USD': {
    LONG: 0.66,
    SHORT: 0.66,
  },
  'ETH-USD': {
    LONG: 0.33,
    SHORT: 0.33,
    floor: 0.001,
  },
  'BCH-USD': {
    LONG: 0.33,
    SHORT: 0.33,
    floor: 0.01,
  },
} as {
  [key: string]: {
    LONG: number
    SHORT: number
    floor?: number
  }
}
