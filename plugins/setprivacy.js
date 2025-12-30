import { WA_DEFAULT_EPHEMERAL } from '@whiskeysockets/baileys';
import { sendButtons } from 'gifted-btns';

const privacyHandler = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const triggers = ['privacy', 'setpriv', 'priv'];
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (triggers.some(t => cmd === t)) {
    try {
      // Check if user is owner
      const userId = m.sender.split('@')[0];
      const ownerNumbers = ['254116763755', '254743982206'];
      
      if (!ownerNumbers.includes(userId)) {
        return m.reply('❌ This command is owner-only.');
      }
      
      // Show privacy options with buttons
      await sendButtons(sock, m.from, {
        title: '🔐 Privacy Settings',
        text: 'Select privacy setting to configure:',
        footer: 'Owner Only | CLOUD AI',
        buttons: [
          { id: 'btn_priv_lastseen', text: '👀 Last Seen' },
          { id: 'btn_priv_profile', text: '📸 Profile Photo' },
          { id: 'btn_priv_status', text: '📝 Status' },
          { id: 'btn_priv_disappear', text: '⏰ Disappearing Msgs' },
          { id: 'btn_priv_groupadd', text: '👥 Group Add' },
          { id: 'btn_priv_cancel', text: '❌ Cancel' }
        ]
      });
      
    } catch (error) {
      console.error('Privacy Error:', error);
      m.reply('❌ Error loading privacy settings.');
    }
  }
};

// Button handler for Privacy
const handlePrivacyButton = async (m, sock, buttonId) => {
  const privacyOptions = {
    'btn_priv_lastseen': {
      title: '👀 Last Seen Privacy',
      options: ['all', 'contacts', 'none'],
      labels: ['👁️ Everyone', '📱 My Contacts', '🙈 Nobody']
    },
    'btn_priv_profile': {
      title: '📸 Profile Photo Privacy',
      options: ['all', 'contacts', 'none'],
      labels: ['👁️ Everyone', '📱 My Contacts', '🙈 Nobody']
    },
    'btn_priv_status': {
      title: '📝 Status Privacy',
      options: ['all', 'contacts', 'none'],
      labels: ['👁️ Everyone', '📱 My Contacts', '🙈 Nobody']
    },
    'btn_priv_groupadd': {
      title: '👥 Group Add Privacy',
      options: ['all', 'contacts', 'none'],
      labels: ['👁️ Everyone', '📱 My Contacts', '🙈 Nobody']
    },
    'btn_priv_disappear': {
      title: '⏰ Disappearing Messages',
      options: [0, WA_DEFAULT_EPHEMERAL, 86400, 604800],
      labels: ['❌ Off', '⏰ 24 Hours', '📅 7 Days', '♾️ 90 Days']
    }
  };
  
  if (buttonId === 'btn_priv_cancel') {
    return m.reply('✅ Privacy settings cancelled.');
  }
  
  const setting = privacyOptions[buttonId];
  if (!setting) return;
  
  // Show options for the selected setting
  const buttons = setting.options.map((option, index) => ({
    id: `btn_priv_set_${buttonId.replace('btn_priv_', '')}_${option}`,
    text: setting.labels[index]
  }));
  
  buttons.push({ id: 'btn_priv_back', text: '🔙 Back' });
  
  await sendButtons(sock, m.from, {
    title: setting.title,
    text: 'Select privacy level:',
    footer: 'CLOUD AI Privacy Manager',
    buttons: buttons
  });
  
  // Store setting type for next selection
  m.privacySetting = buttonId.replace('btn_priv_', '');
};

// Apply privacy setting
const applyPrivacySetting = async (m, sock, settingType, value) => {
  try {
    await m.reply(`⏳ Updating ${settingType} privacy...`);
    
    if (settingType === 'disappear') {
      await sock.updateDisappearingMode(value);
    } else {
      await sock.updatePrivacySettings(settingType, value);
    }
    
    const readableValue = settingType === 'disappear' 
      ? value === 0 ? 'Off' : `${value / 3600} hours`
      : value;
    
    await sendButtons(sock, m.from, {
      title: '✅ Privacy Updated',
      text: `Setting: ${settingType}\nValue: ${readableValue}\n\nChanges applied successfully!`,
      footer: 'CLOUD AI Privacy',
      buttons: [
        { id: 'btn_priv_more', text: '⚙️ More Settings' },
        { id: 'btn_priv_done', text: '✅ Done' }
      ]
    });
    
  } catch (error) {
    console.error('Privacy Update Error:', error);
    m.reply(`❌ Failed to update ${settingType} privacy. Check console for details.`);
  }
};

module.exports = privacyHandler;