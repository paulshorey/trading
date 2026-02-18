const myHeaders = new Headers();
const authHeader = `Basic ${Buffer.from(process.env.TWILLIO_USERNAME_PASSWORD || "").toString("base64")}`;
myHeaders.append("Authorization", authHeader);

const sendSingleSMS = (messageBody: string): Promise<boolean> => {
  const formdata = new FormData();
  formdata.append("To", "13857706789");
  formdata.append("From", "19133649396");
  formdata.append("Body", messageBody);

  return new Promise<boolean>((resolve) => {
    if (!process.env.TWILLIO_USERNAME_PASSWORD) {
      resolve(true);
      return;
    }

    fetch("https://api.twilio.com/2010-04-01/Accounts/AC258697f0ec08c434f11a2f19de0ce74b/Messages.json", {
      method: "POST",
      headers: myHeaders,
      body: formdata,
    })
      .then(() => {
        resolve(true);
      })
      .catch((error) => {
        console.error("Twillio POST failed!", error);
        resolve(false);
      });
  });
};

const createTimeout = (ms: number): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
  });
};

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), ms);
  });
};

export const sendToMyselfSMS = async (message: string) => {
  const MAX_LENGTH = 1500;
  const TIMEOUT_MS = 60000;
  const MIN_DELAY_MS = 10000;

  const chunks: string[] = [];
  if (message.length <= MAX_LENGTH) {
    chunks.push(message);
  } else {
    for (let i = 0; i < message.length; i += MAX_LENGTH) {
      chunks.push(message.slice(i, i + MAX_LENGTH));
    }
  }

  const results = [];
  for (let i = 0; i < Math.min(10, chunks.length); i++) {
    let messageBody = chunks[i];
    if (!messageBody) continue;
    if (chunks.length > 1) {
      messageBody += `\n[Page: ${i + 1} of ${chunks.length}]`;
    }

    const startTime = Date.now();

    try {
      const result = await Promise.race([sendSingleSMS(messageBody), createTimeout(TIMEOUT_MS)]);
      results.push(result);

      if (i < Math.min(10, chunks.length) - 1) {
        const elapsedTime = Date.now() - startTime;
        const remainingDelay = MIN_DELAY_MS - elapsedTime;

        if (remainingDelay > 0) {
          await delay(remainingDelay);
        }
      }
    } catch (error) {
      console.error("SMS send timeout or error:", error);
      break;
    }
  }

  return results.length > 0 && results.every((r) => r === true);
};
