const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Database setup
const db = new sqlite3.Database('./call_logs.db', async (err) => {
    if (err) {
        console.error('Error opening database:', err);
        process.exit(1);
    } else {
        console.log('Connected to SQLite database');
        try {
            await initializeDatabase();
            console.log('✓ Database initialized successfully');
            
            // Start server only after database is ready
            app.listen(PORT, '0.0.0.0', () => {
                console.log(`\n========================================`);
                console.log(`Server running on http://localhost:${PORT}`);
                console.log(`Admin Dashboard: http://localhost:${PORT}`);
                console.log(`========================================\n`);
            });
        } catch (error) {
            console.error('Error initializing database:', error);
            process.exit(1);
        }
    }
});

// Initialize database tables
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Devices table
            db.run(`
                CREATE TABLE IF NOT EXISTS devices (
                    device_id TEXT PRIMARY KEY,
                    device_name TEXT,
                    phone_number TEXT,
                    registered_at INTEGER,
                    last_heartbeat INTEGER
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating devices table:', err);
                    reject(err);
                } else {
                    console.log('✓ Devices table ready');
                }
            });

            // Call logs table
            db.run(`
                CREATE TABLE IF NOT EXISTS call_logs (
                    id TEXT PRIMARY KEY,
                    device_id TEXT,
                    phone_number TEXT,
                    contact_name TEXT,
                    call_type TEXT,
                    call_date INTEGER,
                    call_duration INTEGER,
                    timestamp INTEGER,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id)
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating call_logs table:', err);
                    reject(err);
                } else {
                    console.log('✓ Call logs table ready');
                }
            });

            // Create indexes for better query performance
            db.run(`CREATE INDEX IF NOT EXISTS idx_device_id ON call_logs(device_id)`, (err) => {
                if (err) console.error('Error creating idx_device_id:', err);
                else console.log('✓ Index idx_device_id ready');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_phone_number ON call_logs(phone_number)`, (err) => {
                if (err) console.error('Error creating idx_phone_number:', err);
                else console.log('✓ Index idx_phone_number ready');
            });
            
            db.run(`CREATE INDEX IF NOT EXISTS idx_call_date ON call_logs(call_date)`, (err) => {
                if (err) console.error('Error creating idx_call_date:', err);
                else console.log('✓ Index idx_call_date ready');
                resolve();
            });
        });
    });
}

// API Routes
console.log('Setting up API routes...');
// Register device
app.post('/api/devices/register', (req, res) => {
    const { deviceId, deviceName, phoneNumber, registeredAt } = req.body;
    
    const sql = `INSERT OR REPLACE INTO devices (device_id, device_name, phone_number, registered_at, last_heartbeat)
                 VALUES (?, ?, ?, ?, ?)`;
    
    db.run(sql, [deviceId, deviceName, phoneNumber, registeredAt, Date.now()], function(err) {
        if (err) {
            console.error('Error registering device:', err);
            return res.status(500).json({ error: 'Failed to register device' });
        }
        res.json({ success: true, message: 'Device registered successfully' });
    });
});

// Device heartbeat
app.post('/api/devices/heartbeat', (req, res) => {
    const { deviceId, timestamp } = req.body;
    
    const sql = `UPDATE devices SET last_heartbeat = ? WHERE device_id = ?`;
    
    db.run(sql, [timestamp, deviceId], function(err) {
        if (err) {
            console.error('Error updating heartbeat:', err);
            return res.status(500).json({ error: 'Failed to update heartbeat' });
        }
        res.json({ success: true });
    });
});

// Get all devices
app.get('/api/devices', (req, res) => {
    const sql = `SELECT * FROM devices ORDER BY registered_at DESC`;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching devices:', err);
            return res.status(500).json({ error: 'Failed to fetch devices' });
        }
        res.json({ devices: rows });
    });
});

// Sync call logs (batch)
app.post('/api/call-logs/sync', (req, res) => {
    const { deviceId, callLogs } = req.body;
    
    if (!callLogs || !Array.isArray(callLogs)) {
        return res.status(400).json({ error: 'Invalid call logs data' });
    }
    
    const sql = `INSERT OR REPLACE INTO call_logs 
                 (id, device_id, phone_number, contact_name, call_type, call_date, call_duration, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    const stmt = db.prepare(sql);
    
    callLogs.forEach(log => {
        stmt.run([
            log.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            deviceId,
            log.phoneNumber,
            log.contactName,
            log.callType,
            log.callDate,
            log.callDuration,
            log.timestamp || Date.now()
        ]);
    });
    
    stmt.finalize((err) => {
        if (err) {
            console.error('Error syncing call logs:', err);
            return res.status(500).json({ error: 'Failed to sync call logs' });
        }
        res.json({ success: true, message: `Synced ${callLogs.length} call logs` });
    });
});

// Add single call log
app.post('/api/call-logs', (req, res) => {
    const callLog = req.body;
    
    const sql = `INSERT OR REPLACE INTO call_logs 
                 (id, device_id, phone_number, contact_name, call_type, call_date, call_duration, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(sql, [
        callLog.id || `${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        callLog.deviceId,
        callLog.phoneNumber,
        callLog.contactName,
        callLog.callType,
        callLog.callDate,
        callLog.callDuration,
        callLog.timestamp || Date.now()
    ], function(err) {
        if (err) {
            console.error('Error adding call log:', err);
            return res.status(500).json({ error: 'Failed to add call log' });
        }
        res.status(201).json({ success: true, message: 'Call log added successfully' });
    });
});

