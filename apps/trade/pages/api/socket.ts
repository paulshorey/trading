import { NextApiRequest } from 'next'
import { getSocketIO, setGlobalIO, NextApiResponseWithSocket } from '@apps/common/websocket'

/**
 * WebSocket server initialization endpoint
 * This uses Pages Router API for proper WebSocket support
 */
export default function handler(req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (req.method === 'GET') {
    // Initialize Socket.IO server
    const io = getSocketIO(res)

    if (io) {
      // Store globally for access from other parts of the app
      setGlobalIO(io)

      res.status(200).json({
        ok: true,
        message: 'WebSocket server initialized',
      })
    } else {
      res.status(503).json({
        ok: false,
        error: 'Failed to initialize WebSocket server',
      })
    }
  } else {
    res.setHeader('Allow', ['GET'])
    res.status(405).end(`Method ${req.method} Not Allowed`)
  }
}
