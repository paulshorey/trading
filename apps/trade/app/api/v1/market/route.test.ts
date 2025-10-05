/**
 * @jest-environment node
 */
import { POST } from '@/app/api/v1/market/route'
import { parseOrdersText } from '@/dydx/lib/parseOrdersText'
import { NextRequest } from 'next/server'
import Dydx from '@/dydx'
import { sendToMyselfSMS } from '@lib/common/twillio/sendToMyselfSMS'

const mockOrderMarket = jest.fn()
const mockGetPositions = jest.fn()

jest.mock('@/dydx', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(true),
    getPositions: mockGetPositions,
    getAccount: jest.fn().mockResolvedValue({ freeCollateral: '100000' }),
    getCandles: jest.fn().mockResolvedValue([{ close: '1.5' }]),
    orderMarket: mockOrderMarket,
  }))
})

jest.mock('@/dydx/lib/parseOrdersText', () => ({
  parseOrdersText: jest.fn(),
}))

jest.mock('@lib/common/sql/log/add', () => ({
  sqlLogAdd: jest.fn(),
}))

jest.mock('@lib/common/twillio/sendToMyselfSMS')

describe('/api/v1/market', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    ;(Dydx as jest.Mock).mockClear()
  })

  const testCases = [
    {
      description: 'a new long position',
      bodyText: 'sui:100',
      position: 100,
      currentPositionSize: '0',
      expected: {
        ticker: 'SUI-USD',
        side: 'LONG',
        reduceOnly: false,
      },
    },
    {
      description: 'closing an existing position',
      bodyText: 'sui:0',
      position: 0,
      currentPositionSize: '100',
      expected: {
        ticker: 'SUI-USD',
        side: 'SHORT',
        reduceOnly: true,
      },
    },
    {
      description: 'closing an existing position',
      bodyText: 'sui:0',
      position: 0,
      currentPositionSize: '-100',
      expected: {
        ticker: 'SUI-USD',
        side: 'LONG',
        reduceOnly: true,
      },
    },
    {
      description: 'a new long position',
      bodyText: 'sui:-100',
      position: -100,
      currentPositionSize: '0',
      expected: {
        ticker: 'SUI-USD',
        side: 'SHORT',
        reduceOnly: false,
      },
    },
  ]

  it.each(testCases)('should handle $description for "$bodyText"', async ({ bodyText, position, currentPositionSize, expected }) => {
    mockGetPositions.mockResolvedValue([{ size: currentPositionSize }])
    ;(parseOrdersText as jest.Mock).mockReturnValue([{ ticker: 'SUI-USD', position }])

    const request = new NextRequest('http://localhost/api/v1/market?access_key=testkeyx', {
      method: 'POST',
      body: bodyText,
    })
    const postPromise = POST(request)
    await jest.advanceTimersByTimeAsync(20000)
    await postPromise

    expect(mockOrderMarket).toHaveBeenCalledWith(expect.objectContaining(expected))
  })

  const edgeCaseInputs = ['0', 'SUI', 'GC1!, 9 Less Than Trend Line']

  it.each(edgeCaseInputs)('should not call orderMarket and should call sendToMyselfSMS for invalid input "%s"', async (bodyText) => {
    ;(parseOrdersText as jest.Mock).mockReturnValue([])

    const request = new NextRequest('http://localhost/api/v1/market?access_key=testkeyx', {
      method: 'POST',
      body: bodyText,
    })

    await POST(request)

    expect(sendToMyselfSMS).toHaveBeenCalledWith(bodyText)
    expect(Dydx).not.toHaveBeenCalled()
    expect(mockOrderMarket).not.toHaveBeenCalled()
  })
})
