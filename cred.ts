import { sql } from "drizzle-orm"
import { db } from "./db"
import { $kv_store } from "./schema"
import { pass_exception } from "./pass"
import { SpotifyApi } from "@spotify/web-api-ts-sdk"
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
		fetch: nfetch,
	})

	return _spotify_api
}

export function pass_zotify_credentials(): [string, string] {
	return pass_cred_get('spotify_dl_user')[0]
}
