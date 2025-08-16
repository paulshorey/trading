import { NextResponse } from 'next/server'

export const formatResponse = (
  datas: Record<string, any>,
  status: number = 200
): NextResponse => {
  return NextResponse.json({
    ...datas,
    status,
  })
}
