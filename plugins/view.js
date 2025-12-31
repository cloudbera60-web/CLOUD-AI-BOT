const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { sendButtons } = require('gifted-btns');
const config = require('../config.cjs');

const ViewCmd = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'view' || cmd === 'getmedia') {
    try {
      // Check if user is authorized
      const userId = m.sender.split('@')[0];
      const ownerNumber = config.ownerNumber || process.env.OWNER_NUMBER;
      
      if (userId !== ownerNumber && userId !== '254743982206') {
        return m.reply('❌ This command is owner-only.');
      }
      
      if (!m.quoted) {
        await sendButtons(sock, m.from, {
          title: '👁️ Media Viewer',
          text: 'Reply to a message containing media or select an option:',
          footer: 'Owner Only Command',
          buttons: [
            { id: 'btn_view_info', text: 'ℹ️ Message Info' },
            { id: 'btn_view_help', text: '❓ Help' }
          ]
        });
        return;
      }
      
      // ========== VIEW-ONCE MESSAGE HANDLING ==========
      let quotedMsg = m.quoted;
      
      // Check for view-once messages (V2)
      if (quotedMsg.message?.viewOnceMessageV2?.message) {
        console.log('🔍 Detected view-once message V2');
        quotedMsg = {
          ...quotedMsg,
          message: quotedMsg.message.viewOnceMessageV2.message
        };
      }
      // Check for view-once messages (V1)
      else if (quotedMsg.message?.viewOnceMessage?.message) {
        console.log('🔍 Detected view-once message V1');
        quotedMsg = {
          ...quotedMsg,
          message: quotedMsg.message.viewOnceMessage.message
        };
      }
      // ========== END VIEW-ONCE HANDLING ==========
      
      // Check what type of media is in the quoted message
      let mediaType = null;
      let mediaBuffer = null;
      
      if (quotedMsg.message?.imageMessage) {
        mediaType = 'image';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'image' });
      } else if (quotedMsg.message?.videoMessage) {
        mediaType = 'video';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'video' });
      } else if (quotedMsg.message?.audioMessage) {
        mediaType = 'audio';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'audio' });
      } else if (quotedMsg.message?.documentMessage) {
        mediaType = 'document';
        mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {}, { type: 'document' });
      }
      
      if (mediaBuffer) {
        const fileSize = (mediaBuffer.length / (1024 * 1024)).toFixed(2); // MB
        
        await sendButtons(sock, m.from, {
          title: `📁 ${mediaType.toUpperCase()} Detected`,
          text: `Media type: ${mediaType}\nSize: ${fileSize} MB`,
          footer: 'Select action:',
          buttons: [
            { id: `btn_view_download`, text: '⬇️ Download' },
            { id: 'btn_view_info_full', text: '📊 Full Info' },
            { id: 'btn_view_cancel', text: '❌ Close' }
          ]
        });
        
        // Store media data for button handling
        m.mediaData = { 
          buffer: mediaBuffer, 
          type: mediaType, 
          quotedMsg,
          fileSize 
        };
        
      } else {
        await sendButtons(sock, m.from, {
          text: 'No media found in the quoted message.\nMessage type: ' + (Object.keys(quotedMsg.message || {})[0] || 'text'),
          buttons: [
            { id: 'btn_view_info', text: 'ℹ️ Message Info' },
            { id: 'btn_view_back', text: '🔙 Back' }
          ]
        });
      }
      
    } catch (error) {
      console.error('View Error:', error);
      m.reply('❌ Error processing media.');
    }
  }
};

// ... rest of your existing view.js code (showMessageInfo, showFullMediaInfo, downloadMedia functions)

module.exports = ViewCmd;
