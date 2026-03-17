import { createNotesRouteHandlers } from "../_lib/notes-app-route-handlers"

export const runtime = "nodejs"
export const { GET, POST, PATCH, DELETE } = createNotesRouteHandlers()
