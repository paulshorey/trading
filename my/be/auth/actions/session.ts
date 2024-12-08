/* eslint-disable no-param-reassign */

"use server";

import { getIronSession, SessionOptions } from "iron-session";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import objectsMergeMutable from "../../functions/object/objectsMergeMutable";
import { SessionData, sessionDefault } from "../../auth/actions/types";

const sessionOptions: SessionOptions = {
  password: "kfsafdshjafdshjlafsdhjlkfsdhjkafsdhjksfdhjkfsdhasdf",
  cookieName: "authnz_1",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
  },
};

async function sessionClass() {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.ui) {
    session.ui = sessionDefault.ui;
  }
  if (!session.user) {
    session.user = sessionDefault.user;
  }
  if (!session.session) {
    session.session = sessionDefault.session;
  }
  return session;
}

/*
 * PUBLIC...
 */

export async function sessionGet() {
  "use server";

  const headersList = headers();
  const session = await sessionClass();
  if (!session.session.ip_address) {
    session.session.ip_address = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "";
  }
  if (!session.session.user_agent) {
    session.session.user_agent = headersList.get("user-agent") || "";
  }
  return {
    ui: session.ui,
    user: session.user,
    session: session.session,
  };
}

export async function sessionEnd() {
  "use server";

  const session = await sessionClass();
  session.destroy();
  objectsMergeMutable(session, sessionDefault);
  revalidatePath("/");
  return {
    ui: session.ui,
    user: session.user,
    session: session.session,
  };
}

export async function sessionStart(sessionData: Partial<SessionData>) {
  "use server";

  const session = await sessionClass();
  if (session.user.untrusted_metadata) {
    if (!sessionData.user) {
      sessionData.user = {};
    }
    if (!sessionData.user.untrusted_metadata) {
      sessionData.user.untrusted_metadata = {};
    }
    objectsMergeMutable(sessionData.user.untrusted_metadata, session.user.untrusted_metadata);
  }
  objectsMergeMutable(session, sessionData);
  await session.save();
  revalidatePath("/");
  return {
    ui: session.ui,
    user: session.user,
    session: session.session,
  };
}

export async function sessionEdit(sessionData: Partial<SessionData> = {}) {
  "use server";

  const session = await sessionClass();
  objectsMergeMutable(session, sessionDefault);
  objectsMergeMutable(session, sessionData);
  await session.save();
  revalidatePath("/");
  return {
    ui: session.ui,
    user: session.user,
    session: session.session,
  };
}
