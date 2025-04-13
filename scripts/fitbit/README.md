# Fitbit

## Environment Variables

| Name | Required (CI) | Required (dev)| Description |
| ---- | ------------- | ------------- | ----------- |
| `CLIENT_ID` | Yes | Yes | Fitbit API client ID |
| `CLIENT_SECRET` | Yes | Yes | Fitbit API client secret |
| `ACCESS_TOKEN` | No | Optional | Access token for Fitbit OAuth2 |
| `REFRESH_TOKEN` | No | Optional | Refresh token for Fitbit OAuth2 |
| `FIREBASE_SA_BASE64` | Yes | Optional | Base64 encoded Firebase service account JSON |
| `SLEEP_JSON` | No | Optional | Path to JSON file containing sleep data |
| `ACTIVITY_JSON` | No | Optional | Path to JSON file containing activity data |
| `IS_CI` | Yes | Optional | Whether the script is run on CI |

## Local Development

### Get an access token

1. Listen on port 3000: `nc -l 3000`
2. Set `CLIENT_ID` and `CLIENT_SECRET` envvar, then run `auth.bash`.
3. Copy and paste the code shown at the port 3000 to the terminal.

### Skip fetch of tokens

If `IS_CI` is `yes`, the script fetches an access token and a refresh token from the Firestore.
Otherwise, it searches for the tokens in the envvars `ACCESS_TOKEN` and `REFRESH_TOKEN`.

### Use pre-fetched data

If `SLEEP_JSON` or `ACTIVITY_JSON` is set, the script uses the data in the JSON files instead of fetching it from the Fitbit API, that would reduce the number of API calls.
