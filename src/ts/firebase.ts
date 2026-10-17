import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyAi4nnZqv0CM88mF8XeEhZCyKoXdnkqyvc',
  authDomain: 'totonoe-biyori.firebaseapp.com',
  projectId: 'totonoe-biyori',
  storageBucket: 'totonoe-biyori.firebasestorage.app',
  messagingSenderId: '364956278618',
  appId: '1:364956278618:web:be8f0c4359c3e074189d63',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
