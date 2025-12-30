const fetch = require('node-fetch');
const FormData = require('form-data');
const { fileTypeFromBuffer } = require('file-type');
const { sendButtons } = require('gifted-btns');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'url' || cmd === 'upload') {
    try {
      if (!m.quoted) {
        await sendButtons(sock, m.from, {
          title: '🌐 Media Processing Center',
          text: `*CLOUD AI Media Processor*\n\n` +
                `📊 **Supported Formats:**\n` +
                `• Images (JPG, PNG, GIF)\n` +
                `• Videos (MP4, MOV)\n` +
                `• Audio (MP3, M4A)\n` +
                `• Documents (PDF, DOC)\n\n` +
                `📁 **Max Size:** 50MB\n` +
                `⚡ **Processing:** Instant\n\n` +
                `*How to use:* Reply to any media with .url`,
          footer: 'Professional Media Hosting | Secure & Fast',
          buttons: [
            { id: 'btn_url_tutorial', text: '📚 How to Use' },
            { id: 'btn_url_formats', text: '📋 Supported Formats' },
            { id: 'btn_url_cancel', text: '❌ Close' }
          ]
        });
        return;
      }
      
      const quotedMsg = m.quoted;
      
      // Check for media
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      const hasMedia = mediaTypes.some(type => quotedMsg[type]);
      
      if (!hasMedia) {
        return m.reply('❌ *No Media Detected*\nPlease reply to an image, video, audio, or document.');
      }
      
      await sendButtons(sock, m.from, {
        title: '⬆️ Media Upload Selection',
        text: `*MEDIA DETECTED*\n\n` +
              `✅ **Status:** Ready for Processing\n` +
              `📁 **Type:** ${Object.keys(quotedMsg).find(key => mediaTypes.includes(key))?.replace('Message', '') || 'Unknown'}\n` +
              `⚡ **Service:** Select hosting provider\n\n` +
              `*Choose upload service:*`,
        footer: 'CLOUD AI Professional Hosting',
        buttons: [
          { id: 'btn_url_tmpfiles', text: '🌐 TmpFiles (1 Hour)' },
          { id: 'btn_url_catbox', text: '📦 Catbox (Permanent)' },
          { id: 'btn_url_analysis', text: '📊 File Analysis' },
          { id: 'btn_url_cancel', text: '❌ Cancel' }
        ]
      });
      
      m.uploadData = { quotedMsg };
      
    } catch (error) {
      console.error('❌ URL Processor Error:', error);
      m.reply('❌ Media processing failed. Please try again.');
    }
  }
};
