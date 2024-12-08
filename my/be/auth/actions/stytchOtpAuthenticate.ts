"use server";

import { Client } from "stytch";
import { SessionData, sessionDataFromStytchResponse } from "./types";
import { sessionStart } from "./session";

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || "",
  secret: process.env.STYTCH_SECRET || "",
});

type responseType = {
  status_code: number;
  message?: string;
  session?: SessionData;
};

export default async function stytchOtpAuthenticate(post: { code: string; method_id: string; long_session?: boolean }): Promise<responseType> {
  console.error("\n\n\n", ["stytchOtpAuthenticate"], "\n", post, "\n\n\n");
  try {
    const data = await stytchClient.otps.authenticate({
      code: post.code,
      method_id: post.method_id,
      session_duration_minutes: post.long_session ? 36000 : 10,
    });
    const session = await sessionStart(sessionDataFromStytchResponse(data));
    await stytchClient.users.update({
      user_id: data.user_id || "",
      untrusted_metadata: {
        last_login_time: new Date().toISOString(),
      },
    });
    return { session, status_code: data.status_code };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message, status_code: 500 };
  }
}
