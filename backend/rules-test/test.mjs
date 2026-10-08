// Firestore rules test in the local emulator (no live data touched). From this folder:
//   npm i --no-save @firebase/rules-unit-testing firebase
//   npx firebase-tools@13 emulators:exec --only firestore --project demo-tonefy "node test.mjs"
// Every write shape the app/website really makes must pass; every self-upgrade must fail.
import { readFileSync } from 'fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp, addDoc, collection } from 'firebase/firestore';
const env = await initializeTestEnvironment({ projectId: 'demo-tonefy', firestore: { rules: readFileSync('../firestore.rules', 'utf8'), host: '127.0.0.1', port: 8089 } });
let pass = 0, fail = 0;
async function t(name, p, ok) { try { await (ok ? assertSucceeds(p) : assertFails(p)); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, e.message.slice(0, 120)); } }
const a = env.authenticatedContext('alice').firestore();
const b = env.authenticatedContext('bob').firestore();
const iso = new Date(Date.now() + 30 * 864e5).toISOString();
// signup shapes, exactly as AuthScreen writes them
await t('email signup create', setDoc(doc(a, 'users/alice'), { fullName: 'A', email: 'a@x', country: 'UG', createdAt: serverTimestamp(), plan: 'free', creditsRemaining: 10, creditsResetAt: iso, subscriptionStatus: null }), true);
await t('google signup create', setDoc(doc(b, 'users/bob'), { fullName: 'B', email: 'b@x', createdAt: serverTimestamp(), plan: 'free', creditsRemaining: 10, creditsResetAt: iso, subscriptionStatus: null }), true);
const c = env.authenticatedContext('carol').firestore();
await t('create as creator refused', setDoc(doc(c, 'users/carol'), { plan: 'creator', creditsRemaining: 10 }), false);
await t('create with 999 credits refused', setDoc(doc(c, 'users/carol'), { plan: 'free', creditsRemaining: 999 }), false);
await t('create with webPassStatus refused', setDoc(doc(c, 'users/carol'), { plan: 'free', webPassStatus: 'active' }), false);
await t('create someone else refused', setDoc(doc(c, 'users/alice2'), { plan: 'free' }), false);
// app updates
await t('ProfileGate name/country merge', setDoc(doc(a, 'users/alice'), { firstName: 'Al', lastName: 'Ice', fullName: 'Al Ice', country: 'UG' }, { merge: true }), true);
await t('youtubeMadeForKids merge', setDoc(doc(a, 'users/alice'), { youtubeMadeForKids: false }, { merge: true }), true);
await t('pinterestBoards merge', setDoc(doc(a, 'users/alice'), { pinterestBoards: { acc1: { id: 'b', name: 'n' } } }, { merge: true }), true);
// attacks
await t('self-upgrade plan refused', setDoc(doc(a, 'users/alice'), { plan: 'creator' }, { merge: true }), false);
await t('self-add credits refused', updateDoc(doc(a, 'users/alice'), { creditsRemaining: 9999 }), false);
await t('fake web pass refused', updateDoc(doc(a, 'users/alice'), { webPassStatus: 'active' }), false);
await t('fake purchase token refused', updateDoc(doc(a, 'users/alice'), { subscriptionPurchaseToken: 'x' }), false);
await t('push reset date refused', updateDoc(doc(a, 'users/alice'), { creditsResetAt: '2020-01-01' }), false);
await t('read own', getDoc(doc(a, 'users/alice')), true);
await t('read other refused', getDoc(doc(a, 'users/bob')), false);
await t('write other refused', setDoc(doc(a, 'users/bob'), { fullName: 'x' }, { merge: true }), false);
// scheduled posts
const ref = await addDoc(collection(a, 'scheduledPosts'), { userId: 'alice', caption: 'c', status: 'queued' });
await t('create own post', Promise.resolve(ref), true);
await t('edit own post', updateDoc(doc(a, `scheduledPosts/${ref.id}`), { caption: 'd' }), true);
await t('move post to bob refused', updateDoc(doc(a, `scheduledPosts/${ref.id}`), { userId: 'bob' }), false);
await t('create post as bob refused', addDoc(collection(a, 'scheduledPosts'), { userId: 'bob' }), false);
await env.cleanup();
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
