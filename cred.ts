import { sql } from "drizzle-orm"
import { db } from "./db"
import { $kv_store } from "./schema"
import { pass_exception } from "./pass"

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
