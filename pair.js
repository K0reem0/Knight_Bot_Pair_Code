import express from 'express';  
import fs from 'fs';  
import pino from 'pino';  
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';  
import pn from 'awesome-phonenumber';  
  
const router = express.Router();  
  
// حذف مجلد أو ملف  
function removeFile(FilePath) {  
    try {  
        if (!fs.existsSync(FilePath)) return false;  
        fs.rmSync(FilePath, { recursive: true, force: true });  
    } catch (e) {  
        console.error('Error removing file:', e);  
    }  
}  
  
router.get('/', async (req, res) => {  
    let num = req.query.number;  
    let dirs = './' + (num || `session`);  
  
    // حذف الجلسة القديمة  
    await removeFile(dirs);  
  
    // تنظيف الرقم من أي رموز غير الأرقام  
    num = num.replace(/[^0-9]/g, '');  
  
    // التحقق من صحة الرقم  
    const phone = pn('+' + num);  
    if (!phone.isValid()) {  
        if (!res.headersSent) {  
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });  
        }  
        return;  
    }  
  
    // صيغة دولية E.164 بدون "+"  
    num = phone.getNumber('e164').replace('+', '');  
  
    async function initiateSession() {  
        const { state, saveCreds } = await useMultiFileAuthState(dirs);  
        let credsReady = false;  
  
        try {  
            const { version } = await fetchLatestBaileysVersion();  
            let KnightBot = makeWASocket({  
                version,  
                auth: {  
                    creds: state.creds,  
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),  
                },  
                printQRInTerminal: false,  
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),  
                browser: Browsers.windows('Chrome'),  
                markOnlineOnConnect: false,  
                generateHighQualityLinkPreview: false,  
                defaultQueryTimeoutMs: 60000,  
                connectTimeoutMs: 60000,  
                keepAliveIntervalMs: 30000,  
                retryRequestDelayMs: 250,  
                maxRetries: 5,  
            });  
  
            // تحديث بيانات الجلسة  
            KnightBot.ev.on('creds.update', async () => {  
                await saveCreds();  
                credsReady = true;  
                console.log("💾 Credentials updated and saved");  
            });  
  
            // متابعة حالة الاتصال  
            KnightBot.ev.on('connection.update', async (update) => {  
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;  
  
                if (connection === 'open') {  
                    console.log("✅ Connected successfully!");  
  
                    await delay(5000);  
                      
                    try {  
                        const sessionKnight = fs.readFileSync(dirs + '/creds.json');  
                        const userJid = jidNormalizedUser(num + '@s.whatsapp.net');  
  
                        await KnightBot.sendMessage(userJid, {  
                            document: sessionKnight,  
                            mimetype: 'application/json',  
                            fileName: 'creds.json'  
                        });  
                        console.log("📄 Session file sent successfully");  
  
                        await KnightBot.sendMessage(userJid, {  
                            image: { url: 'https://files.catbox.moe/yjj0x6.jpg' },  
                            caption: `شكرا لإستخدامك بوت هايسو 🤗`  
                        });  
  
                        await KnightBot.sendMessage(userJid, {  
                            text: `⚠️ لا تشارك هذا الملف مع أحد آخر ⚠️\n   
┌┤✑  هايسو بوت  
│└────────────┈ ⳹          
│©2024 AURTHER   
└─────────────────┈ ⳹\n\n`  
                        });  
  
                        console.log("⚠️ Warning message sent successfully");  
  
                        // تنظيف الجلسة  
                        await delay(6000);  
                        removeFile(dirs);  
                        console.log("✅ Session cleaned up successfully");  
                    } catch (error) {  
                        console.error("❌ Error sending messages:", error);  
                        removeFile(dirs);  
                    }  
                }  
  
                if (isNewLogin) console.log("🔐 New login via pair code");  
                if (isOnline) console.log("📶 Client is online");  
  
                if (connection === 'close') {  
                    const statusCode = lastDisconnect?.error?.output?.statusCode;  
                    if (statusCode === 401) {  
                        console.log("❌ Logged out from WhatsApp. Need to generate new pair code.");  
                    } else {  
                        console.log("🔁 Connection closed — restarting...");  
                        initiateSession();  
                    }  
                }  
            });  
  
            // طلب كود الاقتران  
            if (!KnightBot.authState.creds.registered) {  
                await delay(3000);  
                num = num.replace(/[^\d+]/g, '');  
                if (num.startsWith('+')) num = num.substring(1);  
  
                try {  
                    let code = await KnightBot.requestPairingCode(num);  
                    code = code?.match(/.{1,4}/g)?.join('-') || code;  
                    if (!res.headersSent) {  
                        console.log({ num, code });  
                        await res.send({ code });  
                    }  
                } catch (error) {  
                    console.error('Error requesting pairing code:', error);  
                    if (!res.headersSent) {  
                        res.status(503).send({ code: 'Failed to get pairing code. Please check your phone number and try again.' });  
                    }  
                }  
            }  
  
        } catch (err) {  
            console.error('Error initializing session:', err);  
            if (!res.headersSent) {  
                res.status(503).send({ code: 'Service Unavailable' });  
            }  
        }  
    }  
  
    await initiateSession();  
});  
  
// معالجة الأخطاء العامة  
process.on('uncaughtException', (err) => {  
    let e = String(err);  
    if (e.includes("conflict")) return;  
    if (e.includes("not-authorized")) return;  
    if (e.includes("Socket connection timeout")) return;  
    if (e.includes("rate-overlimit")) return;  
    if (e.includes("Connection Closed")) return;  
    if (e.includes("Timed Out")) return;  
    if (e.includes("Value not found")) return;  
    if (e.includes("Stream Errored")) return;  
    if (e.includes("Stream Errored (restart required)")) return;  
    if (e.includes("statusCode: 515")) return;  
    if (e.includes("statusCode: 503")) return;  
    console.log('Caught exception: ', err);  
});  
  
export default router;  
