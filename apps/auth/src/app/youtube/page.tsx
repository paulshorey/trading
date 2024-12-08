import * as React from 'react'
import PageContentHeader from '@src/components/templates/PageContentHeader'
import decodeHtml from '@my/be/functions/string/decodeHtml'
import YouTubeResultsTemplate from '@src/components/youtube/index'

export type youtubeType = {
  id: {
    videoId: string
  }
  snippet: {
    description: string
    title: string
    thumbnails: {
      high: {
        width: number
        height: number
      }
    }
  }
}
export type videoType = {
  id: string
  title: string
  description: string
  tw: number
  th: number
}

function Sp({ w = 1 }: { w?: number }) {
  return <span style={{ display: 'inline-block', width: `${w}px` }} />
}

export default async function PageYoutube({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams?: { [key: string]: string | string[] | undefined }
}) {
  const qs = searchParams
  // const local = await fetch('http://ip-api.com/json/136.37.20.77').then((res) => res.json());
  // &location=${encodeURIComponent(`${local.lat},${local.lon}`)}&locationRadius=10mi
  // ${qs.q || ''}&pageToken=${qs.pageToken || ''}
  let data = await fetch(
    `https://www.googleapis.com/youtube/v3/search?q=${encodeURIComponent(
      'crypto trading bot'
    )}&part=id%2Csnippet&videoDuration=long&type=video&maxResults=50&order=relevance&publishedAfter=2023-02-02T00:00:00Z&regionCode=CA&relevanceLanguage=en&key=AIzaSyCdhDduY2qpqfzOr4TDBbSbUSe2si6pZ2s`
  ).then((res) => res.json())
  if (!data?.items) {
    console.error('No data.items. Probably out of credits again.', data)
    data = { items: [] }
  }
  console.log('\n\n\nqs', qs)
  console.log('\n\n\nparams', params)
  console.log('\n\n\ndata items', data.items)

  const items: videoType[] = []
  data.items.map((item: youtubeType) => {
    if (item.snippet.title.includes('WATCH')) {
      return
    }
    const vid = {
      id: item.id.videoId,
      title: decodeHtml(item.snippet.title),
      description: item.snippet.description.replace(/ ?\. ?\. ?\./g, ''),
      tw: item.snippet.thumbnails.high.width,
      th: item.snippet.thumbnails.high.height,
    }
    if (
      vid.description.match(/% off|http|FREE/) ||
      (
        vid.description
          .substring(0, 100)
          .match(/[A-Z]{2,}/g)
          ?.join('') || ''
      ).length > 10
    ) {
      return
    }

    const title1st =
      vid?.title?.split(/ \| | - /g)?.[0]?.replace(/ ?\. ?\. ?\./g, '') || ''
    const ups = title1st.match(/[A-Z]{2,}/g)?.join('') || ''
    if (ups.length / title1st.length > 0.2) {
      return
    }
    vid.title = title1st

    items.push(vid)
  })

  return (
    <div>
      <PageContentHeader
        title={
          <div>
            nohype
            <Sp w={1} />
            .<Sp w={1} />
            media
          </div>
        }
        subtitle={
          <div className="font-extralight tracking-wide pb-1">
            more focus, less clickbait
          </div>
        }
      />
      <YouTubeResultsTemplate
        items={items}
        options={{
          screenshots: false,
          thumbnail: false,
          prevPageToken: data.prevPageToken,
          nextPageToken: data.nextPageToken,
        }}
      />
    </div>
  )
}
