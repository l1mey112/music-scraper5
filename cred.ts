import { InferSelectModel, getTableName, sql } from "drizzle-orm"
import { db, sqlite } from "./db"
import { $cred_spotify_user, $kv_store } from "./schema"
import { pass_exception } from "./pass"
import { AccessToken, SpotifyApi, UserProfile } from "@spotify/web-api-ts-sdk"
import { nfetch } from "./fetch"
import { atexit } from "./atexit"
import { fs_root_path } from "./fs"
import { SQLiteTable } from "drizzle-orm/sqlite-core"

export type PersistentCredentialKind = keyof PersistentCredentialStore
type PersistentCredentialStore = {
	'spotify_user': {
		auth_client_id: string
		auth_client_secret: string
		token: AccessToken
	}
}

function persistent_cred_get<T extends PersistentCredentialKind>(kind: T): PersistentCredentialStore[T] | undefined {
	const cred = db.select({ data: $kv_store.data })
		.from($kv_store)
		.where(sql`kind = ${`cred.${kind}`}`)
		.get() as { data: PersistentCredentialStore[T] } | undefined

	if (!cred) {
		return
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

type SpotifyContext = { api: SpotifyApi, profile: UserProfile, cred: PersistentCredentialStore['spotify_user'] }
let _spotify_user: SpotifyContext | undefined

atexit(async () => {	
	if (_spotify_user) {
		const token = await _spotify_user.api.getAccessToken()

		if (token) {
			persistent_cred_store('spotify_user', {
				..._spotify_user.cred,
				token,
			})
		}
	}
})

export async function pass_spotify_user(): Promise<SpotifyContext> {
	if (_spotify_user) {
		return _spotify_user
	}

	const context = persistent_cred_get('spotify_user')

	if (context) {
		const api = SpotifyApi.withAccessToken(context.auth_client_id, context.token, spotify_config)
		_spotify_user = {
			api,
			profile: await api.currentUser.profile(),
			cred: context
		}
		return _spotify_user
	}

	const client_redirect_uri = 'http://localhost:8080/callback'
	const [client_id, client_secret] = spotify_api_user_cred

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

	_spotify_user = {
		api,
		profile,
		cred: {
			auth_client_id: client_id,
			auth_client_secret: client_secret,
			token,
		}
	}
	return _spotify_user
}

async function make_round_robin<T extends string[]>(fp: string) {
	const json: T[] = await Bun.file(fp).json()
	const ban_set: Set<object> = new Set()

	let idx = 0
	function round_robin() {
		const nidx = idx
		idx = (idx + 1) % json.length
		return nidx
	}

	return {
		roll() {
			// roll, then just ignore ban sets
			for (let i = 0; i < json.length; i++) {
				const idx = round_robin()
				if (!ban_set.has(json[idx])) {
					return json[idx]
				}
			}
			console.log(`round_robin(${fp}): all ${json.length} banned`)

			return json[round_robin()]
		},
		ban(obj: T) {
			ban_set.add(obj)
		},
		unban(obj: T) {
			ban_set.delete(obj)
		},
	}
}

function make_round_robin_sqlite<T extends SQLiteTable>(table: T, window_size: number) {
	const table_name = getTableName(table)

	type Entry = InferSelectModel<T> & { rowid: number }

	let i = 0
	const stmt_select = sqlite.prepare<Entry, [i: number]>(`
		select tb.* from (
			select *, rowid from "${table_name}"
			order by rowid limit ${window_size}
		) tb
		order by tb.expiry asc
		limit 1 offset ?
	`)

	const stmt_delete = sqlite.prepare<[], [rowid: number]>(`
		delete from "${table_name}" where rowid = ?
	`)

	const stmt_update = sqlite.prepare<[], [expiry: number, rowid: number]>(`
		update "${table_name}" set expiry = ? where rowid = ?
	`)

	return {
		roll(): Entry {
			const item = stmt_select.get(i++)

			if (!item) {
				i = 0
				return stmt_select.get(i++)! // let them deal with the null exception
			}

			return item
		},
		ban(entry: Entry, duration: number) {
			stmt_update.run(Date.now() + duration, entry.rowid)
		},
		kill(entry: Entry) {
			stmt_delete.run(entry.rowid)
		},
	}
}

async function make_random<T extends string[]>(fp: string) {
	const json: T[] = await Bun.file(fp).json()
	return {
		roll() {
			return json[Math.floor(Math.random() * json.length)]
		},
	}
}

// spotify credentials that are authorised to log in the user
// use these sparingly
export const spotify_api_user_cred: [client_id: string, client_secret: string] = await Bun.file(fs_root_path('spotify_api_user_cred.json')).json()
export const spotify_user_cred = make_round_robin_sqlite($cred_spotify_user, 32)
export const spotify_api_cred = await make_round_robin<[client_id: string, client_secret: string]>(fs_root_path('spotify_api_cred_list.json'))

// round robin
export function pass_new_spotify_api(): SpotifyApi {
	const [client_id, client_secret] = spotify_api_cred.roll()
	const api = SpotifyApi.withClientCredentials(client_id, client_secret, scopes, spotify_config)
	return api
}
