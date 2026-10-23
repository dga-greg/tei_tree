import webpush from 'web-push';

/** Prints a new pair of Web Push (VAPID) keys for WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY. Keep them: changing them signs every device out of notifications. */
const keys = webpush.generateVAPIDKeys();
console.log(`WEB_PUSH_PUBLIC_KEY=${keys.publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${keys.privateKey}`);
