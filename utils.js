// utils.js - Fungsi utilitas

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const config = require('./config');

// Buat direktori temporary jika belum ada
if (!fs.existsSync(config.TEMP_DIR)) {
    fs.mkdirSync(config.TEMP_DIR, { recursive: true });
}

const utils = {
    // Ekstrak angka dari string
    extractNumbers: (str) => {
        const matches = str.match(/\d+/g);
        return matches ? matches.map(Number) : [];
    },
    
    // Format nomor telepon ke format WhatsApp
    formatPhoneNumber: (number) => {
        // Hapus semua karakter non-digit
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
    
    // Delay eksekusi
    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Buat file text
    createTextFile: async (content, filename) => {
        const filePath = path.join(config.TEMP_DIR, filename || `${Date.now()}.txt`);
        
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, content, (err) => {
                if (err) {
                    console.error('Error creating text file:', err);
                    reject(err);
                } else {
                    resolve(filePath);
                }
            });
        });
    },
    
    // Generate QR code sebagai file gambar
    generateQRCodeImage: async (text, sessionId) => {
        const qrFilePath = path.join(config.TEMP_DIR, `qr_${sessionId}.png`);
        
        try {
            await qrcode.toFile(qrFilePath, text, {
                errorCorrectionLevel: 'H',
                margin: 1,
                scale: 8,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });
            
            return qrFilePath;
        } catch (error) {
            console.error('Error generating QR image:', error);
            throw error;
        }
    },
    
    // Bagi array menjadi chunks dengan ukuran tertentu
    chunkArray: (array, size) => {
        const result = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    },
    
    // Hapus semua file di direktori tertentu
    cleanDirectory: (dir) => {
        if (!fs.existsSync(dir)) return;
        
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
            }
        }
    },
    
    // Hapus file
    deleteFile: (filePath) => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
        return false;
    }
};

module.exports = utils;