// config.js - Konfigurasi untuk WhatsApp Manager Bot

module.exports = {
    // Token bot Telegram (dari BotFather)
    BOT_TOKEN: '8068335875:AAG_9YM9tJIuHMqoEPDtK9J3RqEFctUV7_E',
    
    // ID Telegram admin utama
    MAIN_ADMIN_ID: '5988451717',
    
    // Direktori untuk menyimpan session WhatsApp
    SESSION_DIR: './sessions',
    
    // Direktori untuk database
    DB_DIR: './database',
    
    // Direktori untuk file temporary
    TEMP_DIR: './temp',
    
    // Delay antara operasi (ms) untuk menghindari rate limiting
    DELAY: 3000,
};