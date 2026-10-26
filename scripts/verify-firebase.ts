import { db, getFirebaseApp } from '../lib/firebase-admin';

async function verifyFirebaseConnection() {
  console.log('🔍 Testing Firebase Firestore connectivity...\n');

  try {
    const app = getFirebaseApp();
    console.log(`✅ Firebase App initialized with Project ID: "${app.options.projectId}"`);

    // Attempt to read systemSettings collection
    console.log('📡 Connecting to Cloud Firestore...');
    const snapshot = await db.collection('users').limit(5).get();

    console.log(`✅ Successfully connected to Firestore!`);
    console.log(`📊 Documents found in "users" collection: ${snapshot.size}`);

    if (snapshot.empty) {
      console.log('\n⚠️  Your Firestore database is connected, but looks empty.');
      console.log('👉 Run the following command to populate your database with initial data:');
      console.log('   npm run db:seed-firestore\n');
    } else {
      console.log('\n👥 Sample users found in database:');
      snapshot.forEach(doc => {
        const data = doc.data();
        console.log(`   - ${data.name} (${data.email}) [Role: ${data.role}]`);
      });
      console.log('\n🎉 Your Firebase Firestore setup is ready and fully functional!');
    }
  } catch (error: any) {
    console.error('\n❌ Firebase connection check failed:');
    console.error(error?.message || error);
    console.log('\n💡 Tip: Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY');
    console.log('   (or FIREBASE_SERVICE_ACCOUNT_KEY) in your environment, e.g. in .env, and run');
    console.log('   this script with: npx tsx --env-file=.env scripts/verify-firebase.ts\n');
    process.exit(1);
  }
}

verifyFirebaseConnection();
