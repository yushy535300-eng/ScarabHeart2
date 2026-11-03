'use strict';
const crypto=require('node:crypto');
const QRCode=require('qrcode');
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function toBase32(bytes){let bits=0,value=0,out='';for(const b of bytes){value=(value<<8)|b;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out;}
function fromBase32(value){let bits=0,n=0,out=[];for(const c of String(value).toUpperCase().replace(/=+$/,'')){const at=alphabet.indexOf(c);if(at<0)throw Error('無效的驗證器金鑰');n=(n<<5)|at;bits+=5;if(bits>=8){out.push((n>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
function newSecret(){return toBase32(crypto.randomBytes(20));}
function encryptionKey(){const raw=String(process.env.AGENT_TOTP_KEY||'');if(raw.length<40)throw Error('尚未設定 AGENT_TOTP_KEY 加密金鑰');return crypto.createHash('sha256').update(raw,'utf8').digest();}
function encryptSecret(secret){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',encryptionKey(),iv),ct=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ct.toString('base64url')].join('.');}
function decryptSecret(encoded){const parts=String(encoded||'').split('.');if(parts.length!==4||parts[0]!=='v1')throw Error('驗證器資料無法讀取');const cipher=crypto.createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(parts[1],'base64url'));cipher.setAuthTag(Buffer.from(parts[2],'base64url'));return Buffer.concat([cipher.update(Buffer.from(parts[3],'base64url')),cipher.final()]).toString('utf8');}
function atCounter(secret,counter){const buffer=Buffer.alloc(8);buffer.writeBigUInt64BE(BigInt(counter));const digest=crypto.createHmac('sha1',fromBase32(secret)).update(buffer).digest(),offset=digest[digest.length-1]&15;return String((digest.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
function matchCounter(secret,code,last=-1){const input=String(code||'').trim();if(!/^\d{6}$/.test(input))return null;const now=Math.floor(Date.now()/30000);for(let c=now-1;c<=now+1;c++){if(c<=Number(last))continue;if(crypto.timingSafeEqual(Buffer.from(atCounter(secret,c)),Buffer.from(input)))return c;}return null;}
async function qrData(secret,username){const uri='otpauth://totp/'+encodeURIComponent('聖甲之心:'+username)+'?'+new URLSearchParams({secret,issuer:'聖甲之心',algorithm:'SHA1',digits:'6',period:'30'}).toString();return QRCode.toDataURL(uri,{width:190,margin:1,errorCorrectionLevel:'M'});}
module.exports={newSecret,encryptSecret,decryptSecret,matchCounter,qrData,encryptionKey};
