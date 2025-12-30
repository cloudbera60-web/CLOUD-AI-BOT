const fs = require('fs').promises;
const path = require('path');

class PluginLoader {
    constructor() {
        this.plugins = new Map();
        this.pluginDir = path.join(__dirname, 'plugins');
    }

    async loadPlugins() {
        try {
            // Create plugins directory if it doesn't exist
            await fs.mkdir(this.pluginDir, { recursive: true });
            
            // Copy default plugins if directory is empty
            const files = await fs.readdir(this.pluginDir);
            if (files.length === 0) {
                console.log('📁 No plugins found, creating default plugins...');
                await this.createDefaultPlugins();
            }
            
            const pluginFiles = files.filter(file => file.endsWith('.js'));
            
            console.log(`📦 Found ${pluginFiles.length} plugin(s)`);
            
            for (const file of pluginFiles) {
                await this.loadPlugin(file);
            }
            
            return this.plugins.size;
        } catch (error) {
            console.error('Error loading plugins:', error);
            return 0;
        }
    }

    async loadPlugin(filename) {
        try {
            const pluginPath = path.join(this.pluginDir, filename);
            const pluginName = path.basename(filename, '.js');
            
            // Clear require cache to allow hot reload
            delete require.cache[require.resolve(pluginPath)];
            
            const pluginModule = require(pluginPath);
            
            if (typeof pluginModule === 'function') {
                this.plugins.set(pluginName, pluginModule);
                console.log(`✅ Loaded plugin: ${pluginName}`);
                return true;
            } else if (pluginModule.default && typeof pluginModule.default === 'function') {
                this.plugins.set(pluginName, pluginModule.default);
                console.log(`✅ Loaded plugin: ${pluginName}`);
                return true;
            } else {
                console.log(`⚠️ Plugin ${pluginName} doesn't export a function`);
                return false;
            }
        } catch (error) {
            console.error(`❌ Failed to load plugin ${filename}:`, error.message);
            return false;
        }
    }

    async executePlugin(pluginName, m, sock) {
        try {
            const plugin = this.plugins.get(pluginName);
            if (!plugin) {
                return { success: false, error: `Plugin ${pluginName} not found` };
            }
            
            await plugin(m, sock);
            return { success: true };
        } catch (error) {
            console.error(`Error executing plugin ${pluginName}:`, error);
            return { success: false, error: error.message };
        }
    }

    getPluginCommands() {
        const commands = {};
        for (const [name] of this.plugins) {
            commands[name] = name;
        }
        return commands;
    }

    async createDefaultPlugins() {
        // Create default plugins if none exist
        const defaultPlugins = {
            'menu.js': `const moment = require('moment-timezone');
const fs = require('fs');
const os = require('os');

module.exports = async (m, gss) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(" ")[0].toLowerCase() : "";
  
  if (['menu', 'help', 'list'].includes(cmd)) {
    const menu = \`🤖 *\${process.env.BOT_NAME || 'GIFTED-MD'}*\\n\\n📋 *Commands:*\\n• .menu - Show this menu\\n• .ping - Check bot speed\\n• .play [song] - Download music\\n• .owner - Contact owner\\n• .repo - Bot repository\\n\\n*Powered by \${process.env.OWNER_NAME || 'Gifted Tech'}*\`;
    await m.reply(menu);
  }
};`,
            
            'ping.js': `module.exports = async (m, Matrix) => {
  const prefix = process.env.BOT_PREFIX || '.';
  const cmd = m.body.startsWith(prefix) ? m.body.slice(prefix.length).split(' ')[0].toLowerCase() : '';
  
  if (cmd === "ping") {
    const start = Date.now();
    await m.reply(\`🏓 Pong! \`);
    const latency = Date.now() - start;
    await Matrix.sendMessage(m.from, { text: \`⏱️ Latency: \${latency}ms\` });
  }
};`
        };
        
        for (const [filename, content] of Object.entries(defaultPlugins)) {
            await fs.writeFile(path.join(this.pluginDir, filename), content);
        }
        
        console.log('✅ Created default plugins');
    }
}

// Singleton instance
const pluginLoader = new PluginLoader();
module.exports = pluginLoader;
