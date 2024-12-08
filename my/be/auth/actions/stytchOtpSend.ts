"use server";

import { Client } from "stytch";
import phoneOrEmail from "../../functions/string/phoneOrEmail";

const stytchClient = new Client({
  project_id: process.env.STYTCH_PROJECTID || "",
  secret: process.env.STYTCH_SECRET || "",
});

export default async function stytchOtpSend(post: { phoneOrEmail: string }) {
  console.error("\n\n\n", ["stytchOtpSend"], "\n", post, "\n\n\n");
  try {
    const [phone, email, error] = phoneOrEmail(post.phoneOrEmail);
    if (error) {
      return { message: error };
    }
    let data = "" as any;
    if (phone) {
      data = await stytchClient.otps.sms.loginOrCreate({
        phone_number: phone,
        create_user_as_pending: true,
      });
    } else if (email) {
      data = await stytchClient.otps.email.loginOrCreate({ email, create_user_as_pending: true });
    } else {
      throw new Error("!phone or !email");
    }
    if (data) {
      const err = !data ? "No data" : data.message || data.error;
      if (err) {
        console.error(err, data);
        return { message: `Data: ${err}` };
      }
      return data;
    }
    return { message: "Invalid phone or email format" };
  } catch (error: any) {
    console.error(error);
    return { message: error.error_message || error.message };
  }
}
