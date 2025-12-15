const { SlashCommandBuilder } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const state = require('../state'); // shared state

// Path to the "PizzaDAO Mixtape" folder
const mixtapeFolder = path.join(__dirname, '../../songs/mixtape');

// Supported audio file extensions
const supportedExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

// Shuffle helper (Fisher–Yates)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getAudioFiles(folder) {
  return fs
    .readdirSync(folder)
    .filter((file) => supportedExtensions.includes(path.extname(file).toLowerCase()));
}

async function run({ member, reply, followUp }) {
  try {
    if (!fs.existsSync(mixtapeFolder)) {
      return reply(
        'The folder does not exist. Please make sure the songs are in the correct location.'
      );
    }

    const allFiles = getAudioFiles(mixtapeFolder);

    if (allFiles.length === 0) {
      return reply(
        'The folder is empty or contains unsupported file types. Add some songs to the folder first.'
      );
    }

    // Must be in a voice channel
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return reply('You need to be in a voice channel to play music!');
    }

    // Shuffle and store queue (copy to avoid mutating source array)
    state.queue = shuffleArray([...allFiles]);

    // Join voice
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    // Create player
    state.player = createAudioPlayer();

    const playNextSong = () => {
      try {
        if (!state.queue || state.queue.length === 0) {
          if (typeof followUp === 'function') {
            followUp('All songs from the mixtape have been played!');
          }
          try {
            state.connection?.destroy();
          } catch (_) {}
          state.connection = null;
          state.player = null;
          return;
        }

        const nextSong = state.queue.shift();
        const resource = createAudioResource(path.join(mixtapeFolder, nextSong));

        console.log(`Playing: ${nextSong}`);
        state.player.play(resource);
      } catch (err) {
        console.error('Error in playNextSong:', err);
      }
    };

    // Prevent stacking listeners on repeated runs
    state.player.removeAllListeners(AudioPlayerStatus.Idle);
    state.player.removeAllListeners('error');

    state.player.on(AudioPlayerStatus.Idle, playNextSong);

    state.player.on('error', (error) => {
      console.error('Error during playback:', error);
      if (typeof followUp === 'function') {
        followUp(`An error occurred while playing a song: ${error.message}`);
      }
      playNextSong();
    });

    // Subscribe + start
    state.connection.subscribe(state.player);
    playNextSong();

    return reply('🎵 Playing songs from the PizzaDAO Mixtape folder in random order!');
  } catch (error) {
    console.error('Error executing the mixtape command:', error);
    return reply('There was an error trying to play the songs.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mixtape')
    .setDescription('Plays songs from the PizzaDAO Mixtape folder in random order'),

  // Slash: /mixtape
  async execute(interaction) {
    return run({
      member: interaction.member,
      reply: (payload) => interaction.reply(payload),
      followUp: (payload) => interaction.followUp(payload),
    });
  },

  // Prefix: !mixtape
  async executeMessage(message) {
    return run({
      member: message.member,
      reply: (payload) => message.channel.send(payload),
      followUp: (payload) => message.channel.send(payload),
    });
  },
};
