// misc
export type MaybePromise<T> = T | Promise<T>
export type Override<T1, T2> = Omit<T1, keyof T2> & T2;
export type NewType<K, T> = T & { readonly __newtype: K }
export type NullMit<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;
export type KV<K extends keyof any, V> = Partial<Record<K, V>>

export type TrackId = NewType<'TrackId', number>
export type AlbumId = NewType<'AlbumId', number>
export type ArtistId = NewType<'ArtistId', number>

export type LinkId = NewType<'LinkId', number>

type PassField = 'all' | 'track' | 'album' | 'artist' | 'karent_album' | 'karent_artist' | 'youtube_video' | 'youtube_channel' | 'links' | 'images' | 'sources'
type PassKind = 'meta' | 'extrapolate' | 'download' | 'classify' | 'tag'
export type PassIdentifier = `${PassField}.${PassKind}.${string}`
