// whatsapp.js - Perbaikan masalah QR code
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode');
const config = require('./config');
const utils = require('./utils');

// Buat direktori session jika belum ada
if (!fs.existsSync(config.SESSION_DIR)) {
    fs.mkdirSync(config.SESSION_DIR, { recursive: true });
}

// Map untuk menyimpan instance WhatsApp
const sessions = new Map();

// Map untuk callbacks
const qrCallbacks = new Map();
const connectCallbacks = new Map();
const disconnectCallbacks = new Map();

// WhatsApp helper functions
const whatsapp = {
    // Connect ke WhatsApp dengan session baru atau yang sudah ada
    connect: async (sessionId) => {
        try {
            // Setup path session
            const sessionDir = path.join(config.SESSION_DIR, sessionId);
            
            if (!fs.existsSync(sessionDir)) {
                fs.mkdirSync(sessionDir, { recursive: true });
            }
            
            // Setup auth state
            const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
            
            // Logger silent untuk menghindari log yang terlalu banyak
            const logger = pino({ level: 'silent' });
            
            // Buat socket connection
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                logger
            });
            
            // Handle connection events
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                // Handling QR code
                if (qr) {
                    console.log('QR Code received:', qr.length);
                    
                    try {
                        // Simpan QR sebagai file gambar
                        const qrPath = path.join(config.TEMP_DIR, `qr_${sessionId}.png`);
                        await qrcode.toFile(qrPath, qr, {
                            scale: 8,
                            margin: 1
                        });
                        
                        // Panggil callback dengan path file QR
                        if (qrCallbacks.has(sessionId)) {
                            qrCallbacks.get(sessionId)(qrPath);
                        }
                    } catch (err) {
                        console.error('Error generating QR code image:', err);
                    }
                }
                
                // Connection update
                if (connection === 'close') {
                    // Cek apakah perlu reconnect
                    const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                    
                    console.log(`Connection closed. Reconnect: ${shouldReconnect}`);
                    
                    if (shouldReconnect) {
                        // Reconnect dengan delay
                        setTimeout(() => {
                            console.log(`Reconnecting ${sessionId}...`);
                            whatsapp.connect(sessionId);
                        }, 2000);
                    } else {
                        // Logout
                        console.log(`Session ${sessionId} logged out`);
                        sessions.delete(sessionId);
                        
                        // Panggil callback disconnect
                        if (disconnectCallbacks.has(sessionId)) {
                            disconnectCallbacks.get(sessionId)();
                        }
                    }
                } else if (connection === 'open') {
                    // Connection opened
                    console.log(`Connected to WhatsApp (${sessionId})`);
                    
                    // Panggil callback connect
                    if (connectCallbacks.has(sessionId)) {
                        connectCallbacks.get(sessionId)(sock);
                    }
                }
            });
            
            // Handle creds.update
            sock.ev.on('creds.update', saveCreds);
            
            // Simpan session
            sessions.set(sessionId, sock);
            
            return sock;
        } catch (error) {
            console.error(`Error connecting to WhatsApp (${sessionId}):`, error);
            throw error;
        }
    },
    
    // Set callback untuk QR code
    setQRCallback: (sessionId, callback) => {
        qrCallbacks.set(sessionId, callback);
    },
    
    // Set callback untuk koneksi berhasil
    setConnectCallback: (sessionId, callback) => {
        connectCallbacks.set(sessionId, callback);
    },
    
    // Set callback untuk koneksi terputus
    setDisconnectCallback: (sessionId, callback) => {
        disconnectCallbacks.set(sessionId, callback);
    },
    
    // Dapatkan session yang aktif
    getSession: (sessionId) => {
        return sessions.get(sessionId);
    },
    
    // Dapatkan semua session yang tersimpan (dari direktori)
    getAllSessions: () => {
        try {
            return fs.readdirSync(config.SESSION_DIR)
                .filter(file => {
                    const sessionDir = path.join(config.SESSION_DIR, file);
                    return fs.statSync(sessionDir).isDirectory();
                });
        } catch (error) {
            console.error('Error reading sessions:', error);
            return [];
        }
    },
    
    // Dapatkan status koneksi WhatsApp
    getStatus: (sessionId) => {
        const sock = sessions.get(sessionId);
        if (sock && sock.user) {
            return {
                connected: true,
                user: sock.user
            };
        }
        return { connected: false };
    },
    
    // Hapus session
    deleteSession: (sessionId) => {
        try {
            // Hapus dari map
            if (sessions.has(sessionId)) {
                sessions.delete(sessionId);
            }
            
            // Hapus callbacks
            qrCallbacks.delete(sessionId);
            connectCallbacks.delete(sessionId);
            disconnectCallbacks.delete(sessionId);
            
            // Hapus direktori session
            const sessionDir = path.join(config.SESSION_DIR, sessionId);
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
            
            return true;
        } catch (error) {
            console.error(`Error deleting session ${sessionId}:`, error);
            return false;
        }
    },
    
    // Dapatkan daftar grup
    getGroups: async (sessionId) => {
        const sock = sessions.get(sessionId);
        if (!sock) return null;
        
        try {
            const groups = await sock.groupFetchAllParticipating();
            return Object.values(groups);
        } catch (error) {
            console.error('Error getting groups:', error);
            return null;
        }
    },
    
    // Rename grup
    renameGroup: async (sessionId, groupId, newName) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
        
        try {
            await sock.groupUpdateSubject(groupId, newName);
            await utils.delay(config.DELAY); // Delay untuk rate limiting
            return { success: true, message: `Berhasil mengganti nama grup menjadi "${newName}"` };
        } catch (error) {
            console.error('Error renaming group:', error);
            return { success: false, message: `Gagal mengganti nama grup: ${error.message}` };
        }
    },
    
    // Rename semua grup dengan pola nama
    renameAllGroups: async (sessionId, baseName) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
        
        try {
            // Ambil daftar grup
            const groups = await whatsapp.getGroups(sessionId);
            if (!groups || groups.length === 0) {
                return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
            }
            
            // Cari angka di baseName
            const matches = baseName.match(/(\d+)/g);
            
            // Tentukan nomor mulai
            let currentNumber = 1;
            let digitPadding = 0;
            
            if (matches && matches.length > 0) {
                // Ambil angka terakhir
                const lastNumber = matches[matches.length - 1];
                currentNumber = parseInt(lastNumber, 10);
                
                // Tentukan padding jika ada
                if (lastNumber.startsWith('0')) {
                    digitPadding = lastNumber.length;
                }
            }
            
            // Urutkan grup berdasarkan angka dalam nama
            const sortedGroups = [...groups].sort((a, b) => {
                const numA = utils.extractNumbers(a.subject)[0] || 0;
                const numB = utils.extractNumbers(b.subject)[0] || 0;
                return numA - numB;
            });
            
            // Hasil rename
            const results = [];
            
            // Rename setiap grup
            for (const group of sortedGroups) {
                let newName = '';
                
                if (matches && matches.length > 0) {
                    // Angka terakhir
                    const lastNumber = matches[matches.length - 1];
                    const lastNumberIndex = baseName.lastIndexOf(lastNumber);
                    const prefix = baseName.substring(0, lastNumberIndex);
                    const suffix = baseName.substring(lastNumberIndex + lastNumber.length);
                    
                    // Format angka dengan padding jika diperlukan
                    let newNumberStr = currentNumber.toString();
                    if (digitPadding > 0) {
                        newNumberStr = newNumberStr.padStart(digitPadding, '0');
                    }
                    
                    newName = prefix + newNumberStr + suffix;
                } else {
                    // Tidak ada angka di baseName
                    newName = `${baseName} ${currentNumber}`;
                }
                
                // Rename grup
                const result = await whatsapp.renameGroup(sessionId, group.id, newName);
                
                // Simpan hasil
                results.push({
                    groupName: group.subject,
                    newName,
                    success: result.success,
                    message: result.message
                });
                
                // Increment angka
                currentNumber++;
            }
            
            return {
                success: true,
                message: `Berhasil mengganti nama ${results.filter(r => r.success).length} dari ${results.length} grup`,
                results
            };
        } catch (error) {
            console.error('Error renaming all groups:', error);
            return { success: false, message: `Gagal mengganti nama grup: ${error.message}`, results: [] };
        }
    },
    
    // Dapatkan link grup
    getGroupInviteLink: async (sessionId, groupId) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
        
        try {
            const link = await sock.groupInviteCode(groupId);
            await utils.delay(config.DELAY); // Delay untuk rate limiting
            return { 
                success: true, 
                message: `Berhasil mendapatkan link grup`, 
                link: `https://chat.whatsapp.com/${link}` 
            };
        } catch (error) {
            console.error('Error getting group invite link:', error);
            return { success: false, message: `Gagal mendapatkan link grup: ${error.message}` };
        }
    },
    
    // Dapatkan link semua grup
    getAllGroupLinks: async (sessionId) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', links: [] };
        
        try {
            // Ambil daftar grup
            const groups = await whatsapp.getGroups(sessionId);
            if (!groups || groups.length === 0) {
                return { success: false, message: 'Tidak ada grup yang ditemukan', links: [] };
            }
            
            // Urutkan grup berdasarkan angka dalam nama
            const sortedGroups = [...groups].sort((a, b) => {
                const numA = utils.extractNumbers(a.subject)[0] || 0;
                const numB = utils.extractNumbers(b.subject)[0] || 0;
                return numA - numB;
            });
            
            // Links
            const links = [];
            
            // Ambil link untuk setiap grup
            for (const group of sortedGroups) {
                const result = await whatsapp.getGroupInviteLink(sessionId, group.id);
                if (result.success) {
                    links.push({
                        groupName: group.subject,
                        link: result.link,
                        id: group.id
                    });
                }
            }
            
            return {
                success: true,
                message: `Berhasil mendapatkan ${links.length} dari ${sortedGroups.length} link grup`,
                links
            };
        } catch (error) {
            console.error('Error getting all group links:', error);
            return { success: false, message: `Gagal mendapatkan link grup: ${error.message}`, links: [] };
        }
    },
    
    // Format nomor telepon
    formatPhoneNumber: (number) => {
        // Hapus karakter non-digit
        let phoneNumber = number.toString().replace(/\D/g, '');
        
        // Jika dimulai dengan 0, ganti dengan 62 (Indonesia)
        if (phoneNumber.startsWith('0')) {
            phoneNumber = '62' + phoneNumber.substring(1);
        }
        
        // Tambahkan @s.whatsapp.net jika belum ada
        if (!phoneNumber.includes('@')) {
            phoneNumber = phoneNumber + '@s.whatsapp.net';
        }
        
        return phoneNumber;
    },
    
    // Jadikan user sebagai admin grup
    promoteToAdmin: async (sessionId, groupId, participantNumber) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp' };
        
        try {
            // Format nomor telepon
            const phoneNumber = whatsapp.formatPhoneNumber(participantNumber);
            
            // Cek apakah nomor ada di grup
            const groupInfo = await sock.groupMetadata(groupId);
            const participants = groupInfo.participants;
            const isInGroup = participants.some(p => p.id === phoneNumber);
            
            if (!isInGroup) {
                return { success: false, message: `Nomor ${participantNumber} tidak ditemukan dalam grup` };
            }
            
            // Jadikan admin
            await sock.groupParticipantsUpdate(groupId, [phoneNumber], 'promote');
            await utils.delay(config.DELAY); // Delay untuk rate limiting
            
            return { success: true, message: `Berhasil menjadikan ${participantNumber} sebagai admin` };
        } catch (error) {
            console.error('Error promoting to admin:', error);
            return { success: false, message: `Gagal menjadikan admin: ${error.message}` };
        }
    },
    
    // Jadikan admin di semua grup
    promoteToAdminAllGroups: async (sessionId, numbers) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
        
        try {
            // Ambil daftar grup
            const groups = await whatsapp.getGroups(sessionId);
            if (!groups || groups.length === 0) {
                return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
            }
            
            // Hasil operasi
            const results = [];
            
            // Promote di setiap grup
            for (const group of groups) {
                const groupResults = [];
                
                for (const number of numbers) {
                    const result = await whatsapp.promoteToAdmin(sessionId, group.id, number);
                    groupResults.push({
                        number,
                        success: result.success,
                        message: result.message
                    });
                }
                
                results.push({
                    groupName: group.subject,
                    id: group.id,
                    results: groupResults
                });
            }
            
            return {
                success: true,
                message: `Selesai melakukan promosi admin di ${groups.length} grup`,
                results
            };
        } catch (error) {
            console.error('Error promoting admins:', error);
            return { success: false, message: `Gagal menjadikan admin: ${error.message}`, results: [] };
        }
    },
    
    // Ubah pengaturan grup
    changeGroupSettings: async (sessionId, groupId, settings) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
        
        try {
            const results = [];
            
            // Edit Info Grup
            if ('edit_group_info' in settings) {
                await sock.groupSettingUpdate(
                    groupId, 
                    settings.edit_group_info ? 'unlocked' : 'locked'
                );
                
                results.push({
                    setting: 'edit_group_info',
                    value: settings.edit_group_info,
                    success: true,
                    message: `Berhasil ${settings.edit_group_info ? 'mengaktifkan' : 'menonaktifkan'} edit info grup`
                });
                
                await utils.delay(config.DELAY); // Delay untuk rate limiting
            }
            
            // Kirim Pesan
            if ('send_messages' in settings) {
                await sock.groupSettingUpdate(
                    groupId, 
                    settings.send_messages ? 'not_announcement' : 'announcement'
                );
                
                results.push({
                    setting: 'send_messages',
                    value: settings.send_messages,
                    success: true,
                    message: `Berhasil ${settings.send_messages ? 'mengaktifkan' : 'menonaktifkan'} pengiriman pesan`
                });
                
                await utils.delay(config.DELAY); // Delay untuk rate limiting
            }
            
            return { success: true, message: 'Berhasil mengubah pengaturan grup', results };
        } catch (error) {
            console.error('Error changing group settings:', error);
            return { success: false, message: `Gagal mengubah pengaturan grup: ${error.message}`, results: [] };
        }
    },
    
    // Ubah pengaturan semua grup
    changeAllGroupSettings: async (sessionId, settings) => {
        const sock = sessions.get(sessionId);
        if (!sock) return { success: false, message: 'Tidak terhubung ke WhatsApp', results: [] };
        
        try {
            // Ambil daftar grup
            const groups = await whatsapp.getGroups(sessionId);
            if (!groups || groups.length === 0) {
                return { success: false, message: 'Tidak ada grup yang ditemukan', results: [] };
            }
            
            // Hasil operasi
            const results = [];
            
            // Ubah pengaturan di setiap grup
            for (const group of groups) {
                const result = await whatsapp.changeGroupSettings(sessionId, group.id, settings);
                
                results.push({
                    groupName: group.subject,
                    id: group.id,
                    success: result.success,
                    message: result.message,
                    results: result.results
                });
            }
            
            return {
                success: true,
                message: `Selesai mengubah pengaturan di ${results.filter(r => r.success).length} dari ${results.length} grup`,
                results
            };
        } catch (error) {
            console.error('Error changing all group settings:', error);
            return { success: false, message: `Gagal mengubah pengaturan grup: ${error.message}`, results: [] };
        }
    }
};

module.exports = whatsapp;
