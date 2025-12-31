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
      
      // ========== VIEW-ONCE MESSAGE HANDLING ==========
      let quotedMsg = m.quoted;
      
      // Check for view-once messages (V2)
      if (quotedMsg.message?.viewOnceMessageV2?.message) {
        console.log('🔍 Detected view-once message V2 for upload');
        quotedMsg = {
          ...quotedMsg,
          message: quotedMsg.message.viewOnceMessageV2.message
        };
      }
      // Check for view-once messages (V1)
      else if (quotedMsg.message?.viewOnceMessage?.message) {
        console.log('🔍 Detected view-once message V1 for upload');
        quotedMsg = {
          ...quotedMsg,
          message: quotedMsg.message.viewOnceMessage.message
        };
      }
      // ========== END VIEW-ONCE HANDLING ==========
      
      // Check for media
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      const hasMedia = mediaTypes.some(type => quotedMsg.message?.[type]);
      
      if (!hasMedia) {
        return m.reply('❌ *No Media Detected*\nPlease reply to an image, video, audio, or document.');
      }
      
      await sendButtons(sock, m.from, {
        title: '⬆️ Media Upload Selection',
        text: `*MEDIA DETECTED*\n\n` +
              `✅ **Status:** Ready for Processing\n` +
              `📁 **Type:** ${Object.keys(quotedMsg.message || {}).find(key => mediaTypes.includes(key))?.replace('Message', '') || 'Unknown'}\n` +
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
      
      // Store the actual quoted message for processing
      m.uploadData = { quotedMsg };
      
    } catch (error) {
      console.error('❌ URL Processor Error:', error);
      m.reply('❌ Media processing failed. Please try again.');
    }
  }
};

// Add this function to handle actual uploads (call from bot-runner.js)
async function handleMediaUpload(m, sock, service) {
  try {
    const { quotedMsg } = m.uploadData;
    
    // Determine media type
    let mediaType = '';
    if (quotedMsg.message?.imageMessage) mediaType = 'image';
    else if (quotedMsg.message?.videoMessage) mediaType = 'video';
    else if (quotedMsg.message?.audioMessage) mediaType = 'audio';
    else if (quotedMsg.message?.documentMessage) mediaType = 'document';
    
    await m.reply(`⚙️ Uploading ${mediaType} to ${service === 'tmpfiles' ? 'TmpFiles.org' : 'Catbox.moe'}...`);
    
    const mediaBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
    const fileSizeMB = (mediaBuffer.length / (1024 * 1024)).toFixed(2);
    
    if (fileSizeMB > 50) {
      return m.reply(`❌ *File Too Large*\n\nSize: ${fileSizeMB}MB\nLimit: 50MB\n\nPlease use a smaller file.`);
    }
    
    let uploadUrl = '';
    let serviceName = '';
    
    if (service === 'tmpfiles') {
      serviceName = 'TmpFiles.org';
      const { ext } = await fileTypeFromBuffer(mediaBuffer);
      const form = new FormData();
      form.append('file', mediaBuffer, `cloudai_${Date.now()}.${ext}`);
      
      const response = await fetch('https://tmpfiles.org/api/v1/upload', {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('TmpFiles upload failed');
      
      const responseData = await response.json();
      uploadUrl = responseData.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      
    } else if (service === 'catbox') {
      serviceName = 'Catbox.moe';
      const form = new FormData();
      form.append('reqtype', 'fileupload');
      form.append('fileToUpload', mediaBuffer, 'file');
      
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form
      });
      
      if (!response.ok) throw new Error('Catbox upload failed');
      
      uploadUrl = await response.text();
    }
    
    const result = `✅ *Upload Successful*\n\n` +
                  `🌐 Service: ${serviceName}\n` +
                  `📁 Size: ${fileSizeMB}MB\n` +
                  `🔗 URL: ${uploadUrl}\n\n` +
                  `Link expires: ${service === 'tmpfiles' ? '1 hour' : 'Permanent'}`;
    
    await sock.sendMessage(m.from, { text: result }, { quoted: m });
    
  } catch (error) {
    console.error('Upload Error:', error);
    await m.reply(`❌ ${service} upload failed: ${error.message}`);
  }
}

// Export the function for bot-runner.js
module.exports.handleMediaUpload = handleMediaUpload;
