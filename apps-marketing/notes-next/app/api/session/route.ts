import { createSessionRouteHandlers } from "../_lib/notes-app-route-handlers"

export const runtime = "nodejs"
export const { GET, POST } = createSessionRouteHandlers()
