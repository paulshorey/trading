export type responseType = {
  status_code: number;
  message?: any;
  session?: SessionData;
};
export interface SessionData {
  ui: {
    signupAccordionItem?: string;
    [key: string]: any;
  };
  user: {
    id?: string;
    auth?: boolean;
    name?: string;
    phone?: string;
    email?: string;
    trusted_metadata?: Record<string, any>;
    untrusted_metadata?: Record<string, any>;
    providers?: any;
  };
  session: {
    jwt?: string;
    token?: string;
    expires_at?: string;
    last_accessed_at?: string;
    ip_address?: string;
    user_agent?: string;
  };
}

export const sessionDefault = {
  ui: {},
  user: {},
  session: {},
};

export function sessionDataFromStytchResponse(data: any): SessionData {
  return {
    ui: {},
    user: {
      id: data.user_id,
      auth: true,
      email: data.user.emails?.[0]?.email,
      phone: data.user.phone_numbers?.[0]?.phone_number,
      trusted_metadata: data.user.trusted_metadata,
      untrusted_metadata: data.user.untrusted_metadata,
      providers: data.user.providers,
    },
    session: {
      jwt: data.session_jwt,
      token: data.session_token,
      last_accessed_at: data.session.last_accessed_at,
      expires_at: data.session.expires_at,
      ip_address: data.session.ip_address,
      user_agent: data.session.user_agent,
    },
  };
}
