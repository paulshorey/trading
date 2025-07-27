import { render } from '@testing-library/react'
import Page from './page'
import { logGets } from '@my/be/sql/log/gets'
import { LogsWrapper } from '@src/list/components/data/LogsWrapper'

// Mock dependencies
jest.mock('@my/be/sql/log/gets', () => ({
  __esModule: true,
  logGets: jest.fn(),
}))

jest.mock('@src/list/components/accordion/LogsWrapper', () => ({
  __esModule: true,
  LogsWrapper: jest.fn(() => null),
}))

const mockedLogGets = logGets as jest.Mock
const MockedLogsWrapper = LogsWrapper as jest.Mock

describe('Page component', () => {
  const mockLog = {
    id: 1,
    time: 1672531200,
    message: 'Test log message',
    stack: 'Test stack trace',
    category: 'test',
    tag: 'test-tag',
    name: 'test-name',
    app_name: 'test-app',
    server_name: 'test-server',
    dev: false,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    // Mock console.error to avoid polluting the test output
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  test('should render logs correctly', async () => {
    mockedLogGets.mockResolvedValue({ result: { rows: [mockLog] } })
    const searchParams = { category: 'test' }

    const PageComponent = await Page({ searchParams, params: {} })
    render(PageComponent)

    expect(MockedLogsWrapper).toHaveBeenCalledWith(
      {
        logs: [mockLog],
        where: { category: 'test' },
      },
      {}
    )
  })

  test('should filter out logs with tag "place"', async () => {
    const placeLog = { ...mockLog, id: 2, tag: 'place' }
    mockedLogGets.mockResolvedValue({
      result: { rows: [mockLog, placeLog] },
    })
    const searchParams = {}

    const PageComponent = await Page({ searchParams, params: {} })
    render(PageComponent)

    expect(MockedLogsWrapper).toHaveBeenCalledWith(
      {
        logs: [mockLog],
        where: {},
      },
      {}
    )
  })

  test('should throw an error on fetch failure', async () => {
    const dbError = new Error('Database error')
    mockedLogGets.mockRejectedValue(dbError)

    await expect(Page({ searchParams: {}, params: {} })).rejects.toThrow(
      'Database error'
    )

    expect(console.error).toHaveBeenCalledWith(dbError)
    expect(MockedLogsWrapper).not.toHaveBeenCalled()
  })
})
