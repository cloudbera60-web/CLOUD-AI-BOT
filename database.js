const { MongoClient } = require('mongodb');

class Database {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
    }

    async connect() {
        try {
            const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
            const dbName = process.env.MONGODB_DB_NAME || 'giftedmd';
            const sessionTTLDays = parseInt(process.env.SESSION_TTL_DAYS) || 7;
            
            console.log(`🔗 Connecting to MongoDB...`);
            
            if (!mongoUri || mongoUri.trim() === '') {
                throw new Error('MONGODB_URI is not defined in environment variables');
            }
            
            console.log(`🔑 MongoDB URI: ${mongoUri.substring(0, 30)}...`);
            
            this.client = new MongoClient(mongoUri, {
                serverSelectionTimeoutMS: 15000,
                socketTimeoutMS: 45000,
                connectTimeoutMS: 15000,
                maxPoolSize: 50,
                minPoolSize: 5,
                retryWrites: true,
                w: 'majority'
            });
            
            await this.client.connect();
            await this.client.db('admin').command({ ping: 1 });
            
            this.db = this.client.db(dbName);
            this.isConnected = true;
            
            console.log(`✅ MongoDB connected to database: ${dbName}`);
            
            // Setup collections and indexes
            await this.setupCollections(sessionTTLDays);
            
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            
            if (process.env.NODE_ENV === 'development') {
                console.log('⚠️ Continuing without database in development mode');
                return false;
            }
            
            console.log('⚠️ Bot will run without database persistence');
            return false;
        }
    }

    async setupCollections(sessionTTLDays) {
        try {
            // Create sessions collection with TTL
            const collections = await this.db.listCollections().toArray();
            const collectionNames = collections.map(col => col.name);
            
            if (!collectionNames.includes('sessions')) {
                await this.db.createCollection('sessions');
                console.log('📁 Created sessions collection');
                
                // Create TTL index
                await this.db.collection('sessions').createIndex(
                    { updatedAt: 1 },
                    { expireAfterSeconds: sessionTTLDays * 86400 }
                );
            }
            
            // Create indexes
            await this.createIndexes();
            
        } catch (error) {
            console.error('Error setting up collections:', error.message);
        }
    }

    async createIndexes() {
        try {
            // Sessions collection indexes
            await this.db.collection('sessions').createIndex({ sessionId: 1 }, { unique: true });
            await this.db.collection('sessions').createIndex({ lastActivity: 1 });
            
            console.log('✅ Database indexes created/verified');
        } catch (error) {
            if (!error.message.includes('already exists')) {
                console.error('Error creating indexes:', error.message);
            }
        }
    }

    async saveSession(sessionId, authState) {
        if (!this.isConnected) {
            console.log('⚠️ Database not connected, skipping session save');
            return false;
        }
        
        try {
            const sessionData = {
                sessionId,
                creds: authState.creds,
                keys: authState.keys,
                updatedAt: new Date(),
                lastActivity: new Date(),
                botName: process.env.BOT_NAME || 'GIFTED-MD',
                status: 'active'
            };
            
            // Check if session already exists
            const existingSession = await this.db.collection('sessions').findOne({ sessionId });
            
            if (existingSession) {
                // Update existing session
                await this.db.collection('sessions').updateOne(
                    { sessionId },
                    { 
                        $set: {
                            ...sessionData,
                            creds: authState.creds,
                            keys: authState.keys
                        }
                    }
                );
            } else {
                // Insert new session
                sessionData.createdAt = new Date();
                await this.db.collection('sessions').insertOne(sessionData);
            }
            
            console.log(`💾 Session saved to MongoDB: ${sessionId}`);
            return true;
        } catch (error) {
            console.error('Error saving session to MongoDB:', error.message);
            return false;
        }
    }

    async getSession(sessionId) {
        if (!this.isConnected) {
            console.log('⚠️ Database not connected, cannot load session');
            return null;
        }
        
        try {
            const session = await this.db.collection('sessions').findOne({ sessionId });
            if (session) {
                // Update last accessed time
                await this.db.collection('sessions').updateOne(
                    { sessionId },
                    { $set: { lastAccessed: new Date() } }
                );
                
                console.log(`📂 Session loaded from MongoDB: ${sessionId}`);
                return {
                    creds: session.creds,
                    keys: session.keys
                };
            }
            console.log(`📭 Session not found in MongoDB: ${sessionId}`);
            return null;
        } catch (error) {
            console.error('Error getting session from MongoDB:', error.message);
            return null;
        }
    }

    async deleteSession(sessionId) {
        if (!this.isConnected) return false;
        
        try {
            const result = await this.db.collection('sessions').deleteOne({ sessionId });
            if (result.deletedCount > 0) {
                console.log(`🗑️ Session deleted from MongoDB: ${sessionId}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error deleting session from MongoDB:', error.message);
            return false;
        }
    }

    async close() {
        if (this.client) {
            try {
                await this.client.close();
                this.isConnected = false;
                console.log('🔒 MongoDB connection closed gracefully');
            } catch (error) {
                console.error('Error closing MongoDB connection:', error);
            }
        }
    }
}

const dbInstance = new Database();

process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down gracefully...');
    await dbInstance.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n👋 Received termination signal...');
    await dbInstance.close();
    process.exit(0);
});

module.exports = dbInstance;
