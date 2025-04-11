import axios from "axios";
import dayjs, { type Dayjs } from "dayjs";
import * as dotenv from "dotenv";
import * as admin from "firebase-admin";
import { AuthorizationCode } from "simple-oauth2";

if (!process.env.EARLY_THRESHOLD_HOUR) {
	throw new Error("EARLY_THRESHOLD_HOUR is not defined");
}

type SleepLog = {
	dateOfSleep: Dayjs;
	endTime: Dayjs;
	startTime: Dayjs;
	isMainSleep: boolean;
	timeInBed: number;
	efficiency: number;
};

// biome-ignore lint/suspicious/noExplicitAny: expected
const toSleepLog = (obj: any): SleepLog => ({
	dateOfSleep: dayjs(obj.dateOfSleep),
	endTime: dayjs(obj.endTime),
	startTime: dayjs(obj.startTime),
	isMainSleep: obj.isMainSleep,
	timeInBed: obj.timeInBed,
	efficiency: obj.efficiency,
});

dotenv.config();
dayjs.locale("jp");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const FIREBASE_SA_B64 = process.env.FIREBASE_SA_BASE64 || "";

const EXPIRATION_WINDOW_IN_SECONDS = 300;

type DateRange = {
	from: string;
	to: string;
};
const DateRanges: Record<string, DateRange[]> = {
	"2023": [
		{ from: "2023-01-01", to: "2023-03-31" },
		{ from: "2023-04-01", to: "2023-06-30" },
		{ from: "2023-07-01", to: "2023-09-30" },
		{ from: "2023-10-01", to: "2023-12-31" },
	],
	"2024": [
		{ from: "2024-01-01", to: "2024-03-31" },
		{ from: "2024-04-01", to: "2024-06-30" },
		{ from: "2024-07-01", to: "2024-09-30" },
		{ from: "2024-10-01", to: "2024-12-31" },
	],
	"2025": [
		{ from: "2025-01-01", to: "2025-03-31" },
		{ from: "2025-04-01", to: "2025-06-30" },
		{ from: "2025-07-01", to: "2025-09-30" },
		{ from: "2025-10-01", to: "2025-12-31" },
	],
};

if (!CLIENT_ID || !CLIENT_SECRET || !FIREBASE_SA_B64) {
	throw new Error(
		"CLIENT_ID or CLIENT_SECRET or FIREBASE_SA_BASE64 is not defined",
	);
}

// init Firebase
const FIREBASE_KEY = Buffer.from(FIREBASE_SA_B64, "base64").toString("ascii");
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
		tokenHost: "https://api.fitbit.com",
		tokenPath: "/oauth2/token",
		authorizeHost: "https://www.fitbit.com",
		authorizePath: "/oauth2/authorize",
	},
});

const main = async () => {
	// get argc
	if (process.argv.length !== 3) {
		console.error("Usage: node index.js <year>");
		process.exit(1);
	}
	const year = process.argv[2];
	const ranges = DateRanges[year];
	if (!ranges) {
		console.error("Invalid year");
		process.exit(1);
	}

	// Restore saved tokens
	const tokenSnap = await admin.firestore().doc("fitbit/tokens").get();
	if (!tokenSnap.exists) {
		console.error("No tokens found in Firestore");
		process.exit(1);
	}

	// Check expiration
	const tokenData = tokenSnap.data();
	if (!tokenData) {
		throw new Error("Token data is null");
	}
	tokenData.expires_at = tokenData.expires_at.toDate();
	const userId = tokenData.user_id as string;
	let token = client.createToken(tokenData);

	if (token.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
		console.info("Token expired, refreshing...");
		const newToken = await token.refresh();
		await admin.firestore().doc("fitbit/tokens").set(newToken.token);
		console.info("Token refreshed.");

		token = newToken;
	}

	// biome-ignore lint/suspicious/noExplicitAny: expected
	const sleeps: any[] = [];
	for (const range of ranges) {
		const sleep = await axios.get(
			`https://api.fitbit.com/1.2/user/${userId}/sleep/date/${range.from}/${range.to}.json`,
			{
				headers: {
					Authorization: `Bearer ${token.token.access_token}`,
					Accept: "application/json",
					AcceptLocale: "ja_JP",
				},
			},
		);
		sleeps.push(...sleep.data.sleep);
	}

	const logs: SleepLog[] = sleeps.map(toSleepLog);

	let totalDays = 0;
	let earlyDaysCount = 0;
	const today = dayjs();
	let cur = dayjs(`${year}-01-01`);
	while (cur.year().toString() === year) {
		if (cur.isBefore(today, "day") || cur.isSame(today, "day")) {
			++totalDays;
		}

		const todaysLogs = logs
			.filter((l) => l.dateOfSleep.isSame(cur, "day"))
			.sort((a, b) => a.startTime.diff(b.startTime));
		if (todaysLogs.length !== 0) {
			let log = todaysLogs.find((l) => l.isMainSleep);
			if (!log) {
				log = todaysLogs[todaysLogs.length - 1];
			}

			if (log.endTime.hour() < Number(process.env.EARLY_THRESHOLD_HOUR)) {
				++earlyDaysCount;
			}
		}

		cur = cur.add(1, "day");
	}

	console.log(`${earlyDaysCount} / ${totalDays}`);
};

(async () => {
	await main();
})();
