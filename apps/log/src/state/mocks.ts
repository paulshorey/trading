import { Controls, Results, SearchParams } from './types'

export const mockSearchParams: SearchParams = {}
export const mockControls: Controls = {
  groupBy: 'message',
  where: { name: '!error' },
}
export const mockResults: Results = []

export const queryStringExamples = [
  `groupBy=message&where=${encodeURIComponent(`{name:'error'}`)}`,
  `where=${encodeURIComponent(`{name:'!error'}`)}&app_name=trade`,
  `where=${encodeURIComponent(`{name:'error'}`)}&time<1733600000`,
]
export const searchParamsExamples = [
  { groupBy: 'message', where: { name: 'error' } },
  { where: { name: '!error' }, app_name: 'trade' },
  { where: { name: 'error' }, time: '<1733600000' },
]
