// bot.js
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Collection,
  ChannelType,
} = require('discord.js');

const { joinVoiceChannel } = require('@discordjs/voice');

// =====================
// ENV
// =====================
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Prefix for message-based commands (set in .env)
// Example: COMMAND_PREFIX=!
const PREFIX = process.env.COMMAND_PREFIX || '!';

if (!TOKEN) console.warn('[WARN] DISCORD_BOT_TOKEN is not set.');
if (!GUILD_ID) console.warn('[WARN] DISCORD_GUILD_ID is not set.');
if (!VOICE_CHANNEL_ID) console.warn('[WARN] VOICE_CHANNEL_ID is not set.');

// =====================
// CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,

    // Needed for prefix commands:
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Command collection
client.commands = new Collection();

// =====================
// LOAD COMMANDS
// =====================
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`Loaded command: ${command.data.name}`);
  } else {
    console.log(
      `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
    );
  }
}

// =====================
// VOICE JOIN
// =====================
function joinVoiceChannelHandler() {
  if (!GUILD_ID || !VOICE_CHANNEL_ID) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) {
    console.error('The specified guild was not found. Please check DISCORD_GUILD_ID.');
    return;
  }

  const voiceChannel = guild.channels.cache.get(VOICE_CHANNEL_ID);
  if (!voiceChannel) {
    console.error('The specified voice channel was not found. Please check VOICE_CHANNEL_ID.');
    return;
  }

  // discord.js v14 voice channels are ChannelType.GuildVoice (and StageVoice exists too)
  const isVoice =
    voiceChannel.type === ChannelType.GuildVoice ||
    voiceChannel.type === ChannelType.GuildStageVoice;

  if (!isVoice) {
    console.error('The specified VOICE_CHANNEL_ID is not a voice/stage channel.');
    return;
  }

  joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  console.log(`Joined voice channel: ${voiceChannel.name}`);
}

// =====================
// READY
// =====================
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  joinVoiceChannelHandler();
});

// =====================
// REJOIN LOGIC (optional)
// =====================
// Only triggers when THIS BOT is moved/disconnected from the configured channel
client.on('voiceStateUpdate', (oldState, newState) => {
  if (!client.user) return;

  const isBot = oldState?.id === client.user.id || newState?.id === client.user.id;
  if (!isBot) return;

  const wasInTarget = oldState.channelId === VOICE_CHANNEL_ID;
  const nowInTarget = newState.channelId === VOICE_CHANNEL_ID;

  if (wasInTarget && !nowInTarget) {
    console.log('Bot was disconnected/moved. Attempting to rejoin...');
    // enable if you want:
    // joinVoiceChannelHandler();
  }
});

// =====================
// SLASH COMMANDS
// =====================
client.on('interactionCreate', async (interaction) => {
  // discord.js v14
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
    console.log(`Executed slash command: ${interaction.commandName}`);
  } catch (error) {
    console.error(`Error executing slash command ${interaction.commandName}:`, error);
    const payload = { content: 'There was an error executing that command!', ephemeral: true };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// =====================
// PREFIX COMMANDS
// =====================
client.on('messageCreate', async (message) => {
  try {
    // ignore bots
    if (message.author.bot) return;

    // ignore DMs (optional)
    if (!message.guild) return;

    // Support either explicit PREFIX or mentioning the bot as a prefix:
    //   !play ...
    //   @Bot play ...
    const mentionPrefix = client.user ? `<@${client.user.id}>` : null;
    const mentionPrefixNick = client.user ? `<@!${client.user.id}>` : null;

    let content = message.content;

    let usedPrefix = null;
    if (content.startsWith(PREFIX)) {
      usedPrefix = PREFIX;
    } else if (mentionPrefix && content.startsWith(mentionPrefix)) {
      usedPrefix = mentionPrefix;
    } else if (mentionPrefixNick && content.startsWith(mentionPrefixNick)) {
      usedPrefix = mentionPrefixNick;
    } else {
      return; // not a prefix command
    }

    // Slice prefix off and parse tokens
    const withoutPrefix = content.slice(usedPrefix.length).trim();
    if (!withoutPrefix) return;

    const parts = withoutPrefix.split(/\s+/);
    const commandName = (parts.shift() || '').toLowerCase();
    const args = parts;

    const command = client.commands.get(commandName);
    if (!command) return;

    // Require command files to export executeMessage for prefix usage
    if (typeof command.executeMessage !== 'function') {
      await message.reply(`\`${commandName}\` isn’t enabled for prefix commands yet.`);
      return;
    }

    await command.executeMessage(message, args);
    console.log(`Executed prefix command: ${commandName}`);
  } catch (err) {
    console.error('Error handling prefix command:', err);
    try {
      await message.reply('There was an error executing that command!');
    } catch (_) {}
  }
});

// =====================
// LOGIN
// =====================
client.login(TOKEN).catch((error) => {
  console.error('Failed to log in:', error);
});
