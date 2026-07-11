// Provider configuration (provider + model + API key). Stored locally in
// .data/config.json. The API key never leaves the server: the client only ever
// sees `hasKey` (a boolean), never the key itself.
import fs from "fs";
import { CONFIG_FILE } from "./paths.js";

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

/** Full config incl. the secret apiKey — server-side use only. */
export function getSecret() {
  return readRaw();
}

/** Client-safe view: provider + model + whether a key is set. No secret. */
export function publicConfig(c = readRaw()) {
  return {
    provider: c.provider ?? null, // 'google' | 'groq' | null
    model: c.model ?? "",
    hasKey: Boolean(c.apiKey),
  };
}

/** Update config. Only overwrites the key when a non-empty apiKey is provided. */
export function setConfig({ provider, model, apiKey } = {}) {
  const next = readRaw();
  if (provider !== undefined) next.provider = provider;
  if (model !== undefined) next.model = model;
  if (typeof apiKey === "string" && apiKey.length > 0) next.apiKey = apiKey;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return publicConfig(next);
}
