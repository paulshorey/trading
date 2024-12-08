import { SearchParams, Controls } from '@src/state/types'

export function makeControlsFromSearchParams(
  searchParams: SearchParams
): Controls {
  const controls = {} as Controls
  controls.groupBy = (searchParams['groupBy'] || '') as string
  if (searchParams.hasOwnProperty('unique')) {
    controls.groupBy = 'message'
  }
  controls.where = {}
  for (let key in searchParams) {
    if (key === 'groupBy' || key === 'unique') {
      continue
    }
    controls.where[key] = (searchParams[key] || '') as string
  }
  return controls
}

export function pushRouterFromControls(controls: Controls) {}

// function constructHref(href: string, key: string, val: string) {
//   let out =
//     href.replace(key + '=' + val, '') +
//     (href.includes('?') ? '&' : '?') +
//     key +
//     '=' +
//     val
//   return out
// }
