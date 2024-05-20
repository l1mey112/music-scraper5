import { sql } from "drizzle-orm"
import { db } from "./db"
import { $kv_store } from "./schema"
import { pass_exception } from "./pass"
import { AccessToken, SpotifyApi, UserProfile } from "@spotify/web-api-ts-sdk"
import { nfetch } from "./fetch"
import { atexit } from "./atexit"
import { fs_root_path } from "./fs"

export type PersistentCredentialKind = keyof PersistentCredentialStore
type PersistentCredentialStore = {
	'spotify_user': AccessToken[]
}

function persistent_cred_get<T extends PersistentCredentialKind>(kind: T): PersistentCredentialStore[T] {
	const cred = db.select({ data: $kv_store.data })
		.from($kv_store)
		.where(sql`kind = ${`cred.${kind}`}`)
		.get() as { data: PersistentCredentialStore[T] } | undefined

	if (!cred) {
		return []
	}

	return cred.data
}

function persistent_cred_store<T extends PersistentCredentialKind>(kind: T, data: PersistentCredentialStore[T]) {
	db.insert($kv_store)
		.values({ kind: `cred.${kind}`, data })
		.onConflictDoUpdate({
			target: $kv_store.kind,
			set: { data }
		})
		.run()
}

// must be called inside a pass, throws PassStopException if cred not found
function pass_persistent_cred_assert<T extends PersistentCredentialKind>(kind: T): PersistentCredentialStore[T] {
	const datum = persistent_cred_get(kind)

	if (datum.length === 0) {
		pass_exception(`[cred_get] ${kind} not found`)
	}

	return datum
}

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

const spotify_config = {
	fetch: nfetch,
}

let _spotify_user: [SpotifyApi, UserProfile] | undefined

atexit(async () => {	
	if (_spotify_user) {
		const token = await _spotify_user[0].getAccessToken()

		if (token) {
			persistent_cred_store('spotify_user', [token])
		}
	}
})

export async function pass_spotify_user(): Promise<[SpotifyApi, UserProfile]> {
	if (_spotify_user) {
		return _spotify_user
	}

	const client_redirect_uri = 'http://localhost:8080/callback'
	const [client_id, client_secret] = spotify_api_cred()

	const [access_token, ] = persistent_cred_get('spotify_user')

	if (access_token) {
		// TODO: duplicated code
		const api = SpotifyApi.withAccessToken(client_id, access_token, spotify_config)
		_spotify_user = [api, await api.currentUser.profile()]
		return _spotify_user
	}

	async function spotify_auth_user(): Promise<AccessToken> {
		let the_keys: AccessToken | undefined

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
						const error = url.searchParams.get('error')

						if (error) {
							throw new Error('auth failed: ' + error)
						}

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
						the_keys = auth_json as AccessToken

						return new Response('auth completed, you may close this window now', {status: 200})
					}
				}
				return new Response('Not Found', {status: 404})
			},
		})

		while (!the_keys) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}

		server.stop(true)

		return the_keys
	}

	const token = await spotify_auth_user()
	const api = SpotifyApi.withAccessToken(client_id, token, spotify_config)
	const profile = await api.currentUser.profile()

	_spotify_user = [api, profile]
	return _spotify_user
}

async function make_round_robin<T>(fp: string) {
	const json: T[] = await Bun.file(fp).json()

	let idx = 0
	return () => {
		const ret = json[idx]
		idx = (idx + 1) % json.length
		return ret
	}
}

const spotify_api_cred = await make_round_robin<[client_id: string, client_secret: string]>(fs_root_path('spotify_api_cred_list.json'))
const spotify_user_cred = await make_round_robin<[username: string, password: string]>(fs_root_path('spotify_user_cred_list.json'))

// round robin
export function pass_new_zotify_credentials(): [username: string, password: string] {
	return spotify_user_cred()
}

// round robin
export function pass_new_spotify_api(): SpotifyApi {
	const [client_id, client_secret] = spotify_api_cred()
	const api = SpotifyApi.withClientCredentials(client_id, client_secret, scopes, spotify_config)
	return api
}
