const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


// ======================
// MongoDB Connection
// ======================
mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log('✓ Connected to MongoDB');
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n========================================`);
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`========================================\n`);
    });
})
.catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
});


// ======================
// Schemas & Models
// ======================

const deviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    deviceName: String,
    phoneNumber: String,
    registeredAt: Number,
    lastHeartbeat: Number
}, { timestamps: true });


const callLogSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    deviceId: { type: String, required: true, index: true },
    phoneNumber: { type: String, index: true },
    contactName: String,
    callType: { type: String, index: true },
    callDate: { type: Number, index: true },
    callDuration: Number,
    timestamp: Number
}, { timestamps: true });

callLogSchema.index({ callDate: -1 });

const Device = mongoose.model('Device', deviceSchema);
const CallLog = mongoose.model('CallLog', callLogSchema);



// ======================
// API Routes
// ======================

// Register device
app.post('/api/devices/register', async (req, res) => {
    try {
        const { deviceId, deviceName, phoneNumber, registeredAt } = req.body;

        await Device.findOneAndUpdate(
            { deviceId },
            {
                deviceName,
                phoneNumber,
                registeredAt,
                lastHeartbeat: Date.now()
            },
            { upsert: true }
        );

        res.json({ success: true, message: 'Device registered successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to register device' });
    }
});


// Device heartbeat
app.post('/api/devices/heartbeat', async (req, res) => {
    try {
        const { deviceId, timestamp } = req.body;

        await Device.updateOne(
            { deviceId },
            { lastHeartbeat: timestamp }
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update heartbeat' });
    }
});


// Get all devices
app.get('/api/devices', async (req, res) => {
    try {
        const devices = await Device.find().sort({ registeredAt: -1 });
        res.json({ devices });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch devices' });
    }
});


// Sync call logs (batch)
app.post('/api/call-logs/sync', async (req, res) => {
    try {
        const { deviceId, callLogs } = req.body;

        if (!Array.isArray(callLogs)) {
            return res.status(400).json({ error: 'Invalid call logs data' });
        }

        const bulkOps = callLogs.map(log => ({
            updateOne: {
                filter: { id: log.id || `${Date.now()}_${Math.random()}` },
                update: {
                    id: log.id,
                    deviceId,
                    phoneNumber: log.phoneNumber,
                    contactName: log.contactName,
                    callType: log.callType,
                    callDate: log.callDate,
                    callDuration: log.callDuration,
                    timestamp: log.timestamp || Date.now()
                },
                upsert: true
            }
        }));

        await CallLog.bulkWrite(bulkOps);

        res.json({ success: true, message: `Synced ${callLogs.length} call logs` });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to sync call logs' });
    }
});


// Get call logs with filters
app.get('/api/call-logs', async (req, res) => {
    try {
        const { deviceId, phoneNumber, callType, startDate, endDate, limit = 100 } = req.query;

        const filter = {};

        if (deviceId) filter.deviceId = deviceId;
        if (phoneNumber) filter.phoneNumber = phoneNumber;
        if (callType) filter.callType = callType;
        if (startDate || endDate) {
            filter.callDate = {};
            if (startDate) filter.callDate.$gte = parseInt(startDate);
            if (endDate) filter.callDate.$lte = parseInt(endDate);
        }

        const logs = await CallLog.find(filter)
            .sort({ callDate: -1 })
            .limit(parseInt(limit));

        res.json({ callLogs: logs, count: logs.length });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch call logs' });
    }
});


// Statistics
app.get('/api/statistics', async (req, res) => {
    try {
        const totalDevices = await Device.countDocuments();
        const totalCallLogs = await CallLog.countDocuments();

        const callsByType = await CallLog.aggregate([
            { $group: { _id: "$callType", count: { $sum: 1 } } }
        ]);

        const topContacts = await CallLog.aggregate([
            { $group: { _id: "$phoneNumber", contactName: { $first: "$contactName" }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.json({
            totalDevices,
            totalCallLogs,
            callsByType,
            topContacts
        });

    } catch (err) {
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});


// Web Routes
app.get('/', (req, res) => res.render('dashboard'));
app.get('/devices', (req, res) => res.render('devices'));
app.get('/logs/:phoneNumber?', (req, res) =>
    res.render('logs', { phoneNumber: req.params.phoneNumber || '' })
);
