import { PassIdentifier } from "./passes";
import { $album, $artist, $track } from "./schema";

// misc
export type MaybePromise<T> = T | Promise<T>
export type Override<T1, T2> = Omit<T1, keyof T2> & T2;
export type NewType<K, T> = T & { readonly __newtype: K }
export type NullMit<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type KV<K extends keyof any, V> = Partial<Record<K, V>>

export type static_assert<T extends true> = never
export type type_extends<T, U> = T extends U ? true : false

type Entries<T> = {
	[K in keyof T]: [K, T[K]]
}[keyof T][]
  
export function exhaustive_keyof<T>(obj: T): Entries<T> {
	return Object.entries(obj as object) as any;
}

export type Snowflake = number

// cannot have NewType<NewType<T>> as this results in `never`
export type TrackId = NewType<'TrackId', Snowflake>
export type AlbumId = NewType<'AlbumId', Snowflake>
export type ArtistId = NewType<'ArtistId', Snowflake>

export type TrackEntry = typeof $track.$inferInsert
export type AlbumEntry = typeof $album.$inferInsert
export type ArtistEntry = typeof $artist.$inferInsert

// an FSRef is a <nanoid>.<ext> string
export type FSRef = NewType<'FSRef', string>

type IdentComponents = `tr${string}` | `al${string}` | `ar${string}`
export type Ident = NewType<'Ident', IdentComponents>

// order by imagekind asc for most preferred kind to represent a piece of media
export type ImageKind = typeof ImageKind[keyof typeof ImageKind]
export const ImageKind = Object.freeze({
	['Cover Art']: 0,
	['Profile Art']: 1,
	['YouTube Thumbnail']: 2,
	['YouTube Banner']: 3,
	//['YouTube TV Banner']: 2,
	//['YouTube Mobile Banner']: 3,
	['Spotify Artist Banner']: 4,
})

export function image_kind_tostring(kind: ImageKind): string {
	for (const [k, v] of Object.entries(ImageKind)) {
		if (v === kind) {
			return k
		}
	}

	return 'Unknown Image Kind'
}

export enum LocaleDesc {
	name,
	description,
}

// TODO: this is a bug in bun, enums with index values just don't parse
//       we need to deal with this by just using a damn object instead

// afaik, sqlite doesn't support string interning
// this will save so much memory
export type Link = typeof Link[keyof typeof Link]
export const Link = Object.freeze({
	['Unknown URL']: 0, // integers 0 and 1 have zero overhead storage size in sqlite
	['YouTube Video']: 1,
	['YouTube Channel']: 2,
	['YouTube Playlist']: 3,
	['Spotify Track']: 4,
	['Spotify Album']: 5,
	['Spotify Artist']: 6,
	['Apple Music Album']: 7,
	['Karent Album']: 8,
	['Karent Artist']: 9,
	['Piapro Item']: 10,
	['Piapro Creator']: 11,
	['Niconico Video']: 12,
	['Niconico User']: 13,
	['Niconico Material']: 14,
	['Twitter User']: 15,
	['Linkcore']: 16, // tunecore JP
	['Linkfire (lnk.to)']: 17,
	['Linkfire Composite (lnk.to)']: 18, // composite `${string}/${string}`
})

export type Script = string // ???? whatever for now

export type QueueEntry<T> = {
	id: QueueId
	pass: PassIdentifier
	payload: T
}

export type QueueId = NewType<'QueueId', number>

export type PassHashed = NewType<'PassHashed', number>

export type LinkEntry = {
	ident: Ident
	kind: Link
	data: string
}

export type LocaleEntry = {
	ident: Ident
	locale?: Script | null
	preferred: boolean
	desc: LocaleDesc
	text: string
}
