// database.js - Manajemen admin dan session pengguna

const fs = require('fs');
const path = require('path');
const config = require('./config');

// Buat direktori database jika belum ada
if (!fs.existsSync(config.DB_DIR)) {
    fs.mkdirSync(config.DB_DIR, { recursive: true });
}

// Path file untuk data admin
const adminFile = path.join(config.DB_DIR, 'admins.json');

// Inisialisasi file admin jika belum ada
if (!fs.existsSync(adminFile)) {
    fs.writeFileSync(adminFile, JSON.stringify([config.MAIN_ADMIN_ID]));
}

// File untuk menyimpan state user
const getStateFile = (userId) => path.join(config.DB_DIR, `state_${userId}.json`);

// Database functions
const database = {
    // === Admin Management ===
    
    // Dapatkan daftar admin
    getAdmins: () => {
        try {
            return JSON.parse(fs.readFileSync(adminFile, 'utf8'));
        } catch (error) {
            console.error('Error reading admin file:', error);
            return [config.MAIN_ADMIN_ID]; // Fallback ke admin utama
        }
    },
    
    // Cek apakah user adalah admin
    isAdmin: (userId) => {
        const admins = database.getAdmins();
        return admins.includes(userId.toString());
    },
    
    // Tambah admin baru
    addAdmin: (userId) => {
        const admins = database.getAdmins();
        if (!admins.includes(userId.toString())) {
            admins.push(userId.toString());
            fs.writeFileSync(adminFile, JSON.stringify(admins));
            return true;
        }
        return false;
    },
    
    // Hapus admin
    removeAdmin: (userId) => {
        if (userId === config.MAIN_ADMIN_ID) return false; // Tidak bisa menghapus admin utama
        const admins = database.getAdmins();
        const index = admins.indexOf(userId.toString());
        if (index !== -1) {
            admins.splice(index, 1);
            fs.writeFileSync(adminFile, JSON.stringify(admins));
            return true;
        }
        return false;
    },
    
    // === User State Management ===
    
    // Dapatkan state user
    getUserState: (userId) => {
        const stateFile = getStateFile(userId);
        if (fs.existsSync(stateFile)) {
            try {
                return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            } catch (error) {
                console.error(`Error reading state for user ${userId}:`, error);
                return {};
            }
        }
        return {};
    },
    
    // Set state user
    setUserState: (userId, state) => {
        const stateFile = getStateFile(userId);
        fs.writeFileSync(stateFile, JSON.stringify(state));
    },
    
    // Update state user (hanya properti yang diberikan)
    updateUserState: (userId, updates) => {
        const state = database.getUserState(userId);
        const newState = { ...state, ...updates };
        database.setUserState(userId, newState);
        return newState;
    },
    
    // Hapus state user
    clearUserState: (userId) => {
        const stateFile = getStateFile(userId);
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
            return true;
        }
        return false;
    }
};

module.exports = database;