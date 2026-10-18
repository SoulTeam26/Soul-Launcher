// ============================================================
// SOUL LAUNCHER — SHARED FIREBASE CONFIG
// Reuses the exact same Firebase project as the Soul website
// and Admin panel: soul-backend
// https://soul-backend-default-rtdb.firebaseio.com/
// ============================================================

const firebaseConfig = {
	apiKey: "AIzaSyCAalZXTgdIg58oip1Ang5CJVPRdp9YzzQ",
	authDomain: "soul-backend.firebaseapp.com",
	databaseURL: "https://soul-backend-default-rtdb.firebaseio.com",
	projectId: "soul-backend",
	storageBucket: "soul-backend.firebasestorage.app",
	messagingSenderId: "553383169433",
	appId: "1:553383169433:web:03aa34c90ebda216169708",
	measurementId: "G-9XJ71CEHRT"
};

// Initialize Firebase once per page (compat SDK). Safe to call multiple
// times — initializeApp returns the same app when config matches, and we
// guard with firebase.apps.length like the existing home.js does.
function initFirebase() {
	if (typeof firebase === 'undefined') {
		throw new Error('Firebase SDK not loaded. Include firebase-app-compat, firebase-auth-compat, and firebase-database-compat scripts.');
	}
	if (!firebase.apps.length) {
		firebase.initializeApp(firebaseConfig);
	}
	return {
		auth: firebase.auth(),
		db: firebase.database(),
		app: firebase.app()
	};
}
