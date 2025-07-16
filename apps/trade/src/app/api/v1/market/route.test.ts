/**
 * @jest-environment node
 */
import { POST } from '@src/app/api/v1/market/route'
import { parseOrdersText } from '@src/be/dydx/lib/parseOrdersText'
import { NextRequest } from 'next/server'
import Dydx from '@src/be/dydx'
import { sendToMyselfSMS } from '@my/be/twillio/sendToMyselfSMS'

const mockOrderMarket = jest.fn()
const mockGetPositions = jest.fn()

jest.mock('@src/be/dydx', () => {
  return jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(true),
    getPositions: mockGetPositions,
    getAccount: jest.fn().mockResolvedValue({ freeCollateral: '100000' }),
    getCandles: jest.fn().mockResolvedValue([{ close: '1.5' }]),
    orderMarket: mockOrderMarket,
  }))
})

jest.mock('@src/be/dydx/lib/parseOrdersText', () => ({
  parseOrdersText: jest.fn(),
}))

jest.mock('@my/be/sql/log/add', () => ({
  logAdd: jest.fn(),
}))

jest.mock('@my/be/twillio/sendToMyselfSMS')

describe('/api/v1/market', () => {
  afterEach(() => {
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
  ]

  it.each(testCases)(
    'should handle $description for "$bodyText"',
    async ({ bodyText, position, currentPositionSize, expected }) => {
      mockGetPositions.mockResolvedValue([{ size: currentPositionSize }])
      ;(parseOrdersText as jest.Mock).mockReturnValue([{ ticker: 'SUI-USD', position }])

      const request = new NextRequest('http://localhost/api/v1/market?access_key=testkeyx', {
        method: 'POST',
        body: bodyText,
      })

      await POST(request)

      expect(mockOrderMarket).toHaveBeenCalledWith(expect.objectContaining(expected))
    },
    30000
  )

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
