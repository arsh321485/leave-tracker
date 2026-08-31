import pino from "pino";

export const logger = pino({
  level: process.env.APP_ENV === "development" ? "debug" : "info",
  redact: {
    paths: [
      "SLACK_BOT_TOKEN",
      "SLACK_SIGNING_SECRET",
      "SLACK_CLIENT_SECRET",
      "SLACK_APP_TOKEN",
      "password",
      "passwordHash",
      "token",
      "authorization",
    ],
    remove: true,
  },
});
