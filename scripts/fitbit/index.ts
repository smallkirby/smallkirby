import { AuthorizationCode } from 'simple-oauth2';
import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';
import axios from 'axios';
import dayjs, { Dayjs } from 'dayjs';

type SleepLog = {
  dateOfSleep: Dayjs,
  endTime: Dayjs,
  startTime: Dayjs,
  isMainSleep: boolean,
  timeInBed: number,
  efficiency: number,
};

const toSleepLog = (obj: any): SleepLog => ({
  dateOfSleep: dayjs(obj.dateOfSleep),
  endTime: dayjs(obj.endTime),
  startTime: dayjs(obj.startTime),
  isMainSleep: obj.isMainSleep,
  timeInBed: obj.timeInBed,
  efficiency: obj.efficiency,
});

dotenv.config();
dayjs.locale('jp');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const FIREBASE_SA_B64 = process.env.FIREBASE_SA_BASE64 || '';

const EXPIRATION_WINDOW_IN_SECONDS = 300;

if (!CLIENT_ID || !CLIENT_SECRET || !FIREBASE_SA_B64) {
  throw new Error('CLIENT_ID or CLIENT_SECRET or FIREBASE_SA_BASE64 is not defined');
}

// init Firebase
const FIREBASE_KEY = Buffer.from(FIREBASE_SA_B64, 'base64').toString('ascii');
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_KEY)),
});

// init OAuth client
const client = new AuthorizationCode({
	client: {
		id: CLIENT_ID,
		secret: CLIENT_SECRET,
	},
	auth: {
		tokenHost: 'https://api.fitbit.com',
		tokenPath: '/oauth2/token',
		authorizeHost: 'https://www.fitbit.com',
		authorizePath: '/oauth2/authorize',
	},
});

const main = async () => {
  // Restore saved tokens
  const tokenSnap = await admin.firestore().doc('fitbit/tokens').get();
  if (!tokenSnap.exists) {
    console.error('No tokens found in Firestore');
    process.exit(1);
  }

  // Check expiration
  const tokenData = tokenSnap.data()!;
  tokenData.expires_at = tokenData.expires_at.toDate();
  const userId = tokenData.user_id as string;
  let token = client.createToken(tokenData);

  if (token.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
    console.info('Token expired, refreshing...');
    const newToken = await token.refresh();
    await admin.firestore().doc('fitbit/tokens').set(newToken.token);
    console.info('Token refreshed.');

    token = newToken;
  }

  const sleep = await axios.get(`https://api.fitbit.com/1.2/user/${userId}/sleep/date/2023-01-01/2023-01-31.json`, {
    headers: {
      Authorization: `Bearer ${token.token.access_token}`,
      Accept: 'application/json',
      AcceptLocale: 'ja_JP',
    },
  });

  const logs: SleepLog[] = sleep.data.sleep.map(toSleepLog);

  let totalDays = 0;
  let earlyDaysCount = 0;
  const today = dayjs();
  let cur = dayjs('2023-01-01');
  while (cur.year() === 2023) {
    let todaysLogs = logs
      .filter((l) => l.dateOfSleep.isSame(cur, 'day'))
      .sort((a, b) => a.startTime.diff(b.startTime));
    if (todaysLogs.length !== 0) {
      let log = todaysLogs.find((l) => l.isMainSleep);
      if (!log) {
        log = todaysLogs[todaysLogs.length - 1];
      }

      if (log.endTime.hour() < 9) {
        ++earlyDaysCount;
      }
    }

    if (cur.isBefore(today, 'day') || cur.isSame(today, 'day')) {
      ++totalDays;
    }
    cur = cur.add(1, 'day');
  }

  console.log(`${earlyDaysCount} / ${totalDays}`);
};

(async () => {
  await main();
})();