// Get all call logs with optional filters
app.get('/api/call-logs', (req, res) => {
    const { deviceId, phoneNumber, callType, startDate, endDate, limit = 100 } = req.query;
    
    let sql = `SELECT cl.*, d.device_name 
               FROM call_logs cl 
               LEFT JOIN devices d ON cl.device_id = d.device_id 
               WHERE 1=1`;
    const params = [];
    
    if (deviceId) {
        sql += ` AND cl.device_id = ?`;
        params.push(deviceId);
    }
    
    if (phoneNumber) {
        sql += ` AND cl.phone_number = ?`;
        params.push(phoneNumber);
    }
    
    if (callType) {
        sql += ` AND cl.call_type = ?`;
        params.push(callType);
    }
    
    if (startDate) {
        sql += ` AND cl.call_date >= ?`;
        params.push(parseInt(startDate));
    }
    
    if (endDate) {
        sql += ` AND cl.call_date <= ?`;
        params.push(parseInt(endDate));
    }
    
    sql += ` ORDER BY cl.call_date DESC LIMIT ?`;
    params.push(parseInt(limit));
    
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching call logs:', err);
            return res.status(500).json({ error: 'Failed to fetch call logs' });
        }
        res.json({ callLogs: rows, count: rows.length });
    });
});

// Get call logs for a specific phone number across all devices
app.get('/api/call-logs/number/:phoneNumber', (req, res) => {
    const { phoneNumber } = req.params;
    const { limit = 100 } = req.query;
    
    const sql = `SELECT cl.*, d.device_name, d.phone_number as device_phone
                 FROM call_logs cl 
                 LEFT JOIN devices d ON cl.device_id = d.device_id 
                 WHERE cl.phone_number = ?
                 ORDER BY cl.call_date DESC 
                 LIMIT ?`;
    
    db.all(sql, [phoneNumber, parseInt(limit)], (err, rows) => {
        if (err) {
            console.error('Error fetching call logs for number:', err);
            return res.status(500).json({ error: 'Failed to fetch call logs' });
        }
        res.json({ phoneNumber, callLogs: rows, count: rows.length });
    });
});

// Get statistics
app.get('/api/statistics', (req, res) => {
    const stats = {};
    
    // Total devices
    db.get(`SELECT COUNT(*) as count FROM devices`, [], (err, row) => {
        if (err) {
            console.error('Error getting device count:', err);
            return res.status(500).json({ error: 'Failed to get statistics' });
        }
        stats.totalDevices = row.count;
        
        // Total call logs
        db.get(`SELECT COUNT(*) as count FROM call_logs`, [], (err, row) => {
            if (err) {
                console.error('Error getting call log count:', err);
                return res.status(500).json({ error: 'Failed to get statistics' });
            }
            stats.totalCallLogs = row.count;
            
            // Call logs by type
            db.all(`SELECT call_type, COUNT(*) as count FROM call_logs GROUP BY call_type`, [], (err, rows) => {
                if (err) {
                    console.error('Error getting call type stats:', err);
                    return res.status(500).json({ error: 'Failed to get statistics' });
                }
                stats.callsByType = rows;
                
                // Top contacted numbers
                db.all(`SELECT phone_number, contact_name, COUNT(*) as count 
                        FROM call_logs 
                        GROUP BY phone_number 
                        ORDER BY count DESC 
                        LIMIT 10`, [], (err, rows) => {
                    if (err) {
                        console.error('Error getting top contacts:', err);
                        return res.status(500).json({ error: 'Failed to get statistics' });
                    }
                    stats.topContacts = rows;
                    res.json(stats);
                });
            });
        });
    });
});

app.delete('/api/admin/clear-db', (req, res) => {
    db.serialize(() => {
        db.run(`DELETE FROM call_logs`);
        db.run(`DELETE FROM devices`);
    });

    res.json({ success: true, message: 'Database cleared successfully' });
});

// Web Dashboard Routes
app.get('/', (req, res) => {
    res.render('dashboard');
});

app.get('/devices', (req, res) => {
    res.render('devices');
});

app.get('/logs/:phoneNumber?', (req, res) => {
    res.render('logs', { phoneNumber: req.params.phoneNumber || '' });
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('Database connection closed');
        }
        process.exit(0);
    });
});
