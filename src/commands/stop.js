const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection } = require('@discordjs/voice');
const state = require('../state'); // shared state

async function run({ guildId, reply, followUp }) {
  try {
    // Get the existing voice connection for this guild
    const connection = getVoiceConnection(guildId) || state.connection;

    if (!connection) {
      return reply('I am not currently connected to a voice channel in this server.');
    }

    // Stop the shared player if present
    if (state.player) {
      try {
        state.player.stop();
      } catch (_) {}
    }

    // Clear queue
    if (state.queue) state.queue = [];

    // Destroy the connection
    try {
      connection.destroy();
    } catch (_) {}

    // Clear shared state
    state.connection = null;
    state.player = null;

    return reply('🛑 Stopped the music and disconnected from the voice channel.');
  } catch (error) {
    console.error('Error executing stop command:', error);
    if (typeof followUp === 'function') {
      return followUp('There was an error trying to stop the music.');
    }
    return reply('There was an error trying to stop the music.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Stops the current song and disconnects the bot from the voice channel'),

  // Slash: /stop
  async execute(interaction) {
    console.log(`Executing /stop command for user ${interaction.user.tag}`);

    return run({
      guildId: interaction.guild.id,
      reply: (payload) => interaction.reply(payload),
      followUp: (payload) => interaction.followUp(payload),
    });
  },

  // Prefix: !stop
  async executeMessage(message) {
    return run({
      guildId: message.guild.id,
      reply: (payload) => message.channel.send(payload),
      followUp: (payload) => message.channel.send(payload),
    });
  },
};
