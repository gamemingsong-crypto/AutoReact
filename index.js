import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    ActivityType,
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    EmbedBuilder,
} from 'discord.js';

// 🌐 Web Server กันบอทหลับ (Render/VPS keep-alive)
const app = express();
app.get('/', (req, res) => res.send('Auto React Bot is Alive!'));
app.listen(process.env.PORT || 3001);

// 🤖 ตั้งค่าบอทและ Intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CONFIG_PATH = './config.json';

// ----------------------------------------------------------------
// 💾 ระบบเก็บค่าคอนฟิก (บันทึกลงไฟล์ กันหายตอนรีสตาร์ทบอท)
// ----------------------------------------------------------------
// โครงสร้างข้อมูล:
// {
//   "enabled": true,
//   "channels": {
//     "channelId": { "emojis": ["😀", "🔥"], "mode": "all" | "image_only" }
//   }
// }
function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        const initial = { enabled: true, channels: {} };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(initial, null, 2));
        return initial;
    }
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (err) {
        console.error('❌ อ่านไฟล์ config.json ไม่ได้ ใช้ค่าเริ่มต้นแทน:', err);
        return { enabled: true, channels: {} };
    }
}

function saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

let config = loadConfig();

// ----------------------------------------------------------------
// 🖼️ ฟังก์ชันเช็คว่าข้อความมีรูป/ไฟล์แนบไหม
// ----------------------------------------------------------------
function hasImageAttachment(message) {
    return message.attachments.some(
        (att) =>
            att.contentType?.startsWith('image/') ||
            /\.(png|jpe?g|gif|webp|bmp)$/i.test(att.name || '')
    );
}

// ----------------------------------------------------------------
// 📜 นิยาม Slash Command /autoreact
// ----------------------------------------------------------------
const commands = [
    new SlashCommandBuilder()
        .setName('autoreact')
        .setDescription('ตั้งค่าระบบ Auto React')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand((sub) =>
            sub
                .setName('add')
                .setDescription('เพิ่ม/แก้ไขห้องสำหรับ Auto React')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('ห้องที่ต้องการให้ react อัตโนมัติ')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('emojis')
                        .setDescription('อิโมจิที่จะ react (คั่นด้วยช่องว่าง เช่น 😀 🔥 👍)')
                        .setRequired(true)
                )
                .addStringOption((opt) =>
                    opt
                        .setName('mode')
                        .setDescription('React ข้อความแบบไหน')
                        .setRequired(true)
                        .addChoices(
                            { name: 'ทุกข้อความ', value: 'all' },
                            { name: 'เฉพาะข้อความที่มีรูป/ไฟล์แนบ', value: 'image_only' }
                        )
                )
        )
        .addSubcommand((sub) =>
            sub
                .setName('remove')
                .setDescription('เอาห้องออกจากระบบ Auto React')
                .addChannelOption((opt) =>
                    opt
                        .setName('channel')
                        .setDescription('ห้องที่ต้องการเอาออก')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
        )
        .addSubcommand((sub) =>
            sub.setName('list').setDescription('ดูรายการห้องที่ตั้ง Auto React ไว้ทั้งหมด')
        )
        .addSubcommand((sub) =>
            sub.setName('toggle').setDescription('เปิด/ปิดระบบ Auto React ทั้งหมด')
        )
        .addSubcommand((sub) =>
            sub.setName('clear').setDescription('ลบการตั้งค่าห้องทั้งหมดทิ้ง (ล้างระบบ)')
        ),
].map((cmd) => cmd.toJSON());

// ----------------------------------------------------------------
// 🚀 Ready: ลงทะเบียนคำสั่ง + ตั้งสถานะบอท
// ----------------------------------------------------------------
client.once('ready', async () => {
    console.log(`🚀 ${client.user.tag} พร้อมทำงานแล้ว!`);
    client.user.setActivity('/autoreact | Auto Reaction', { type: ActivityType.Watching });

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        // ลงทะเบียนคำสั่งแบบ Guild command ให้แต่ละเซิร์ฟเวอร์ที่บอทอยู่ (ใช้งานได้ทันที ไม่ต้องรอ)
        const guildIds = client.guilds.cache.map((g) => g.id);
        for (const guildId of guildIds) {
            await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
                body: commands,
            });
        }
        console.log(`✅ ลงทะเบียน Slash Command สำเร็จใน ${guildIds.length} เซิร์ฟเวอร์`);
    } catch (err) {
        console.error('❌ ลงทะเบียน Slash Command ไม่สำเร็จ:', err);
    }
});

