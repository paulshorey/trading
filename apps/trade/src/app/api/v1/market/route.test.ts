/**
 * @jest-environment node
 */
import { POST } from '@src/app/api/v1/market/route'
import { parseOrdersText } from '@src/be/dydx/lib/parseOrdersText'
import { NextRequest } from 'next/server'
import Dydx from '@src/be/dydx'

const mockOrderMarket = jest.fn()

jest.mock('@src/be/dydx', () => {
  return jest.fn().mockImplementation(() => {
    return {
      init: jest.fn().mockResolvedValue(true),
      getPositions: jest.fn().mockResolvedValue([{ size: '0' }]),
      getAccount: jest.fn().mockResolvedValue({ freeCollateral: '100000' }),
      getCandles: jest.fn().mockResolvedValue([{ close: '1.5' }]),
      orderMarket: mockOrderMarket,
      orderLimit: jest.fn(),
      orderCancel: jest.fn(),
      getOrders: jest.fn().mockResolvedValue([]),
      orderStop: jest.fn(),
    }
  })
})

jest.mock('@src/be/dydx/lib/parseOrdersText', () => ({
  parseOrdersText: jest.fn(),
}))

jest.mock('@my/be/sql/log/add', () => ({
  logAdd: jest.fn(),
}))

jest.mock('@my/be/twillio/sendToMyselfSMS', () => ({
  sendToMyselfSMS: jest.fn(),
}))

describe('/api/v1/market', () => {
  afterEach(() => {
    jest.clearAllMocks()
    ;(Dydx as jest.Mock).mockClear()
  })

  it('should call dydx.orderMarket with correct parameters for "sui:100"', async () => {
    const order = {
      ticker: 'SUI-USD',
      position: 100,
    }
    ;(parseOrdersText as jest.Mock).mockReturnValue([order])

    const bodyText = 'sui:100'
    const request = new NextRequest('http://localhost/api/v1/market?access_key=testkeyx', {
      method: 'POST',
      body: bodyText,
    })

    await POST(request)

    expect(mockOrderMarket).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'SUI-USD',
        side: 'LONG',
        reduceOnly: false,
      })
    )
  }, 30000)
})
