// misc
export type MaybePromise<T> = T | Promise<T>
export type Override<T1, T2> = Omit<T1, keyof T2> & T2;
export type NewType<K, T> = T & { readonly __newtype: K }
export type NullMit<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type KV<K extends keyof any, V> = Partial<Record<K, V>>

export type Snowflake = number

// cannot have NewType(NewType()) as this results in `never`
export type TrackId = NewType<'TrackId', Snowflake>
export type AlbumId = NewType<'AlbumId', Snowflake>
export type ArtistId = NewType<'ArtistId', Snowflake>

type PassField = 'all' | 'track' | 'album' | 'artist' | 'karent_album' | 'karent_artist' | 'youtube_video' | 'youtube_channel' | 'links' | 'images' | 'sources'
type PassKind = 'meta' | 'extrapolate' | 'download' | 'classify' | 'tag'
export type PassIdentifier = `${PassField}.${PassKind}.${string}`

type IdentComponents = `tr${string}` | `al${string}` | `ar${string}`
export type Ident = NewType<'Ident', IdentComponents>

const image_kind_tostring = {
	yt_thumbnail: 'YouTube Thumbnail',
	yt_banner: 'YouTube Banner',
	yt_tv_banner: 'YouTube TV Banner',
	yt_mobile_banner: 'YouTube Mobile Banner',
	cover_art: 'Cover Art',
	profile_art: 'Profile Art',
} as const

export type ImageKind = keyof typeof image_kind_tostring

// see locale.ts
// Locale is a IETF language subtag (e.g. en, jp)
export type Locale = NewType<'Locale', string>

export enum LocaleDesc {
	name,
	description,
}

// TODO: this is a bug in bun, enums with index values just don't parse
//       we need to deal with this by just using a damn object instead

// afaik, sqlite doesn't support string interning
// this will save so much memory
export type Link = number
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

export type QueueEntry<T = unknown> = {
	rowid: number
	target?: Ident | null
	payload: T
	cmd: QueueCmd
}

export enum QueueCmd {
	yt_video = 0,
	sp_track = 1,
	image_url = 2,
}

export type LinkEntry = {
	ident: Ident
	kind: Link
	data: string
}

export type LocaleEntry = {
	ident: Ident
	locale?: Locale | null
	preferred: boolean
	desc: LocaleDesc
	text: string
}