// ----------------------------------------------------------------
// 🎯 Auto React เมื่อมีข้อความใหม่
// ----------------------------------------------------------------
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // ไม่ react ข้อความจากบอท
    if (!config.enabled) return;

    const channelConfig = config.channels[message.channel.id];
    if (!channelConfig) return;

    const hasImage = hasImageAttachment(message);
    const shouldReact = channelConfig.mode === 'all' || (channelConfig.mode === 'image_only' && hasImage);
    if (!shouldReact) return;

    for (const emoji of channelConfig.emojis) {
        try {
            await message.react(emoji);
        } catch (err) {
            console.error(`⚠️ React อิโมจิ "${emoji}" ไม่สำเร็จ:`, err.message);
        }
    }
});

// ----------------------------------------------------------------
// 🛠️ จัดการ Slash Command /autoreact
// ----------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'autoreact') return;

    // เช็คสิทธิ์แอดมิน (กันไว้อีกชั้น นอกจาก setDefaultMemberPermissions)
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ คำสั่งนี้ใช้ได้เฉพาะแอดมินเท่านั้น', ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();

    // ---------------- /autoreact add ----------------
    if (sub === 'add') {
        const channel = interaction.options.getChannel('channel');
        const emojiInput = interaction.options.getString('emojis');
        const mode = interaction.options.getString('mode');

        // แยกอิโมจิด้วยช่องว่าง รองรับทั้งอิโมจิปกติและ custom emoji <:name:id>
        const emojis = emojiInput.split(/\s+/).filter(Boolean);

        if (emojis.length === 0) {
            return interaction.reply({ content: '❌ กรุณาใส่อิโมจิอย่างน้อย 1 ตัว', ephemeral: true });
        }

        config.channels[channel.id] = { emojis, mode };
        saveConfig();

        const modeText = mode === 'all' ? 'ทุกข้อความ' : 'เฉพาะข้อความที่มีรูป/ไฟล์แนบ';
        const embed = new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle('✅ ตั้งค่า Auto React สำเร็จ')
            .addFields(
                { name: 'ห้อง', value: `<#${channel.id}>`, inline: true },
                { name: 'โหมด', value: modeText, inline: true },
                { name: 'อิโมจิ', value: emojis.join(' '), inline: false }
            );
        return interaction.reply({ embeds: [embed] });
    }

    // ---------------- /autoreact remove ----------------
    if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');

        if (!config.channels[channel.id]) {
            return interaction.reply({ content: `⚠️ ห้อง <#${channel.id}> ไม่ได้ตั้งค่า Auto React ไว้`, ephemeral: true });
        }

        delete config.channels[channel.id];
        saveConfig();
        return interaction.reply(`🗑️ เอาห้อง <#${channel.id}> ออกจากระบบ Auto React แล้ว`);
    }

    // ---------------- /autoreact list ----------------
    if (sub === 'list') {
        const entries = Object.entries(config.channels);

        if (entries.length === 0) {
            return interaction.reply({ content: '📭 ยังไม่มีห้องไหนตั้งค่า Auto React ไว้เลย', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📋 รายการห้อง Auto React')
            .setDescription(`สถานะระบบ: ${config.enabled ? '🟢 เปิดทำงาน' : '🔴 ปิดทำงาน'}`);

        for (const [channelId, data] of entries) {
            const modeText = data.mode === 'all' ? 'ทุกข้อความ' : 'เฉพาะรูป/ไฟล์แนบ';
            embed.addFields({
                name: `#${channelId}`,
                value: `โหมด: ${modeText}\nอิโมจิ: ${data.emojis.join(' ')}`,
                inline: false,
            });
        }
        return interaction.reply({ embeds: [embed] });
    }

    // ---------------- /autoreact toggle ----------------
    if (sub === 'toggle') {
        config.enabled = !config.enabled;
        saveConfig();
        const statusText = config.enabled ? 'เปิดทำงาน 🟢' : 'ปิดทำงาน 🔴';
        return interaction.reply(`⚙️ ระบบ Auto React ตอนนี้: **${statusText}**`);
    }

    // ---------------- /autoreact clear ----------------
    if (sub === 'clear') {
        config.channels = {};
        saveConfig();
        return interaction.reply('🧹 ล้างการตั้งค่าห้องทั้งหมดเรียบร้อยแล้ว');
    }
});

// จุดเริ่มต้นบอท
client.login(TOKEN);
