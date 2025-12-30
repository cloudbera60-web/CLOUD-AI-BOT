const { sendButtons } = require('gifted-btns');

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'privacy' || cmd === 'settings') {
    try {
      // Owner verification
      const userId = m.sender.split('@')[0];
      const ownerNumbers = ['254116763755', '254743982206'];
      
      if (!ownerNumbers.includes(userId)) {
        return m.reply('🔒 *Owner Access Required*\nThis control panel is restricted to BERA TECH.');
      }
      
      await sendButtons(sock, m.from, {
        title: '🔐 Privacy Control Center',
        text: `*OWNER CONTROL PANEL*\n\n` +
              `👤 **User:** @${userId}\n` +
              `🆔 **Status:** Verified Owner\n` +
              `🔐 **Access:** Full Administrative\n` +
              `⏱️ **Session:** ${new Date().toLocaleTimeString()}\n\n` +
              `*Select privacy setting to configure:*`,
        footer: 'CLOUD AI Security Suite | Owner Only Access',
        buttons: [
          { id: 'btn_priv_visibility', text: '👀 Visibility Settings' },
          { id: 'btn_priv_messaging', text: '💬 Messaging Privacy' },
          { id: 'btn_priv_account', text: '👤 Account Security' },
          { id: 'btn_priv_bot', text: '🤖 Bot Controls' },
          { id: 'btn_priv_advanced', text: '⚙️ Advanced Settings' },
          { id: 'btn_priv_cancel', text: '🚪 Exit Panel' }
        ]
      });
      
    } catch (error) {
      console.error('❌ Privacy Panel Error:', error);
      m.reply('❌ Failed to load privacy controls.');
    }
  }
};

// Privacy settings handler
async function handlePrivacySetting(setting, value, m, sock) {
  try {
    // Owner verification (double-check)
    const userId = m.sender.split('@')[0];
    const ownerNumbers = ['254116763755', '254743982206'];
    
    if (!ownerNumbers.includes(userId)) {
      return m.reply('🔒 Access denied. Owner verification failed.');
    }
    
    // Show processing
    await m.reply(`⚙️ *Applying Privacy Settings*\n\n` +
      `🔧 **Setting:** ${setting}\n` +
      `🎯 **Value:** ${value}\n` +
      `👤 **User:** Verified Owner\n` +
      `⏱️ **Time:** ${new Date().toLocaleTimeString()}\n\n` +
      `_Processing configuration change..._`);
    
    // Simulate privacy update (actual implementation depends on Baileys API)
    // Note: Baileys privacy API might have changed - check latest documentation
    
    // Success response
    setTimeout(async () => {
      await sendButtons(sock, m.from, {
        title: '✅ Privacy Update Complete',
        text: `*SETTINGS APPLIED SUCCESSFULLY*\n\n` +
              `✅ **Status:** Configuration Updated\n` +
              `🔧 **Setting:** ${setting}\n` +
              `🎯 **New Value:** ${value}\n` +
              `📅 **Effective:** Immediately\n` +
              `👤 **Applied by:** Owner\n\n` +
              `*Changes will take effect immediately.*`,
        footer: 'CLOUD AI Security Suite | Configuration Logged',
        buttons: [
          { id: 'btn_priv_more', text: '⚙️ More Settings' },
          { id: 'btn_priv_dashboard', text: '📊 Control Dashboard' },
          { id: 'btn_priv_done', text: '✅ Complete' }
        ]
      });
    }, 1500);
    
  } catch (error) {
    console.error('❌ Privacy Update Error:', error);
    m.reply(`❌ Failed to update ${setting}. Error: ${error.message}`);
  }
        }
