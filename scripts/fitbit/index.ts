import fs from "node:fs";
import axios from "axios";
import CalHeatmap from "cal-heatmap";
import dayjs, { locale, type Dayjs } from "dayjs";
import dotenv from "dotenv";
import admin from "firebase-admin";
import { JSDOM } from "jsdom";
import { type AccessToken, AuthorizationCode } from "simple-oauth2";

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

type ActivityLog = {
	dateTime: string;
	value: {
		fatBurnActiveZoneMinutes: number;
		cardioActiveZoneMinutes: number;
		peakActiveZoneMinutes: number;
		activeZoneMinutes: number;
	};
};

type HeatmapData = {
	date: string;
	value: number;
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

// biome-ignore lint/suspicious/noExplicitAny: expected
const toActivityLog = (obj: any): ActivityLog => ({
	dateTime: obj.dateTime,
	value: {
		fatBurnActiveZoneMinutes: obj.value.fatBurnActiveZoneMinutes,
		cardioActiveZoneMinutes: obj.value.cardioActiveZoneMinutes,
		peakActiveZoneMinutes: obj.value.peakActiveZoneMinutes,
		activeZoneMinutes: obj.value.activeZoneMinutes,
	},
});

dotenv.config();
dayjs.locale("jp");

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const FIREBASE_SA_B64 = process.env.FIREBASE_SA_BASE64 || "";

const EXPIRATION_WINDOW_IN_SECONDS = 300;
const FITBIT_SCOPE = "sleep+activity+heartrate";

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

type HeatmapKind = "sleep" | "activity";

if (!CLIENT_ID || !CLIENT_SECRET || !FIREBASE_SA_B64) {
	throw new Error(
		"CLIENT_ID or CLIENT_SECRET or FIREBASE_SA_BASE64 is not defined",
	);
}

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

// init Firebase
const FIREBASE_KEY = Buffer.from(FIREBASE_SA_B64, "base64").toString("ascii");
admin.initializeApp({
	credential: admin.credential.cert(JSON.parse(FIREBASE_KEY)),
});

const calcSleepScore = (base: Dayjs, actual: Dayjs, max: number): number => {
	const diff = base.diff(actual, "minutes");
	const limitDiffMinutes = 3 * 60; // 3 hours
	const ratio = Math.max(-1, Math.min(1, diff / limitDiffMinutes)); // [-1, 1]
	return ((ratio + 1) / 2) * max; // [0, max]
};

const calcActivityScore = (
	base: number,
	actual: number,
	max: number,
): number => {
	const value = Math.max(0, Math.min(base, actual)); // [0, base]
	return (value / base) * max; // [0, max]
};

const generateHaetmapName = (kind: HeatmapKind, year: string): string =>
	`img/${kind}-${year}.svg`;

const fetchToken = async (): Promise<AccessToken> => {
	// Restore save tokens
	const docName =
		process.env.IS_CI === "true" ? "fitbit/tokens" : "fitbit/tokens-dev";
	console.info("Using doc: ", docName);
	const tokenSnap = await admin.firestore().doc(docName).get();
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
	let token = client.createToken(tokenData);

	if (token.expired(EXPIRATION_WINDOW_IN_SECONDS)) {
		console.info("Token expired, refreshing...");
		const newToken = await token.refresh();
		await admin.firestore().doc(docName).set(newToken.token);
		console.info("Token refreshed.");

		token = newToken;
	}

	return token;
};

const main = async () => {
	// Get argc
	if (process.argv.length !== 4) {
		console.error("Usage: node index.js <kind> <year>");
		process.exit(1);
	}
	const kind = process.argv[2] as HeatmapKind;
	if (kind !== "sleep" && kind !== "activity") {
		console.error("Invalid kind");
		process.exit(1);
	}

	const year = process.argv[3];
	const ranges = DateRanges[year];
	if (!ranges) {
		console.error("Invalid year");
		process.exit(1);
	}

	// Fetch or refresh token.
	const token = await fetchToken();

	if (kind === "sleep") {
		// Generate sleep heatmap.
		await generateSleepHeatmap(
			token,
			year,
			ranges,
			generateHaetmapName("sleep", year),
		);
	} else if (kind === "activity") {
		// Generate activity heatmap.
		await generateActivityHeatmap(
			token,
			year,
			ranges,
			generateHaetmapName("activity", year),
		);
	}
};

const fetchSleepData = async (
	token: AccessToken,
	year: string,
	ranges: DateRange[],
): Promise<HeatmapData[]> => {
	if (process.env.SLEEP_JSON) {
		const json = fs.readFileSync(process.env.SLEEP_JSON, "utf-8");
		return JSON.parse(json);
	}

	const userId = token.token.user_id as string;

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

	let cur = dayjs(`${year}-01-01`);
	const sleepHeatmapData: HeatmapData[] = [];
	while (cur.year().toString() === year) {
		const todaysLogs = logs
			.filter((l) => l.dateOfSleep.isSame(cur, "day"))
			.sort((a, b) => a.startTime.diff(b.startTime));
		if (todaysLogs.length !== 0) {
			let log = todaysLogs.find((l) => l.isMainSleep);
			if (!log) {
				log = todaysLogs[todaysLogs.length - 1];
			}

			const base = dayjs(
				`${cur.format("YYYY-MM-DD")}T${process.env.EARLY_THRESHOLD_HOUR}:00:00`,
			);
			sleepHeatmapData.push({
				date: cur.format("YYYY-MM-DD"),
				value: calcSleepScore(base, log.endTime, 100),
			});
		}

		cur = cur.add(1, "day");
	}

	return sleepHeatmapData;
};

const fetchActivityData = async (
	token: AccessToken,
	year: string,
	ranges: DateRange[],
): Promise<HeatmapData[]> => {
	if (process.env.ACTIVITY_JSON) {
		const json = fs.readFileSync(process.env.ACTIVITY_JSON, "utf-8");
		return JSON.parse(json);
	}

	const userId = token.token.user_id as string;

	const activity = await axios.get(
		`https://api.fitbit.com/1/user/${userId}/activities/active-zone-minutes/date/${year}-01-01/${year}-12-31.json`,
		{
			headers: {
				Authorization: `Bearer ${token.token.access_token}`,
				Accept: "application/json",
				AcceptLocale: "ja_JP",
			},
		},
	);
	const rawEntries = activity.data["activities-active-zone-minutes"];

	const activities: ActivityLog[] = rawEntries.map(toActivityLog);
	let cur = dayjs(`${year}-01-01`);
	const activityHeatmapData: HeatmapData[] = [];
	while (cur.year().toString() === year) {
		const todaysLogs = activities
			.filter((l) => dayjs(l.dateTime).isSame(cur, "day"))
			.sort((a, b) => dayjs(a.dateTime).diff(b.dateTime));
		if (todaysLogs.length !== 0) {
			const log = todaysLogs[0];
			activityHeatmapData.push({
				date: cur.format("YYYY-MM-DD"),
				value: calcActivityScore(120, log.value.activeZoneMinutes, 100),
			});
		}

		cur = cur.add(1, "day");
	}

	return activityHeatmapData;
};

const generateSleepHeatmap = async (
	token: AccessToken,
	year: string,
	ranges: DateRange[],
	filename: string,
) => {
	const sleepHeatmapData = await fetchSleepData(token, year, ranges);
	await generateHeatmap(sleepHeatmapData, year, filename);
};

const generateActivityHeatmap = async (
	token: AccessToken,
	year: string,
	ranges: DateRange[],
	filename: string,
) => {
	const activityHeatmapData = await fetchActivityData(token, year, ranges);
	await generateHeatmap(activityHeatmapData, year, filename);
};

const generateHeatmap = async (
	data: HeatmapData[],
	year: string,
	filename: string,
) => {
	const heatmap_id = "heatmap";
	const jsdom = new JSDOM(`<div id="${heatmap_id}"></div>`);
	const document = jsdom.window.document;

	const ch = new CalHeatmap();
	await ch.paint({
		data: {
			source: data,
			x: "date",
			y: (d) => d.value,
			defaultValue: 0,
		},
		date: {
			start: new Date(`${year}-01-01`),
		},
		range: 1,
		scale: { color: { type: "linear", scheme: "Oranges", domain: [0, 100] } },
		domain: {
			type: "year",
		},
		subDomain: { type: "day", radius: 2 },
		itemSelector: document.getElementById(heatmap_id),
		theme: "dark",
	});

	fs.writeFileSync(
		filename,
		document.body.getElementsByTagName("svg")[0].outerHTML,
	);
};

(async () => {
	await main();
})();
