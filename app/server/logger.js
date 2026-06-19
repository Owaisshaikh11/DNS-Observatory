const pino = require("pino");

const isProduction = process.env.NODE_ENV === "production";
const defaultLogLevel = isProduction ? "info" : "debug";
const logLevel = process.env.LOG_LEVEL || defaultLogLevel;

const transport = !isProduction
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
      },
    }
  : undefined;

const logger = pino({
  level: logLevel,
  transport,
});

module.exports = logger;
