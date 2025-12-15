const { SlashCommandBuilder } = require('discord.js');
const state = require('../state'); // shared state

async function run({ reply }) {
  try {
    if (!state.player || !state.queue || state.queue.length === 0) {
      return reply('There are no songs playing or no songs in the queue.');
    }

    // Stopping the player will trigger Idle handlers in your other commands (band/mixtape/etc)
    state.player.stop();
    return reply('⏭️ Skipped to the next song!');
  } catch (error) {
    console.error('Error executing the skip command:', error);
    return reply('There was an error trying to skip the song.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skips the current song and plays the next one in the queue'),

  // Slash: /skip
  async execute(interaction) {
    return run({
      reply: (payload) => interaction.reply(payload),
    });
  },

  // Prefix: !skip
  async executeMessage(message) {
    return run({
      reply: (payload) => message.channel.send(payload),
    });
  },
};
