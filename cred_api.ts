import { SpotifyApi } from "@spotify/web-api-ts-sdk"
import { pass_cred_get } from "./cred"

let _spotify_api: SpotifyApi;

// fuckit
const scopes = [
	"ugc-image-upload",
	"user-read-recently-played",
	"user-top-read",
	"user-read-playback-position",
	"user-read-playback-state",
	"user-modify-playback-state",
	"user-read-currently-playing",
	"app-remote-control",
	"playlist-modify-public",
	"playlist-modify-private",
	"playlist-read-private",
	"playlist-read-collaborative",
	"user-follow-modify",
	"user-library-modify",
	"user-library-read",
	"user-read-email",
	"user-read-private",
]

export function pass_spotify_api(): SpotifyApi {
	if (_spotify_api) {
		return _spotify_api
	}

	const [[client_id, client_secret], ] = pass_cred_get('spotify_api')

	_spotify_api = SpotifyApi.withClientCredentials(client_id, client_secret, scopes, {
		// i tried, hamfisting locale into requests it doesn't work

		/* fetch(req: any | URL, init: any) {
			// append locale to params

			if (typeof req === 'string') {
				req = new URL(req)
			}

			if (req instanceof URL) {
				req.searchParams.append('locale', 'ja_JP')
			}

			console.log(req)
			console.log(typeof req)
			return fetch(req, init)
		} */
	})

	return _spotify_api
}

export function zotify_credentials(): [string, string] {
	return pass_cred_get('spotify_dl_user')[0]
}
