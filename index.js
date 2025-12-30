// Load environment variables first
require('dotenv').config();

const express = require('express');
const path = require('path');
const app = express();
const bodyParser = require("body-parser");

// Get port from environment
const PORT = process.env.PORT || 50900;

const { 
  qrRoute,
  pairRoute
} = require('./routes');

require('events').EventEmitter.defaultMaxListeners = 2000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/qr', qrRoute);
app.use('/code', pairRoute);

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => {
    const pluginLoader = require('./plugin-loader');
    const database = require('./database');
    const { getActiveBots } = require('./bot-runner');
    
    res.json({
        status: 200,
        success: true,
        service: 'Gifted-Md Bot Runner',
        environment: process.env.NODE_ENV || 'production',
        timestamp: new Date().toISOString(),
        activeBots: Object.keys(getActiveBots()).length,
        mongoConnected: database.isConnected,
        pluginsLoaded: pluginLoader.plugins ? pluginLoader.plugins.size : 0,
        config: {
            botName: process.env.BOT_NAME || 'GIFTED-MD',
            mode: process.env.BOT_MODE || 'public',
            prefix: process.env.BOT_PREFIX || '.'
        }
    });
});

// Initialize bot system
async function startServer() {
    try {
        console.log('🚀 Starting Gifted-MD Bot Runner...');
        
        // Load configuration
        const configManager = require('./config-manager');
        await configManager.loadConfig();
        
        // Connect to MongoDB
        const database = require('./database');
        const dbConnected = await database.connect();
        
        if (dbConnected) {
            console.log('✅ MongoDB connected successfully');
        } else {
            console.log('⚠️ Running without database persistence');
        }
        
        // Load plugins
        const pluginLoader = require('./plugin-loader');
        const pluginCount = await pluginLoader.loadPlugins();
        console.log(`✅ ${pluginCount} plugin(s) loaded`);
        
        // Initialize bot system
        const { initializeBotSystem } = require('./bot-runner');
        const systemReady = await initializeBotSystem();
        
        if (systemReady) {
            app.listen(PORT, () => {
                console.log(`
╔══════════════════════════════════════════════════╗
║           GIFTED-MD BOT RUNNER                   ║
╠══════════════════════════════════════════════════╣
║  📍 Port: ${PORT}                                   ║
║  🤖 Bot Name: ${process.env.BOT_NAME || 'GIFTED-MD'}    ║
║  👑 Owner: ${process.env.OWNER_NAME || 'Gifted Tech'}   ║
║  🔧 Prefix: ${process.env.BOT_PREFIX || '.'}            ║
║  🗄️  MongoDB: ${database.isConnected ? '✅ Connected' : '❌ Disconnected'}
║  📦 Plugins: ${pluginCount} loaded                     ║
║  🔗 URL: http://localhost:${PORT}                     ║
╚══════════════════════════════════════════════════╝
                `);
                console.log('✅ Server is ready!');
                console.log(`• Visit http://localhost:${PORT} for the home page`);
                console.log(`• Visit http://localhost:${PORT}/pair for pairing`);
            });
        } else {
            console.error('❌ Failed to initialize bot system');
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Server startup error:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    const database = require('./database');
    await database.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n👋 Received termination signal...');
    const database = require('./database');
    await database.close();
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
