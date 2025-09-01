import { NextRequest, NextResponse } from 'next/server'
import { getSocketIO, setGlobalIO, NextApiResponseWithSocket } from '@apps/common/websocket'

/**
 * WebSocket initialization endpoint
 * This route initializes the Socket.IO server if it hasn't been created yet
 */
export async function GET(req: NextRequest) {
  try {
    // In App Router, we need a different approach since we don't have access to res.socket
    // This endpoint mainly serves as a health check for the WebSocket server

    return NextResponse.json({
      ok: true,
      message: 'WebSocket server endpoint. Use Socket.IO client to connect.',
      socketPath: '/api/socket',
    })
  } catch (error: any) {
    console.error('WebSocket initialization error:', error)
    return NextResponse.json(
      {
        ok: false,
        error: error.message || 'Failed to initialize WebSocket server',
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  // This could be used to manually trigger events for testing
  try {
    const body = await req.json()
    const { event, data, room } = body

    if (!event || !data) {
      return NextResponse.json({ ok: false, error: 'Missing event or data' }, { status: 400 })
    }

    // Note: In production, you'd want to validate/authenticate this request
    const globalIO = (global as any).io
    if (globalIO) {
      if (room) {
        globalIO.to(room).emit(event, data)
      } else {
        globalIO.emit(event, data)
      }

      return NextResponse.json({
        ok: true,
        message: `Event '${event}' emitted successfully`,
      })
    } else {
      return NextResponse.json({ ok: false, error: 'WebSocket server not initialized' }, { status: 503 })
    }
  } catch (error: any) {
    console.error('WebSocket event error:', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
