import "dotenv/config";
import { readFile } from "node:fs/promises";
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits
} from "discord.js";
import { ConfigStore } from "./configStore.js";

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

function pickConfig(config, ...keys) {
  for (const key of keys) {
    if (process.env[key]) return process.env[key];
  }

  const flat = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
        visit(nestedValue);
      } else {
        flat.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), nestedValue);
      }
    }
  };

  visit(config);

  for (const key of keys) {
    const value = flat.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value) return String(value);
  }

  return "";
}

const config = await readJson("./config.json");
const DISCORD_TOKEN = pickConfig(
  config,
  "DISCORD_TOKEN",
  "TOKEN",
  "BOT_TOKEN",
  "CLIENT_TOKEN"
);
const DATA_FILE = process.env.DATA_FILE || "./data/rules.json";

if (!DISCORD_TOKEN) {
  throw new Error("Missing DISCORD_TOKEN/TOKEN in .env or config.json");
}

const store = new ConfigStore(DATA_FILE);
await store.load();
const PRESENCE_ACTIVITY = "ส่งอีโมจิออโต้ | /autoreact";
const PRESENCE_REFRESH_MS = 60 * 1000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

let presenceHeartbeat = null;
let presenceHeartbeatCount = 0;

function applyPresence(reason = "heartbeat") {
  if (!client.isReady() || !client.user) return;

  client.user.setPresence({
    status: "online",
    afk: false,
    activities: [{
      name: PRESENCE_ACTIVITY,
      type: ActivityType.Watching
    }]
  });

  presenceHeartbeatCount += 1;
  if (reason !== "heartbeat" || presenceHeartbeatCount % 10 === 0) {
    console.log(`[presence] refreshed (${reason}, pid=${process.pid})`);
  }
}

function startPresenceHeartbeat() {
  if (presenceHeartbeat) clearInterval(presenceHeartbeat);

  applyPresence("clientReady");
  presenceHeartbeat = setInterval(() => applyPresence(), PRESENCE_REFRESH_MS);
  console.log(`[presence] heartbeat active every ${PRESENCE_REFRESH_MS / 1000}s`);
}

