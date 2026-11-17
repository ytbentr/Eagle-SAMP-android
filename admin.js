'use strict';

const mineflayer = require('mineflayer');

const CONFIG = {
  host: process.env.MC_HOST || 'bensmpmc.duckdns.org',
  port: Number(process.env.MC_PORT || 34606),
  username: 'Botgdl',
  version: '1.21.11',
  auth: 'offline',
  reconnectMinMs: 5000,
  reconnectMaxMs: 60000
};

const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || '';
const REGISTER_PASSWORD = process.env.REGISTER_PASSWORD || '';

let currentBot = null;
let reconnectTimer = null;
let reconnectAttempt = 0;
let shuttingDown = false;

function log(message) {
  console.log('[Botgdl] ' + message);
}

function normalize(message) {
  return String(message)
    .replace(/§[0-9a-fk-or]/gi, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase();
}

function connect() {
  if (shuttingDown || currentBot) return;

  log('Bağlanıyor: ' + CONFIG.host + ':' + CONFIG.port);

  let bot;
  try {
    bot = mineflayer.createBot({
      host: CONFIG.host,
      port: CONFIG.port,
      username: CONFIG.username,
      version: CONFIG.version,
      auth: CONFIG.auth,
      hideErrors: false
    });
  } catch (error) {
    log('Bağlantı başlatılamadı: ' + error.message);
    scheduleReconnect('bağlantı başlatılamadı');
    return;
  }

  currentBot = bot;

  let jumpTimer = null;
  let jumpReleaseTimer = null;
  let spawnFallbackTimer = null;
  let authFallbackTimer = null;
  let postAuthStarted = false;
  let authPrompted = false;
  let authFailed = false;
  const authCommandsSent = new Set();

  function clearBotTimers() {
    if (jumpTimer) clearInterval(jumpTimer);
    if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer);
    if (spawnFallbackTimer) clearTimeout(spawnFallbackTimer);
    if (authFallbackTimer) clearTimeout(authFallbackTimer);
    jumpTimer = null;
    jumpReleaseTimer = null;
    spawnFallbackTimer = null;
    authFallbackTimer = null;
  }

  function runPostAuth(reason) {
    if (postAuthStarted || currentBot !== bot || !bot.entity) return;
    postAuthStarted = true;
    authFailed = false;

    if (spawnFallbackTimer) clearTimeout(spawnFallbackTimer);
    if (authFallbackTimer) clearTimeout(authFallbackTimer);

    log('Giriş tamamlandı (' + reason + '). Işınlanma komutu gönderilecek.');

    setTimeout(function () {
      if (currentBot !== bot || !bot.entity) return;

      bot.chat('/tp 93.710000 -61.000000 45.320000');
      log('Işınlanma komutu gönderildi.');

      setTimeout(function () {
        if (currentBot !== bot || !bot.entity) return;
        bot.chat('/gamemode creative');
        log('Yaratıcı mod komutu gönderildi.');
      }, 1800);
    }, 1200);
  }

  function sendAuthCommand(type) {
    if (authCommandsSent.has(type) || currentBot !== bot) return;

    authPrompted = true;
    if (spawnFallbackTimer) clearTimeout(spawnFallbackTimer);

    const password = type === 'register' ? REGISTER_PASSWORD : LOGIN_PASSWORD;
    if (!password) {
      log(type.toUpperCase() + ' şifresi eksik. Render Environment bölümüne ' +
        (type === 'register' ? 'REGISTER_PASSWORD' : 'LOGIN_PASSWORD') +
        ' ekle.');
      return;
    }

    authCommandsSent.add(type);
    authFailed = false;

    if (type === 'register') {
      bot.chat('/register ' + password + ' ' + password);
      log('Register komutu gönderildi.');
    } else {
      bot.chat('/login ' + password);
      log('Login komutu gönderildi.');
    }

    if (authFallbackTimer) clearTimeout(authFallbackTimer);
    authFallbackTimer = setTimeout(function () {
      if (!authFailed) runPostAuth('komut sonrası bekleme');
    }, 8000);
  }

  bot.on('spawn', function () {
    log('Sunucuya girdi.');

    if (jumpTimer) clearInterval(jumpTimer);
    jumpTimer = setInterval(function () {
      if (currentBot !== bot || !bot.entity || bot.health <= 0) return;

      bot.setControlState('jump', true);
      if (jumpReleaseTimer) clearTimeout(jumpReleaseTimer);
      jumpReleaseTimer = setTimeout(function () {
        if (currentBot === bot && bot.entity) {
          bot.setControlState('jump', false);
        }
      }, 180);
    }, 1000);

    if (!authPrompted && !postAuthStarted) {
      spawnFallbackTimer = setTimeout(function () {
        if (!authPrompted) runPostAuth('sunucu login/register istemedi');
      }, 10000);
    }

    reconnectAttempt = 0;
  });

  bot.on('messagestr', function (message) {
    const text = normalize(message);

    const registerPrompt =
      /(register|kayit ol|kayit yap|hesap olustur|please register|create an account)/.test(text);
    const loginPrompt =
      /(login|log in|giris yap|giris yapman|please login|please log in|authenticate)/.test(text);

    if (/(incorrect password|wrong password|invalid password|yanlis sifre|hatali sifre|giris basarisiz)/.test(text)) {
      authFailed = true;
      if (authFallbackTimer) clearTimeout(authFallbackTimer);
      log('Sunucu şifreyi kabul etmedi. Şifreleri kontrol et.');
      return;
    }

    if (/(successfully logged|logged in successfully|login successful|giris basarili|basariyla giris|registered successfully|registration successful|kayit basarili|basariyla kayit)/.test(text)) {
      runPostAuth('sunucu başarı mesajı');
      return;
    }

    if (registerPrompt) {
      sendAuthCommand('register');
    } else if (loginPrompt) {
      sendAuthCommand('login');
    }
  });

  bot.on('death', function () {
    log('Bot öldü; yeniden doğmayı deneyecek.');
    setTimeout(function () {
      if (currentBot === bot && bot.health <= 0) {
        try {
          bot.respawn();
        } catch (error) {
          log('Respawn hatası: ' + error.message);
        }
      }
    }, 1200);
  });

  bot.on('kicked', function (reason) {
    log('Sunucudan atıldı: ' + String(reason));
  });

  bot.on('error', function (error) {
    log('Bağlantı hatası: ' + error.message);
  });

  bot.on('end', function (reason) {
    log('Bağlantı kapandı: ' + String(reason || 'sebep belirtilmedi'));
    clearBotTimers();

    try {
      bot.clearControlStates();
    } catch (_) {}

    if (currentBot === bot) currentBot = null;
    scheduleReconnect('bağlantı kapandı');
  });
}

function scheduleReconnect(reason) {
  if (shuttingDown || reconnectTimer) return;

  const delay = Math.min(
    CONFIG.reconnectMinMs * Math.pow(2, reconnectAttempt),
    CONFIG.reconnectMaxMs
  );
  reconnectAttempt += 1;

  log(reason + '. ' + Math.round(delay / 1000) + ' saniye sonra tekrar denenecek.');
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect();
  }, delay);
}

function shutdown(signal) {
  shuttingDown = true;
  log(signal + ' alındı; bot kapatılıyor.');

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (currentBot) {
    try {
      currentBot.quit('Render servis kapatılıyor');
    } catch (_) {}
    currentBot = null;
  }

  setTimeout(function () {
    process.exit(0);
  }, 500);
}

process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });

if (!Number.isInteger(CONFIG.port) || CONFIG.port < 1 || CONFIG.port > 65535) {
  throw new Error('MC_PORT geçersiz. 1-65535 arasında bir port gir.');
}

if (!CONFIG.host) {
  throw new Error('MC_HOST boş olamaz.');
}

log('Bot başlatılıyor. Sürüm: ' + CONFIG.version);
connect();
