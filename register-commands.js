import "dotenv/config";
import { readFile } from "node:fs/promises";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function flattenConfig(value, output = new Map()) {
  if (!value || typeof value !== "object") return output;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      flattenConfig(nestedValue, output);
      continue;
    }
    output.set(normalizeKey(key), nestedValue);
  }
  return output;
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pick(configValues, ...keys) {
  for (const key of keys) {
    const envValue = process.env[key];
    if (envValue) return envValue;
  }
  for (const key of keys) {
    const configValue = configValues.get(normalizeKey(key));
    if (configValue) return String(configValue);
  }
  return "";
}

function uniqueIds(...groups) {
  const ids = new Set();
  for (const group of groups) {
    for (const value of group) {
      const id = String(value || "").trim();
      if (/^\d{17,20}$/.test(id)) ids.add(id);
    }
  }
  return [...ids];
}

function splitIds(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clientIdFromToken(token) {
  try {
    return Buffer.from(token.split(".")[0], "base64url").toString("utf8");
  } catch {
    return "";
  }
}

const configValues = flattenConfig(await readJson("./config.json"));
const rulesState = await readJson("./data/rules.json");

const token = pick(
  configValues,
  "DISCORD_TOKEN",
  "TOKEN",
  "BOT_TOKEN",
  "CLIENT_TOKEN"
);
const clientId =
  pick(
    configValues,
    "CLIENT_ID",
    "CLIENTID",
    "APPLICATION_ID",
    "APP_ID",
    "BOT_ID"
  ) || clientIdFromToken(token);
const guildId = pick(configValues, "GUILD_ID", "GUILDID", "SERVER_ID");
const guildIds = uniqueIds(
  splitIds(guildId),
  Object.keys(rulesState.guilds || {})
);

if (!token || !clientId) {
  throw new Error("Missing bot token or client id in .env/config.json");
}

const rest = new REST({ version: "10" }).setToken(token);

if (guildIds.length > 0) {
  for (const id of guildIds) {
    console.log(`Registering ${commands.length} command group(s) for guild ${id}...`);
    await rest.put(Routes.applicationGuildCommands(clientId, id), {
      body: commands
    });
  }
} else {
  console.log(`Registering ${commands.length} command group(s) globally...`);
  await rest.put(Routes.applicationCommands(clientId), {
    body: commands
  });
}

console.log("Done. Slash commands should appear in your server shortly.");
