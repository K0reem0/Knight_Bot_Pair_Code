import express from 'express';
import fs from 'fs';
import pino from 'pino';
import axios from 'axios';
import { execSync } from 'child_process';
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

// رفع الملف إلى GitHub باستخدام API
async function pushToGitHub(filePath, commitMessage = 'Update MysticSession creds.json') {
    try {
        const GITHUB_USERNAME = 'K0reem0';
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const GITHUB_REPO = 'TheMystic-Bot-MD';
        const GITHUB_BRANCH = 'main'; // أو 'master' حسب فرعك الرئيسي

        if (!GITHUB_TOKEN) {
            console.error('❌ GitHub token is missing!');
            return false;
        }

        // قراءة محتوى الملف
        const fileContent = fs.readFileSync(filePath, { encoding: 'base64' });
        const filePathInRepo = 'MysticSession/creds.json';

        // 1. الحصول على المرجع الحالي
        const refResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BRANCH}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        const lastCommitSha = refResponse.data.object.sha;

        // 2. الحصول على آخر commit
        const commitResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/git/commits/${lastCommitSha}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        const baseTreeSha = commitResponse.data.tree.sha;

        // 3. إنشاء شجرة جديدة
        const treeResponse = await axios.post(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/git/trees`,
            {
                base_tree: baseTreeSha,
                tree: [
                    {
                        path: filePathInRepo,
                        mode: '100644', // ملف عادي
                        type: 'blob',
                        content: fileContent,
                        encoding: 'base64'
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        const newTreeSha = treeResponse.data.sha;

        // 4. إنشاء commit جديد
        const commitData = {
            message: commitMessage,
            tree: newTreeSha,
            parents: [lastCommitSha]
        };

        const newCommitResponse = await axios.post(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/git/commits`,
            commitData,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        const newCommitSha = newCommitResponse.data.sha;

        // 5. تحديث المرجع
        await axios.patch(
            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BRANCH}`,
            {
                sha: newCommitSha
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        console.log('✅ Successfully pushed to GitHub');
        return true;
    } catch (error) {
        console.error('❌ Error pushing to GitHub:', error.response?.data || error.message);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    let dirs = './' + (num || session);

    // حذف الجلسة القديمة  
    await removeFile(dirs);

    // تنظيف الرقم
    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, 84987654321 for Vietnam, etc.) without + or spaces.' });
        }
        return;
    }
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

            KnightBot.ev.on('creds.update', async () => {
                await saveCreds();
                credsReady = true;
                console.log("💾 Credentials updated and saved");
            });

            KnightBot.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin, isOnline } = update;

                if (connection === 'open') {
                    console.log("✅ Connected successfully!");

                    await delay(5000);

                    try {
                        // رفع الملف إلى GitHub
                        const success = await pushToGitHub(`${dirs}/creds.json`, `Update creds.json for ${num}`);
                        if (success) {
                            console.log("📤 creds.json uploaded to GitHub");
                        } else {
                            console.log("❌ Failed to upload creds.json to GitHub");
                        }

                        // تنظيف الجلسة
                        await delay(6000);
                        removeFile(dirs);
                        console.log("✅ Session cleaned up successfully");
                    } catch (error) {
                        console.error("❌ Error pushing creds.json:", error);
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