client.once(Events.ClientReady, (readyClient) => {
  startPresenceHeartbeat();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on("shardReady", (shardId) => applyPresence(`shardReady:${shardId}`));
client.on("shardResume", (shardId) => applyPresence(`shardResume:${shardId}`));

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "autoreact") {
    return;
  }

  if (!interaction.guildId) {
    await interaction.reply({
      content: "This command can only be used in a server.",
      ephemeral: true
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  try {
    if (subcommand === "add") {
      await handleAdd(interaction);
      return;
    }

    if (subcommand === "list") {
      await handleList(interaction);
      return;
    }

    if (subcommand === "remove") {
      await handleRemove(interaction);
      return;
    }

    if (subcommand === "toggle") {
      await handleToggle(interaction);
      return;
    }

    if (subcommand === "scan") {
      await handleScan(interaction);
      return;
    }

    await interaction.reply({
      content: `Unsupported subcommand: ${subcommand}`,
      ephemeral: true
    });
  } catch (error) {
    console.error(error);
    const content = `Action failed: ${error.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guildId) return;

  const rules = store
    .listRules(message.guildId)
    .filter((rule) => rule.enabled && rule.channelId === message.channelId);

  if (rules.length === 0) return;

  const me = message.guild.members.me;
  const permissions = message.channel.permissionsFor(me);
  if (!permissions?.has(PermissionFlagsBits.AddReactions)) return;

  for (const rule of rules) {
    if (rule.ignoreBots && message.author.bot) continue;
    if (!matchesRule(message.content ?? "", rule)) continue;

    for (const emoji of getRuleEmojis(rule)) {
      try {
        await message.react(emoji);
      } catch (error) {
        console.warn(
          `Could not react with "${emoji}" for rule ${rule.id}: ${error.message}`
        );
      }
    }
  }
});

async function handleAdd(interaction) {
  const channel = interaction.options.getChannel("channel", true);
  const emojiText = getFirstStringOption(interaction, [
    "emojis",
    "emoji",
    "reaction",
    "reactions",
    "emote",
    "emotes"
  ]);
  const emojis = parseEmojiList(emojiText);
  const keyword = interaction.options.getString("keyword")?.trim() ?? "";
  const mode = interaction.options.getString("mode") ?? (keyword ? "contains" : "all");
  const ignoreBots = interaction.options.getBoolean("ignore_bots") ?? false;

  if (emojis.length === 0) {
    await interaction.reply({
      content: "Missing emojis. Fill the emojis option, for example: 🔥 or 🔥 ❤️",
      ephemeral: true
    });
    return;
  }

  if (mode !== "all" && !keyword) {
    await interaction.reply({
      content: "Keyword is required when mode is not all.",
      ephemeral: true
    });
    return;
  }

  if (mode === "regex") {
    validateRegex(keyword);
  }

  const rule = await store.addRule(interaction.guildId, {
    channelId: channel.id,
    emoji: emojis[0],
    emojis,
    keyword,
    mode,
    ignoreBots
  });

  await interaction.reply({
    content: `Added rule: \`${rule.id}\` | ${channel} | ${emojis.join(" ")} | mode: \`${mode}\``,
    ephemeral: true
  });
}

function getFirstStringOption(interaction, names) {
  for (const name of names) {
    const value = interaction.options.getString(name);
    if (value?.trim()) return value.trim();
  }
  return "";
}

function parseEmojiList(value) {
  return (value.match(/<a?:[a-zA-Z0-9_]+:\d+>|[^\s,]+/g) || [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function getRuleEmojis(rule) {
  if (Array.isArray(rule.emojis) && rule.emojis.length > 0) {
    return rule.emojis;
  }
  if (rule.emoji) {
    return [rule.emoji];
  }
  return [];
}

async function handleList(interaction) {
  const rules = store.listRules(interaction.guildId);

  if (rules.length === 0) {
    await interaction.reply({
      content: "No auto reaction rules in this server.",
      ephemeral: true
    });
    return;
  }

  const lines = rules.map((rule) => {
    const status = rule.enabled ? "on" : "off";
    const keyword = rule.keyword ? ` | keyword: \`${rule.keyword}\`` : "";
    const emojis = getRuleEmojis(rule).join(" ");
    return `\`${rule.id}\` [${status}] <#${rule.channelId}> ${emojis} | mode: \`${rule.mode}\`${keyword}`;
  });

  await interaction.reply({
    content: lines.join("\n").slice(0, 1900),
    ephemeral: true
  });
}

async function handleRemove(interaction) {
  const id = interaction.options.getString("id", true);
  const removed = await store.removeRule(interaction.guildId, id);

  await interaction.reply({
    content: removed ? `Removed rule \`${id}\`.` : `Rule \`${id}\` not found.`,
    ephemeral: true
  });
}

async function handleToggle(interaction) {
  const id = interaction.options.getString("id", true);
  const enabled = interaction.options.getBoolean("enabled", true);
  const rule = await store.setRuleEnabled(interaction.guildId, id, enabled);

  await interaction.reply({
    content: rule
      ? `Rule \`${id}\` is now ${enabled ? "on" : "off"}.`
      : `Rule \`${id}\` not found.`,
    ephemeral: true
  });
}

async function handleScan(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const rules = store
    .listRules(interaction.guildId)
    .filter((rule) => rule.enabled && getRuleEmojis(rule).length > 0);

  if (rules.length === 0) {
    await interaction.editReply("No enabled auto reaction rules to scan.");
    return;
  }

  const rulesByChannel = new Map();
  for (const rule of rules) {
    const channelRules = rulesByChannel.get(rule.channelId) ?? [];
    channelRules.push(rule);
    rulesByChannel.set(rule.channelId, channelRules);
  }

  const member =
    interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  let checked = 0;
  let reacted = 0;
  let skippedChannels = 0;
  let errors = 0;

  for (const [channelId, channelRules] of rulesByChannel) {
    let channel;
    try {
      channel =
        interaction.guild.channels.cache.get(channelId) ??
        (await interaction.guild.channels.fetch(channelId));
    } catch {
      skippedChannels++;
      continue;
    }

    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
      skippedChannels++;
      continue;
    }

    const permissions = channel.permissionsFor(member);
    if (
      !permissions?.has(PermissionFlagsBits.ViewChannel) ||
      !permissions?.has(PermissionFlagsBits.ReadMessageHistory) ||
      !permissions?.has(PermissionFlagsBits.AddReactions)
    ) {
      skippedChannels++;
      continue;
    }

    let messages;
    try {
      messages = await channel.messages.fetch({ limit: 50 });
    } catch {
      errors++;
      continue;
    }

    for (const message of messages.values()) {
      checked++;
      for (const rule of channelRules) {
        if (rule.ignoreBots && message.author.bot) continue;
        if (!matchesRule(message.content ?? "", rule)) continue;

        for (const emoji of getRuleEmojis(rule)) {
          try {
            await message.react(emoji);
            reacted++;
          } catch {
            errors++;
          }
        }
      }
    }
  }

  await interaction.editReply(
    `Scan done. Checked ${checked} messages, added ${reacted} reactions, skipped ${skippedChannels} channels, errors ${errors}.`
  );
}

function matchesRule(content, rule) {
  const mode = rule.mode || "all";
  if (mode === "all") return true;
  if (!rule.keyword) return false;

  const normalizedContent = content.toLocaleLowerCase();
  const normalizedKeyword = rule.keyword.toLocaleLowerCase();

  if (mode === "exact") {
    return normalizedContent.trim() === normalizedKeyword.trim();
  }

  if (mode === "regex") {
    return new RegExp(rule.keyword, "i").test(content);
  }

  return normalizedContent.includes(normalizedKeyword);
}

function validateRegex(pattern) {
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("Invalid regex pattern.");
  }
}

client.login(DISCORD_TOKEN);
