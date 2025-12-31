const axios = require('axios');
const { sendButtons } = require('gifted-btns');

// Move logoStyles outside the function for better performance
const logoStyles = {
  'blackpink': 'https://api.davidcyriltech.my.id/logo/blackpink?text=',
  'glossysilver': 'https://api.davidcyriltech.my.id/logo/glossysilver?text=',
  'naruto': 'https://api.davidcyriltech.my.id/logo/Naruto?text=',
  'digitalglitch': 'https://api.davidcyriltech.my.id/logo/digitalglitch?text=',
  'pixelglitch': 'https://api.davidcyriltech.my.id/logo/pixelglitch?text=',
  'water': 'https://api.davidcyriltech.my.id/logo/water?text=',
  'bulb': 'https://api.davidcyriltech.my.id/logo/bulb?text=',
  'zodiac': 'https://api.davidcyriltech.my.id/logo/zodiac?text=',
  'water3d': 'https://api.davidcyriltech.my.id/logo/water3D?text=',
  'dragonfire': 'https://api.davidcyriltech.my.id/logo/dragonfire?text=',
  'bokeh': 'https://api.davidcyriltech.my.id/logo/bokeh?text=',
  'queencard': 'https://api.davidcyriltech.my.id/logo/Queencard?text=',
  'birthdaycake': 'https://api.davidcyriltech.my.id/logo/birthdaycake?text=',
  'underwater': 'https://api.davidcyriltech.my.id/logo/underwater?text=',
  'glow': 'https://api.davidcyriltech.my.id/logo/glow?text=',
  'wetglass': 'https://api.davidcyriltech.my.id/logo/wetglass?text=',
  'graffiti': 'https://api.davidcyriltech.my.id/logo/graffiti?text=',
  'halloween': 'https://api.davidcyriltech.my.id/logo/halloween?text=',
  'luxury': 'https://api.davidcyriltech.my.id/logo/luxury?text=',
  'avatar': 'https://api.davidcyriltech.my.id/logo/avatar?text=',
  'blood': 'https://api.davidcyriltech.my.id/logo/blood?text=',
  'hacker': 'https://api.davidcyriltech.my.id/logo/hacker?text=',
  'paint': 'https://api.davidcyriltech.my.id/logo/paint?text=',
  'rotation': 'https://api.davidcyriltech.my.id/logo/rotation?text=',
  'graffiti2': 'https://api.davidcyriltech.my.id/logo/graffiti2?text=',
  'typography': 'https://api.davidcyriltech.my.id/logo/typography?text=',
  'horror': 'https://api.davidcyriltech.my.id/logo/horror?text=',
  'valentine': 'https://api.davidcyriltech.my.id/logo/valentine?text=',
  'team': 'https://api.davidcyriltech.my.id/logo/team?text=',
  'gold': 'https://api.davidcyriltech.my.id/logo/gold?text=',
  'pentakill': 'https://api.davidcyriltech.my.id/logo/pentakill?text=',
  'galaxy': 'https://api.davidcyriltech.my.id/logo/galaxy?text=',
  'birthdayflower': 'https://api.davidcyriltech.my.id/logo/birthdayflower?text=',
  'pubg': 'https://api.davidcyriltech.my.id/logo/pubg?text=',
  'sand3d': 'https://api.davidcyriltech.my.id/logo/sand3D?text=',
  'wall': 'https://api.davidcyriltech.my.id/logo/wall?text=',
  'womensday': 'https://api.davidcyriltech.my.id/logo/womensday?text=',
  'thunder': 'https://api.davidcyriltech.my.id/logo/thunder?text=',
  'snow': 'https://api.davidcyriltech.my.id/logo/snow?text=',
  'textlight': 'https://api.davidcyriltech.my.id/logo/textlight?text=',
  'sand': 'https://api.davidcyriltech.my.id/logo/sand?text='
};

module.exports = async (m, sock) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === 'logo') {
    try {
      const args = m.body.slice(prefix.length + cmd.length).trim().split(' ');
      const style = args[0];
      const text = args.slice(1).join(' ');
      
      if (!style) {
        // Show logo categories with dynamic count
        await sendButtons(sock, m.from, {
          title: '🎨 Logo Generator',
          text: `*How to use:*\n\n1. Click "Logo Maker" in Fun Menu\n2. Browse categories\n3. Select a style\n4. Type the command shown\n\nOr type directly:\n.logo [style] [text]\nExample: .logo glow CLOUD AI\n\nTotal styles available: ${Object.keys(logoStyles).length}`,
          footer: 'Navigate through menus or type directly',
          buttons: [
            { id: 'btn_logo_menu', text: '🎨 Browse Styles' },
            { id: 'btn_menu_fun', text: '🔙 Back to Fun' },
            { id: 'btn_menu_back', text: '🏠 Main Menu' }
          ]
        });
        return;
      }
      
      if (!logoStyles[style.toLowerCase()]) {
        return m.reply(`❌ Invalid logo style!\n\nAvailable styles:\n${Object.keys(logoStyles).slice(0, 10).join(', ')}...\n\nUse .logo to see all styles or browse through the menu.`);
      }
      
      if (!text) {
        return m.reply(`❌ Please provide text!\nUsage: .logo ${style} [your text]\nExample: .logo ${style} CLOUD AI`);
      }
      
      if (text.length > 50) {
        return m.reply(`❌ Text too long! Maximum 50 characters.\n\nYour text: ${text.length} characters`);
      }
      
      // Send processing reaction
      await m.React('⏳');
      
      const apiUrl = logoStyles[style.toLowerCase()] + encodeURIComponent(text);
      const response = await axios.get(apiUrl, { timeout: 30000 });
      
      if (response.data && response.data.result && response.data.result.url) {
        const imageUrl = response.data.result.url;
        
        await sock.sendMessage(m.from, {
          image: { url: imageUrl },
          caption: `✅ Logo created!\nStyle: ${style}\nText: ${text}\n\nWant another logo? Click the button below!`
        }, { quoted: m });
        
        // Show options for another logo
        await sendButtons(sock, m.from, {
          title: '🎨 Another Logo?',
          text: 'Create another logo or browse styles:',
          footer: 'Logo Generator',
          buttons: [
            { id: 'btn_logo_menu', text: '🎨 Browse Styles' },
            { id: 'btn_menu_fun', text: '🎮 Fun Menu' },
            { id: 'btn_menu_back', text: '🏠 Main Menu' }
          ]
        });
        
        await m.React('✅');
      } else {
        throw new Error('API returned no image URL');
      }
      
    } catch (error) {
      console.error('Logo Error:', error);
      await m.reply(`❌ Failed to generate logo: ${error.message}\n\nTry a different style or shorter text.`);
      await m.React('❌');
    }
  }
};

// Export the logo styles for bot-runner.js to use
module.exports.logoStyles = logoStyles;

// Export function to get logo categories
module.exports.getLogoCategories = () => {
  return {
    'popular': ['blackpink', 'glow', 'naruto', 'hacker', 'luxury', 'avatar'],
    'water': ['water', 'water3d', 'underwater', 'wetglass', 'bulb'],
    'glow': ['glossysilver', 'gold', 'textlight', 'bokeh'],
    'creative': ['graffiti', 'paint', 'typography', 'rotation', 'digitalglitch'],
    'backgrounds': ['galaxy', 'blood', 'snow', 'thunder', 'sand', 'wall'],
    'special': ['birthdaycake', 'halloween', 'valentine', 'pubg', 'zodiac', 'team']
  };
};
