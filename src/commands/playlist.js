const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Path to the songs folder
const songsFolder = path.join(__dirname, '../../songs');

// Path to the playlist file inside the songs folder
const playlistFile = path.join(songsFolder, 'playlist.json');

// Supported audio file extensions
const supportedExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma'];

// Get all files recursively
function getFilesRecursively(folder) {
  let files = [];
  const entries = fs.readdirSync(folder, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

// Split array into chunks
function paginateArray(array, pageSize) {
  const pages = [];
  for (let i = 0; i < array.length; i += pageSize) {
    pages.push(array.slice(i, i + pageSize));
  }
  return pages;
}

async function run({ reply, followUp, userIdForButtons }) {
  try {
    if (!fs.existsSync(songsFolder)) {
      return reply('The songs folder does not exist. Please create the folder and add songs.');
    }

    const allFiles = getFilesRecursively(songsFolder);
    const files = allFiles.filter((file) =>
      supportedExtensions.includes(path.extname(file).toLowerCase())
    );

    if (files.length === 0) {
      return reply('The playlist is empty. Add some songs to the folder first.');
    }

    // Build playlist with IDs + relative paths
    const playlist = files.map((file, index) => ({
      id: index + 1,
      path: path.relative(songsFolder, file).replace(/\\/g, '/'),
    }));

    // Write playlist.json
    fs.writeFileSync(playlistFile, JSON.stringify({ songs: playlist }, null, 2));

    // Paginate (10 per page)
    const pageSize = 10;
    const lines = playlist.map((song) => `${song.id}: ${song.path}`);
    const pages = paginateArray(lines, pageSize);

    // If we're not in an interaction context (prefix), just print everything (chunked)
    if (!userIdForButtons) {
      const MAX = 1900; // keep under discord message limit
      let buffer = '🎶 Playlist:\n';
      const sends = [];

      for (const line of lines) {
        if ((buffer + line + '\n').length > MAX) {
          sends.push(buffer);
          buffer = '';
        }
        buffer += `${line}\n`;
      }
      if (buffer.trim()) sends.push(buffer);

      // Send all chunks
      for (let i = 0; i < sends.length; i++) {
        // first one uses reply, rest use followUp if available, otherwise reply again
        if (i === 0) {
          await reply(sends[i]);
        } else if (typeof followUp === 'function') {
          await followUp(sends[i]);
        } else {
          await reply(sends[i]);
        }
      }
      return;
    }

    // Slash-mode: use embeds + buttons if multiple pages
    const generateEmbed = (pageIndex) =>
      new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('🎶 Playlist')
        .setDescription(pages[pageIndex].join('\n'))
        .setFooter({ text: `Page ${pageIndex + 1} of ${pages.length}` });

    let currentPage = 0;

    const components =
      pages.length > 1
        ? [
            {
              type: 1, // ActionRow
              components: [
                {
                  type: 2, // Button
                  label: 'Previous',
                  style: 1, // Primary
                  custom_id: 'prev',
                  disabled: true,
                },
                {
                  type: 2, // Button
                  label: 'Next',
                  style: 1, // Primary
                  custom_id: 'next',
                  disabled: pages.length <= 1,
                },
              ],
            },
          ]
        : [];

    const message = await reply({
      embeds: [generateEmbed(currentPage)],
      fetchReply: true,
      components,
    });

    if (pages.length <= 1) return;

    const collector = message.createMessageComponentCollector({
      time: 60000,
    });

    collector.on('collect', async (btnInteraction) => {
      // only allow the user who ran the command
      if (btnInteraction.user.id !== userIdForButtons) {
        await btnInteraction.reply({
          content: "You can't interact with this menu!",
          ephemeral: true,
        });
        return;
      }

      if (btnInteraction.customId === 'prev' && currentPage > 0) currentPage--;
      if (btnInteraction.customId === 'next' && currentPage < pages.length - 1) currentPage++;

      await btnInteraction.update({
        embeds: [generateEmbed(currentPage)],
        components: [
          {
            type: 1,
            components: [
              {
                type: 2,
                label: 'Previous',
                style: 1,
                custom_id: 'prev',
                disabled: currentPage === 0,
              },
              {
                type: 2,
                label: 'Next',
                style: 1,
                custom_id: 'next',
                disabled: currentPage === pages.length - 1,
              },
            ],
          },
        ],
      });
    });

    collector.on('end', async () => {
      try {
        await message.edit({ components: [] });
      } catch (_) {}
    });
  } catch (error) {
    console.error('Error reading the playlist:', error);
    return reply('There was an error trying to load the playlist.');
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Displays the playlist of available songs'),

  // Slash: /playlist
  async execute(interaction) {
    return run({
      userIdForButtons: interaction.user.id,
      reply: (payload) => interaction.reply(payload),
      followUp: (payload) => interaction.followUp(payload),
    });
  },

  // Prefix: !playlist
  async executeMessage(message) {
    return run({
      userIdForButtons: null, // no buttons in prefix mode
      reply: (payload) => message.channel.send(payload),
      followUp: (payload) => message.channel.send(payload),
    });
  },
};
