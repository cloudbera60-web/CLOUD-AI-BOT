const axios = require("axios");
const yts = require("yt-search");
const { sendButtons } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  const args = m.body.slice(prefix.length + cmd.length).trim().split(" ");
  
  if (cmd === "play") {
    try {
      if (args.length === 0 || !args.join(" ")) {
        // Show music center
        await sendButtons(sock, m.from, {
          title: '🎵 CLOUD AI Music Center',
          text: `*Professional Audio Processing*\n\n` +
                `🎧 **Supported Services:**\n` +
                `• YouTube Music\n` +
                `• SoundCloud (Coming Soon)\n` +
                `• Spotify (Coming Soon)\n\n` +
                `⚡ **Features:**\n` +
                `• High Quality Audio\n` +
                `• Fast Download\n` +
                `• Metadata Preserved\n\n` +
                `*Search for music or browse categories:*`,
          footer: 'Professional Audio Streaming | CLOUD AI',
          buttons: [
            { id: 'btn_music_search', text: '🔍 Search Music' },
            { id: 'btn_music_pop', text: '🎤 Pop Hits' },
            { id: 'btn_music_hiphop', text: '🎧 Hip Hop' },
            { id: 'btn_music_afro', text: '🌍 Afro Beats' },
            { id: 'btn_music_help', text: '❓ How to Use' }
          ]
        });
        return;
      }
      
      // ... rest of your existing play command code ...
      
    } catch (error) {
      console.error('❌ Music Player Error:', error);
      m.reply(`❌ *Music Processing Error*\n\n` +
        `⚠️ **Error:** ${error.message}\n\n` +
        `_Please try a different song or try again later._`);
    }
  }
};
