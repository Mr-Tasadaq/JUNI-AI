import { createJuniApplication } from "../core/app.js";
import { handleVoiceToken } from "../voice/token-route.js";

let application;

export default async function handler(req, res) {
  application ??= createJuniApplication();
  return handleVoiceToken(req, res, application);
}
