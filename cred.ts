import { sql } from "drizzle-orm"
import { db } from "./db"
import { $kv_store } from "./schema"
import { pass_exception } from "./pass"
import { AccessToken, SpotifyApi, UserProfile } from "@spotify/web-api-ts-sdk"
import { nfetch } from "./fetch"

export type CredentialKind = keyof CredentialStore
type CredentialStore = {
	'spotify_api': [string, string][] // [client_id, client_secret]
	'deezer_arl': [string][]
	'spotify_dl_user': [string, string][] // [username, password]
}

/* type CredentialProp = {
	kind: CredentialKind
	title: string
	names: string[]
	tooltip?: string
}

const credential_props: CredentialProp[] = [
	{
		kind: 'spotify',
		title: 'Spotify API Credentials',
		names: ['Client ID', 'Client Secret'],
		tooltip: 'assumes a default redirect URI of http://localhost:8080/callback',
	},
	{
		kind: 'deezer_arl',
		title: 'Deezer ARL Token',
		names: ['ARL Token'],
	},
	{
		kind: 'spotify_dl_user',
		title: 'Spotify Download User',
		names: ['Username/Email', 'Password'],
		tooltip: 'use a throwaway account, preferably non premium',
	},
] */

function cred_db_get(): CredentialStore {
	let store: CredentialStore = {
		'spotify_api': [],
		'deezer_arl': [],
		'spotify_dl_user': [],
	}

	const cred = db.select({ data: $kv_store.data })
		.from($kv_store)
		.where(sql`kind = 'cred'`)
		.get() as { data: CredentialStore } | undefined

	// fill in the blanks
	if (cred) {
		store = { ...store, ...cred.data }
	}

	return store
}

// must be called inside a pass, throws PassStopException if cred not found
export function pass_cred_get<T extends CredentialKind>(kind: T): CredentialStore[T] {
	const datum = cred_db_get()[kind]

	if (datum.length === 0) {
		pass_exception(`[cred_get] ${kind} not found`)
	}
	
	return datum
}

let _spotify_api: SpotifyApi

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
		fetch: nfetch,
	})

	return _spotify_api
}

let _spotify_user: [SpotifyApi, UserProfile]

export async function pass_spotify_user(): Promise<[SpotifyApi, UserProfile]> {
	if (_spotify_user) {
		return _spotify_user
	}

	const client_redirect_uri = 'http://localhost:8080/callback'
	const [[client_id, client_secret], ] = pass_cred_get('spotify_api')

	async function spotify_auth_user(): Promise<SpotifyApi> {
		let sdk: SpotifyApi | undefined

		console.log(`spotify: listening on http://localhost:8080/`)
		console.log(`spotify: awaiting accept`)

		const server = Bun.serve({
			port: 8080,
			async fetch(req) {
				const url = new URL(req.url)
				out: switch (url.pathname) {
					case '/': {
						const url = 'https://accounts.spotify.com/authorize' +
							'?response_type=code' +
							'&client_id=' + encodeURIComponent(client_id) +
							'&scope=' + encodeURIComponent(scopes.join(' ')) +
							'&redirect_uri=' + encodeURIComponent(client_redirect_uri)

						return Response.redirect(url, 303)
					}
					case '/callback': {
						const code = url.searchParams.get('code')

						if (!code) {
							break out
						}

						const auth = btoa(client_id + ':' + client_secret)

						const auth_url = 'https://accounts.spotify.com/api/token' +
							'?grant_type=authorization_code' +
							'&code=' + encodeURIComponent(code) +
							'&redirect_uri=' + encodeURIComponent(client_redirect_uri)	

						const auth_req = new Request(auth_url, {
							method: 'POST',
							headers: {
								'Authorization': 'Basic ' + auth,
								'Content-Type': 'application/x-www-form-urlencoded'
							},
						})

						const auth_data = await fetch(auth_req)

						if (auth_data.status !== 200) {
							console.log(auth_data)
							throw new Error('auth failed')
						}
						const auth_json = await auth_data.json()

						sdk = SpotifyApi.withAccessToken(client_id, auth_json as AccessToken)

						return new Response('auth completed, you may close this window now', {status: 200})
					}
				}
				return new Response('Not Found', {status: 404})
			},
		})

		while (!sdk) {
			await new Promise((resolve) => setTimeout(resolve, 1))
		}

		server.stop(true)

		return sdk
	}

	const api = await spotify_auth_user()
	const profile = await api.currentUser.profile()

	_spotify_user = [api, profile]
	return _spotify_user
}

export function pass_zotify_credentials(): [string, string] {
	return pass_cred_get('spotify_dl_user')[0]
}
